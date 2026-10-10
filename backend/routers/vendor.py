"""Vendor invoices: upload, allocated-not-received tracking, approve into stock, tag-MRP check, shorts."""

from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, UploadFile
from pydantic import BaseModel

from lib import excelio
from lib.db import db
from lib.dates import today_iso
from lib.helpers import clean, mrp_variance
from models.masters import uuid_str
from routers.auth import require_staff
from models.vendor import (
    ApproveIn,
    ResupplyIn,
    VendorInvoiceCreate,
    VendorInvoiceOut,
    VILineOut,
)

router = APIRouter(tags=["vendor"])


def vi_to_out(doc: dict) -> VendorInvoiceOut:
    data = clean(doc)
    return VendorInvoiceOut(
        id=data["id"],
        vendor_invoice_no=data["vendor_invoice_no"],
        vendor=data.get("vendor", ""),
        invoice_date=data.get("invoice_date", ""),
        po_number=data.get("po_number", ""),
        lines=[VILineOut(**l) for l in data.get("lines", [])],
        status=data.get("status", "allocated_not_received"),
        receipt_date=data.get("receipt_date", ""),
        created_at=str(data.get("created_at", "")),
    )


async def _build_lines(raw_lines: list, po_qty_by_part: dict[str, int]) -> list[dict]:
    items = {d["part_number"]: d for d in await db.items.find({}).to_list(5000)}
    lines: list[dict] = []
    for raw in raw_lines:
        part = raw["part_number"]
        item = items.get(part)
        po_qty = int(raw.get("po_qty") or 0) or po_qty_by_part.get(part, 0)
        received = int(raw.get("received_qty") or 0)
        unit_price = float(raw.get("unit_price") or 0.0)
        tag = raw.get("tag_mrp")
        system = float(item.get("mrp", 0.0) or 0.0) if item else None
        variance, flagged = mrp_variance(system, float(tag) if tag else None)
        lines.append(
            {
                "id": uuid_str(),
                "part_number": part,
                "item_name": raw.get("item_name") or (item["name"] if item else ""),
                "po_qty": po_qty,
                "received_qty": received,
                "short_qty": 0,
                "unit_price": unit_price,
                "line_total": round(unit_price * (received or po_qty), 2),
                "tag_mrp": float(tag) if tag else None,
                "system_mrp": system,
                "variance_percent": variance,
                "variance_flag": flagged,
            }
        )
    return lines


@router.post("/vendor-invoices", response_model=VendorInvoiceOut, status_code=201)
async def create_vendor_invoice(body: VendorInvoiceCreate, _: dict = Depends(require_staff)):
    number = body.vendor_invoice_no.strip()
    if not number:
        raise HTTPException(422, "Vendor invoice number is required")
    if await db.vendor_invoices.find_one({"vendor_invoice_no": number}):
        raise HTTPException(409, f"Vendor invoice {number} already exists")
    po = await db.purchase_orders.find_one({"po_number": body.po_number.strip()}) if body.po_number.strip() else None
    po_qty_by_part = {l["part_number"]: int(l.get("po_qty", 0)) for l in (po or {}).get("lines", [])}
    doc = {
        "id": uuid_str(),
        "vendor_invoice_no": number,
        "vendor": body.vendor.strip(),
        "invoice_date": body.invoice_date or today_iso(),
        "po_number": body.po_number.strip(),
        "lines": await _build_lines([l.model_dump() for l in body.lines], po_qty_by_part),
        "status": "allocated_not_received",
        "receipt_date": "",
        "created_at": datetime.now(timezone.utc),
    }
    await db.vendor_invoices.insert_one(doc)
    return vi_to_out(doc)


class VIUploadResult(BaseModel):
    created: int = 0
    lines: int = 0
    skipped: int = 0
    errors: list[str] = []


