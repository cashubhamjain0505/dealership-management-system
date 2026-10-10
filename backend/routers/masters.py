"""Master data: items, customers, price list (NDP -> MRP), Excel upload + templates."""

import os
import re

from fastapi import APIRouter, Depends, HTTPException, Response, UploadFile
from pydantic import BaseModel

from lib import excelio
from lib.db import db
from lib.helpers import clean, mrp_from_ndp
from models.masters import Customer, CustomerCreate, CustomerUpdate, Item, ItemCreate, ItemUpdate
from routers.auth import require_staff

router = APIRouter(tags=["masters"])


class UploadResult(BaseModel):
    created: int = 0
    updated: int = 0
    skipped: int = 0
    errors: list[str] = []


def _rx(text: str) -> dict:
    return {"$regex": re.escape(text.strip()), "$options": "i"}


# ---------------- Items ----------------


@router.get("/items", response_model=list[Item])
async def list_items(query: str = "", _: dict = Depends(require_staff)):
    filter_: dict = {}
    if query.strip():
        filter_ = {"$or": [{"part_number": _rx(query)}, {"name": _rx(query)}, {"alt_part_number": _rx(query)}]}
    docs = await db.items.find(filter_).sort("part_number", 1).to_list(5000)
    return [Item(**clean(d)) for d in docs]


@router.post("/items", response_model=Item, status_code=201)
async def create_item(body: ItemCreate, _: dict = Depends(require_staff)):
    part = body.part_number.strip().upper()
    if not part:
        raise HTTPException(422, "Part number is required")
    if await db.items.find_one({"part_number": part}):
        raise HTTPException(409, f"Part {part} already exists")
    item = Item(
        part_number=part,
        name=body.name.strip(),
        hsn=body.hsn.strip(),
        gst_rate=body.gst_rate,
        ndp=body.ndp,
        mrp=mrp_from_ndp(body.ndp) if body.ndp > 0 else (body.mrp or 0.0),
        moq=body.moq,
        unit=body.unit.strip() or "PCS",
        alt_part_number=body.alt_part_number.strip(),
    )
    await db.items.insert_one(item.model_dump())
    return item


@router.patch("/items/{item_id}", response_model=Item)
async def update_item(item_id: str, body: ItemUpdate, _: dict = Depends(require_staff)):
    doc = await db.items.find_one({"id": item_id})
    if not doc:
        raise HTTPException(404, "Item not found")
    updates = {k: v for k, v in body.model_dump().items() if v is not None}
    if "ndp" in updates:
        ndp = updates["ndp"]
        updates["mrp"] = mrp_from_ndp(ndp) if ndp > 0 else doc.get("mrp", 0.0)
    if updates:
        await db.items.update_one({"id": item_id}, {"$set": updates})
    refreshed = await db.items.find_one({"id": item_id})
    return Item(**clean(refreshed))


@router.delete("/items/{item_id}")
async def delete_item(item_id: str, _: dict = Depends(require_staff)):
    await db.items.delete_one({"id": item_id})
    return {"ok": True}


# ---------------- Customers ----------------


@router.get("/customers", response_model=list[Customer])
async def list_customers(query: str = "", _: dict = Depends(require_staff)):
    filter_: dict = {}
    if query.strip():
        filter_ = {"$or": [{"code": _rx(query)}, {"name": _rx(query)}, {"gstin": _rx(query)}]}
    docs = await db.customers.find(filter_).sort("code", 1).to_list(5000)
    return [Customer(**clean(d)) for d in docs]


@router.post("/customers", response_model=Customer, status_code=201)
async def create_customer(body: CustomerCreate, _: dict = Depends(require_staff)):
    code = body.code.strip().upper()
    if not code:
        raise HTTPException(422, "Customer code is required")
    if await db.customers.find_one({"code": code}):
        raise HTTPException(409, f"Customer {code} already exists")
    customer = Customer(code=code, name=body.name.strip(), **body.model_dump(exclude={"code", "name"}))
    await db.customers.insert_one(customer.model_dump())
    return customer


@router.patch("/customers/{customer_id}", response_model=Customer)
async def update_customer(customer_id: str, body: CustomerUpdate, _: dict = Depends(require_staff)):
    doc = await db.customers.find_one({"id": customer_id})
    if not doc:
        raise HTTPException(404, "Customer not found")
    updates = {k: v for k, v in body.model_dump().items() if v is not None}
    if updates:
        await db.customers.update_one({"id": customer_id}, {"$set": updates})
    refreshed = await db.customers.find_one({"id": customer_id})
    return Customer(**clean(refreshed))


@router.delete("/customers/{customer_id}")
async def delete_customer(customer_id: str, _: dict = Depends(require_staff)):
    await db.customers.delete_one({"id": customer_id})
    return {"ok": True}


# ---------------- Excel uploads ----------------


@router.post("/items/upload", response_model=UploadResult)
async def upload_items(file: UploadFile, _: dict = Depends(require_staff)):
    rows = excelio.load_rows(await file.read())
    result = UploadResult()
    for index, row in enumerate(rows, 2):
        part = excelio.as_str(excelio.pick(row, "part number", "part no", "partno", "part")).upper()
        name = excelio.as_str(excelio.pick(row, "item name", "name", "item", "description"))
        if not part or not name:
            result.skipped += 1
            result.errors.append(f"row {index}: part number and item name are required")
            continue
        ndp = excelio.as_float(excelio.pick(row, "ndp", "net dealer price"))
        mrp_direct = excelio.as_float(excelio.pick(row, "mrp", "mrp as of date", "price"))
        payload = {
            "name": name,
            "hsn": excelio.as_str(excelio.pick(row, "hsn code", "hsn")),
            "gst_rate": excelio.as_float(excelio.pick(row, "gst rate", "gst rate %", "gst %", "gst"), 18.0),
            "moq": max(excelio.as_int(excelio.pick(row, "moq", "min order qty", "minimum order quantity"), 1), 1),
            "unit": excelio.as_str(excelio.pick(row, "unit", "uom")) or "PCS",
            "alt_part_number": excelio.as_str(
                excelio.pick(row, "alt part number", "alternate part number", "alt part no", "alternate part no")
            ),
            "ndp": ndp,
            "mrp": mrp_from_ndp(ndp) if ndp > 0 else mrp_direct,
        }
        existing = await db.items.find_one({"part_number": part})
        if existing:
            await db.items.update_one({"id": existing["id"]}, {"$set": payload})
            result.updated += 1
        else:
            await db.items.insert_one(Item(part_number=part, **payload).model_dump())
            result.created += 1
    return result


@router.post("/customers/upload", response_model=UploadResult)
async def upload_customers(file: UploadFile, _: dict = Depends(require_staff)):
    rows = excelio.load_rows(await file.read())
    result = UploadResult()
    for index, row in enumerate(rows, 2):
        code = excelio.as_str(excelio.pick(row, "customer code", "customer id", "code")).upper()
        name = excelio.as_str(excelio.pick(row, "customer name", "name"))
        if not code or not name:
            result.skipped += 1
            result.errors.append(f"row {index}: customer code and name are required")
            continue
        customer_type = excelio.as_str(excelio.pick(row, "customer type", "type", "wholesaler/retailer", "wholesaler retailer"))
        if customer_type.capitalize() not in ("Wholesaler", "Retailer", "Dealer"):
            customer_type = "Retailer"
        else:
            customer_type = customer_type.capitalize()
        payload = {
            "name": name,
            "address": excelio.as_str(excelio.pick(row, "address")),
            "gstin": excelio.as_str(excelio.pick(row, "gst no", "gst number", "gstin", "gst")),
            "state_code": excelio.as_str(excelio.pick(row, "state code", "state")),
            "customer_type": customer_type,
            "dealer_code": excelio.as_str(excelio.pick(row, "dealer code", "dealercode")),
            "discount_percent": excelio.as_float(excelio.pick(row, "discount percentage", "discount %", "discount", "disc %")),
            "min_order_qty": excelio.as_int(excelio.pick(row, "min order qty", "minimum order quantity", "min qty", "moq")),
        }
        existing = await db.customers.find_one({"code": code})
        if existing:
            await db.customers.update_one({"id": existing["id"]}, {"$set": payload})
            result.updated += 1
        else:
            await db.customers.insert_one(Customer(code=code, **payload).model_dump())
            result.created += 1
    return result


@router.post("/price-list/upload", response_model=UploadResult)
async def upload_price_list(file: UploadFile, _: dict = Depends(require_staff)):
    rows = excelio.load_rows(await file.read())
    result = UploadResult()
    for index, row in enumerate(rows, 2):
        part = excelio.as_str(excelio.pick(row, "part number", "part no")).upper()
        if not part:
            result.skipped += 1
            continue
        item = await db.items.find_one({"part_number": part})
        if not item:
            result.skipped += 1
            result.errors.append(f"row {index}: part {part} not found in item master")
            continue
        ndp = excelio.as_float(excelio.pick(row, "ndp", "net dealer price"), float(item.get("ndp", 0.0)))
        mrp_direct = excelio.as_float(excelio.pick(row, "mrp", "new mrp", "mrp new"), 0.0)
        updates: dict = {"ndp": ndp, "mrp": mrp_from_ndp(ndp) if ndp > 0 else (mrp_direct or float(item.get("mrp", 0.0)))}
        tag_raw = excelio.pick(row, "tag mrp", "mrp tag")
        if tag_raw is not None and str(tag_raw).strip() != "":
            tag_value = excelio.as_float(tag_raw, 0.0)
            if tag_value > 0:
                updates["tag_mrp"] = tag_value
        await db.items.update_one({"id": item["id"]}, {"$set": updates})
        result.updated += 1
    return result


# ---------------- Excel templates + app config ----------------