@router.post("/vendor-invoices/upload", response_model=VIUploadResult)
async def upload_vendor_invoices(file: UploadFile, _: dict = Depends(require_staff)):
    rows = excelio.load_rows(await file.read())
    result = VIUploadResult()
    groups: dict[str, dict] = {}
    for index, row in enumerate(rows, 2):
        number = excelio.as_str(excelio.pick(row, "vendor invoice number", "vendor invoice no", "invoice no", "invoice number"))
        part = excelio.as_str(excelio.pick(row, "part number", "part no")).upper()
        if not number or not part:
            result.skipped += 1
            result.errors.append(f"row {index}: vendor invoice number and part number are required")
            continue
        group = groups.setdefault(
            number,
            {
                "vendor": excelio.as_str(excelio.pick(row, "vendor name", "vendor")),
                "vendor_code": excelio.as_str(excelio.pick(row, "vendor code")),
                "invoice_date": excelio.as_date(excelio.pick(row, "invoice date", "date")),
                "po_number": excelio.as_str(excelio.pick(row, "purchase order number", "po number", "po no", "purchase order no")),
                "lines": [],
            },
        )
        group["lines"].append(
            {
                "part_number": part,
                "item_name": excelio.as_str(excelio.pick(row, "item name", "name")),
                "po_qty": excelio.as_int(excelio.pick(row, "ordered quantity", "ordered qty", "po qty", "qty")),
                "received_qty": excelio.as_int(excelio.pick(row, "received quantity", "received qty")),
                "unit_price": excelio.as_float(excelio.pick(row, "unit price", "price", "rate")),
                "tag_mrp": excelio.as_float(excelio.pick(row, "tag mrp", "mrp tag"), 0.0) or None,
            }
        )
    for number, group in groups.items():
        if await db.vendor_invoices.find_one({"vendor_invoice_no": number}):
            result.skipped += len(group["lines"])
            result.errors.append(f"invoice {number}: already uploaded — skipped")
            continue
        po = (
            await db.purchase_orders.find_one({"po_number": group["po_number"]})
            if group["po_number"]
            else None
        )
        po_qty_by_part = {l["part_number"]: int(l.get("po_qty", 0)) for l in (po or {}).get("lines", [])}
        doc = {
            "id": uuid_str(),
            "vendor_invoice_no": number,
            "vendor": group["vendor"],
            "invoice_date": group["invoice_date"] or today_iso(),
            "po_number": group["po_number"],
            "lines": await _build_lines(group["lines"], po_qty_by_part),
            "status": "allocated_not_received",
            "receipt_date": "",
            "created_at": datetime.now(timezone.utc),
        }
        await db.vendor_invoices.insert_one(doc)
        result.created += 1
        result.lines += len(doc["lines"])
    return result


@router.get("/vendor-invoices", response_model=list[VendorInvoiceOut])
async def list_vendor_invoices(_: dict = Depends(require_staff)):
    docs = await db.vendor_invoices.find({}).sort("created_at", -1).to_list(1000)
    return [vi_to_out(d) for d in docs]


@router.get("/vendor-invoices/{vi_id}", response_model=VendorInvoiceOut)
async def get_vendor_invoice(vi_id: str, _: dict = Depends(require_staff)):
    doc = await db.vendor_invoices.find_one({"id": vi_id})
    if not doc:
        raise HTTPException(404, "Vendor invoice not found")
    return vi_to_out(doc)