@router.get("/templates/{kind}")
async def download_template(kind: str, _: dict = Depends(require_staff)):
    specs: dict[str, tuple[str, str, list[str], list[list]]] = {
        "items": (
            "Items",
            "parts_master_template.xlsx",
            ["Part Number", "Item Name", "HSN Code", "NDP", "MRP", "GST Rate %", "MOQ", "Unit", "Alt Part Number"],
            [
                ["SUZ-12345", "Front Brake Pad Set", "87083000", 1200, "", 18, 10, "PCS", ""],
                ["SUZ-67890", "Oil Filter", "84212900", 350, 480, 18, 5, "PCS", "OI-210"],
            ],
        ),
        "customers": (
            "Customers",
            "customer_master_template.xlsx",
            ["Customer Code", "Customer Name", "Address", "GST No", "State Code", "Customer Type", "Dealer Code", "Discount %", "Min Order Qty"],
            [
                ["CUST001", "Royal Motors", "123 Main Street, Kanpur", "07ABCDE1234F1Z5", "07", "Wholesaler", "DLR-001", 5, 10],
                ["CUST002", "Speedy Bikes", "456 Oak Avenue, Delhi", "07FGHIJ5678G2Y6", "07", "Retailer", "", 2, 5],
            ],
        ),
        "orders": (
            "Orders",
            "customer_order_upload.xlsx",
            ["Customer Code", "Customer Name", "Part Number", "Item Name", "Ordered Qty", "Alternate Part Number", "Notes", "Order Reference Number", "Order Date"],
            [
                ["CUST001", "Royal Motors", "SUZ-12345", "Front Brake Pad Set", 20, "", "Urgent", "ORD-2026-001", "2026-01-10"],
                ["CUST001", "Royal Motors", "SUZ-67890", "Oil Filter", 50, "OI-210", "", "ORD-2026-001", "2026-01-10"],
            ],
        ),
        "price-list": (
            "PriceList",
            "price_list_ndp_template.xlsx",
            ["Part Number", "NDP", "MRP", "Tag MRP"],
            [["SUZ-12345", 1200, "", ""], ["SUZ-67890", 350, "", 480]],
        ),
        "vendor-invoices": (
            "VendorInvoices",
            "vendor_invoice_upload_template.xlsx",
            ["Vendor Invoice Number", "Vendor Name", "Vendor Code", "Invoice Date", "Purchase Order Number", "Part Number", "Item Name", "Ordered Qty", "Received Qty", "Unit Price", "Tag MRP"],
            [
                ["VINV-1001", "Vendor A", "VEND-A", "2026-01-15", "PO-2026-0001", "SUZ-12345", "Front Brake Pad Set", 5, 5, 900, 1600],
                ["VINV-1001", "Vendor A", "VEND-A", "2026-01-15", "PO-2026-0001", "SUZ-67890", "Oil Filter", 10, 8, 280, 480],
            ],
        ),
        "sales-history": (
            "SalesHistory",
            "tally_sales_history_template.xlsx",
            ["Invoice No", "Invoice Date", "Customer Code", "Customer Name", "Part Number", "Item Name", "Qty"],
            [
                ["TLY-001", "2025-04-05", "CUST001", "Royal Motors", "SUZ-BP-101", "Brake Pad Set — Front (Gixxer)", 12],
                ["TLY-001", "2025-04-05", "CUST001", "Royal Motors", "SUZ-OF-310", "Oil Filter (Access 125)", 30],
                ["TLY-002", "2025-04-18", "CUST002", "Speedy Bikes", "SUZ-SP-118", "Spark Plug (Iridium)", 40],
            ],
        ),
        "firmx-invoices": (
            "FirmXInvoices",
            "firmx_invoice_template.xlsx",
            ["Invoice No", "Invoice Date", "Part Number", "Item Name", "Qty", "Rate"],
            [
                ["INV-X-1001", "2026-01-28", "SUZ-BP-101", "Brake Pad Set — Front (Gixxer)", 45, 1200],
                ["INV-X-1001", "2026-01-28", "SUZ-OF-310", "Oil Filter (Access 125)", 100, 210],
            ],
        ),
    }
    if kind not in specs:
        raise HTTPException(404, f"Unknown template '{kind}'")
    title, filename, headers, sample = specs[kind]
    content = excelio.build_xlsx(title, headers, sample)
    return Response(
        content=content,
        media_type=excelio.XLSX_MIME,
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


class SellerInfo(BaseModel):
    name: str
    gstin: str
    address: str
    state_code: str
    pin: str


class ConfigOut(BaseModel):
    seller: SellerInfo
    gst_mode: str


@router.get("/config", response_model=ConfigOut)
async def get_config(_: dict = Depends(require_staff)):
    return ConfigOut(
        seller=SellerInfo(
            name=os.environ.get("SELLER_NAME", "Suzuki Spares"),
            gstin=os.environ.get("SELLER_GSTIN", ""),
            address=os.environ.get("SELLER_ADDRESS", ""),
            state_code=os.environ.get("SELLER_STATE_CODE", ""),
            pin=os.environ.get("SELLER_PIN", ""),
        ),
        gst_mode=os.environ.get("GST_MODE", "simulated"),
    )