@router.post("/vendor-invoices/{vi_id}/approve", response_model=VendorInvoiceOut)
async def approve_vendor_invoice(vi_id: str, body: ApproveIn, _: dict = Depends(require_staff)):
    doc = await db.vendor_invoices.find_one({"id": vi_id})
    if not doc:
        raise HTTPException(404, "Vendor invoice not found")
    if doc.get("status") == "received":
        raise HTTPException(409, "Invoice already approved into stock")
    line_map = {l["id"]: l for l in doc.get("lines", [])}
    req_map = {r.line_id: r for r in body.lines}
    for line_id, req in req_map.items():
        if line_id not in line_map:
            raise HTTPException(422, "Unknown invoice line")
    items = {d["part_number"]: d for d in await db.items.find({}).to_list(5000)}
    today = today_iso()
    any_short = False
    for line_id, req in req_map.items():
        line = line_map[line_id]
        part = line["part_number"]
        item = items.get(part)
        tag = req.tag_mrp if req.tag_mrp else line.get("tag_mrp")
        system = float(item.get("mrp", 0.0) or 0.0) if item else None
        variance, flagged = mrp_variance(system, float(tag) if tag else None)
        received = int(req.received_qty)
        short = max(int(line.get("po_qty", 0)) - received, 0) if int(line.get("po_qty", 0)) > 0 else 0
        line["received_qty"] = received
        line["short_qty"] = short
        line["tag_mrp"] = float(tag) if tag else None
        line["system_mrp"] = system
        line["variance_percent"] = variance
        line["variance_flag"] = flagged
        line["line_total"] = round(float(line.get("unit_price", 0.0)) * received, 2)
        if received > 0:
            await db.stock.update_one(
                {"part_number": part},
                {"$inc": {"qty": received}, "$set": {"updated_at": datetime.now(timezone.utc)}},
                upsert=True,
            )
        if tag and item:
            await db.items.update_one({"id": item["id"]}, {"$set": {"tag_mrp": float(tag)}})
        if short > 0:
            any_short = True
            await db.short_items.insert_one(
                {
                    "id": uuid_str(),
                    "vendor_invoice_no": doc["vendor_invoice_no"],
                    "po_number": doc.get("po_number", ""),
                    "part_number": part,
                    "item_name": line.get("item_name", ""),
                    "qty_short": short,
                    "qty_received_later": 0,
                    "date_reported": today,
                    "reason": req.reason.strip() or "Short received from vendor",
                    "status": "pending",
                    "resolved_date": "",
                    "created_at": datetime.now(timezone.utc),
                }
            )
    doc["lines"] = list(line_map.values())
    doc["status"] = "received"
    doc["receipt_date"] = today
    await db.vendor_invoices.update_one(
        {"id": vi_id},
        {"$set": {"lines": doc["lines"], "status": "received", "receipt_date": today}},
    )
    if doc.get("po_number"):
        po = await db.purchase_orders.find_one({"po_number": doc["po_number"]})
        if po and po.get("status") in ("draft", "sent", "partially_received"):
            await db.purchase_orders.update_one(
                {"id": po["id"]}, {"$set": {"status": "partially_received" if any_short else "received"}}
            )
    return vi_to_out(doc)


@router.get("/short-items")
async def list_short_items(_: dict = Depends(require_staff)):
    docs = await db.short_items.find({}).sort([("status", 1), ("created_at", -1)]).to_list(1000)
    return [clean(d) for d in docs]


@router.post("/short-items/{short_id}/resupply")
async def resupply_short_item(short_id: str, body: ResupplyIn, _: dict = Depends(require_staff)):
    doc = await db.short_items.find_one({"id": short_id})
    if not doc:
        raise HTTPException(404, "Short item not found")
    if doc.get("status") == "resolved":
        raise HTTPException(409, "Already fully resolved")
    remaining = int(doc["qty_short"]) - int(doc.get("qty_received_later", 0))
    if body.qty > remaining:
        raise HTTPException(422, f"Only {remaining} unit(s) still outstanding")
    await db.stock.update_one(
        {"part_number": doc["part_number"]},
        {"$inc": {"qty": body.qty}, "$set": {"updated_at": datetime.now(timezone.utc)}},
        upsert=True,
    )
    received_later = int(doc.get("qty_received_later", 0)) + body.qty
    resolved = received_later >= int(doc["qty_short"])
    updates = {
        "qty_received_later": received_later,
        "status": "resolved" if resolved else "pending",
        "resolved_date": today_iso() if resolved else doc.get("resolved_date", ""),
    }
    if body.reason.strip():
        updates["reason"] = body.reason.strip()
    await db.short_items.update_one({"id": short_id}, {"$set": updates})
    doc = await db.short_items.find_one({"id": short_id})
    return clean(doc)
