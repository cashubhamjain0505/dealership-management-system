"""Customer orders: manual entry + Excel upload, quotation view, tick-to-allocate."""

from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, UploadFile
from pydantic import BaseModel

from lib import excelio
from lib.db import db
from lib.dates import today_iso
from lib.helpers import next_number, reserved_by_part
from models.masters import uuid_str
from routers.auth import require_staff
from models.orders import (
    AllocateIn,
    CustomerSnapshot,
    OrderCreate,
    OrderLineOut,
    OrderOut,
    OrderTotals,
)

router = APIRouter(tags=["orders"])


class OrderUploadResult(BaseModel):
    created: int = 0
    lines: int = 0
    skipped: int = 0
    errors: list[str] = []


async def _items_by_part() -> dict[str, dict]:
    # Billing builds invoice lines + the HSN summary from this map, so hsn/gst_rate/unit must be
    # projected too — omitting them silently charged every line a default 18% with a blank HSN.
    projection = {
        "part_number": 1,
        "name": 1,
        "mrp": 1,
        "tag_mrp": 1,
        "moq": 1,
        "hsn": 1,
        "gst_rate": 1,
        "unit": 1,
    }
    docs = await db.items.find({}, projection).to_list(5000)
    return {d["part_number"]: d for d in docs}


def _snapshot(customer_doc: dict) -> CustomerSnapshot:
    return CustomerSnapshot(
        id=customer_doc.get("id", ""),
        code=customer_doc.get("code", ""),
        name=customer_doc.get("name", ""),
        address=customer_doc.get("address", ""),
        gstin=customer_doc.get("gstin", ""),
        state_code=customer_doc.get("state_code", ""),
        customer_type=customer_doc.get("customer_type", "Retailer"),
        discount_percent=float(customer_doc.get("discount_percent", 0.0)),
        min_order_qty=int(customer_doc.get("min_order_qty", 0)),
    )


def _new_line(part: str, item_name: str, alt: str, qty: int, notes: str) -> dict:
    return {
        "id": uuid_str(),
        "part_number": part,
        "item_name": item_name,
        "alt_part_number": alt,
        "ordered_qty": qty,
        "allocated_qty": 0,
        "billed_qty": 0,
        "notes": notes,
    }


def order_to_out(doc: dict, items: dict[str, dict]) -> OrderOut:
    customer = CustomerSnapshot(**doc["customer"])
    discount = customer.discount_percent
    lines: list[OrderLineOut] = []
    subtotal = discount_amount = 0.0
    for line in doc.get("lines", []):
        item = items.get(line["part_number"])
        rate: float | None = None
        source = ""
        if item:
            if item.get("tag_mrp"):
                rate, source = float(item["tag_mrp"]), "tag"
            elif item.get("mrp"):
                rate, source = float(item["mrp"]), "system"
        ordered = int(line.get("ordered_qty", 0))
        billed = int(line.get("billed_qty", 0))
        allocated = int(line.get("allocated_qty", 0))
        if not item:
            status = "unmapped"
        elif billed >= ordered:
            status = "billed"
        elif allocated > 0 or billed > 0:
            status = "partial"
        else:
            status = "pending"
        gross = round((rate or 0.0) * ordered, 2)
        disc = round(gross * discount / 100, 2)
        subtotal += gross
        discount_amount += disc
        lines.append(
            OrderLineOut(
                id=line["id"],
                part_number=line["part_number"],
                item_name=line.get("item_name", ""),
                alt_part_number=line.get("alt_part_number", ""),
                ordered_qty=ordered,
                allocated_qty=allocated,
                billed_qty=billed,
                balance_qty=max(ordered - billed, 0),
                notes=line.get("notes", ""),
                status=status,
                rate=rate,
                rate_source=source,
                line_total=round(gross - disc, 2),
                below_moq=customer.min_order_qty > 0 and ordered < customer.min_order_qty,
            )
        )
    if lines and all(l.status == "billed" for l in lines):
        order_status = "billed"
    elif any(l.status in ("partial", "billed") for l in lines):
        order_status = "partial"
    else:
        order_status = "open"
    return OrderOut(
        id=doc["id"],
        order_ref=doc.get("order_ref", ""),
        order_date=doc.get("order_date", ""),
        notes=doc.get("notes", ""),
        customer=customer,
        lines=lines,
        totals=OrderTotals(
            subtotal=round(subtotal, 2),
            discount_amount=round(discount_amount, 2),
            total=round(subtotal - discount_amount, 2),
        ),
        status=order_status,
        created_at=str(doc.get("created_at", "")),
    )


@router.get("/orders", response_model=list[OrderOut])
async def list_orders(_: dict = Depends(require_staff)):
    docs = await db.orders.find({}).sort("created_at", -1).to_list(2000)
    items = await _items_by_part()
    return [order_to_out(d, items) for d in docs]


@router.get("/orders/{order_id}", response_model=OrderOut)
async def get_order(order_id: str, _: dict = Depends(require_staff)):
    doc = await db.orders.find_one({"id": order_id})
    if not doc:
        raise HTTPException(404, "Order not found")
    return order_to_out(doc, await _items_by_part())


@router.post("/orders", response_model=OrderOut, status_code=201)
async def create_order(body: OrderCreate, _: dict = Depends(require_staff)):
    customer = await db.customers.find_one({"code": body.customer_code.strip().upper()})
    if not customer:
        raise HTTPException(404, f"Customer {body.customer_code} not found — add them under Masters first")
    items = await _items_by_part()
    order_ref = body.order_ref.strip() or await next_number(db, "order", "ORD", 5)
    order_date = body.order_date or today_iso()
    lines = []
    for line in body.lines:
        part = line.part_number.strip().upper()
        item = items.get(part)
        lines.append(
            _new_line(
                part,
                line.item_name.strip() or (item["name"] if item else ""),
                line.alt_part_number.strip(),
                line.ordered_qty,
                line.notes.strip(),
            )
        )
    doc = {
        "id": uuid_str(),
        "order_ref": order_ref,
        "order_date": order_date,
        "notes": body.notes.strip(),
        "customer": _snapshot(customer).model_dump(),
        "lines": lines,
        "created_at": datetime.now(timezone.utc),
    }
    await db.orders.insert_one(doc)
    return order_to_out(doc, items)


@router.post("/orders/upload", response_model=OrderUploadResult)
async def upload_orders(file: UploadFile, _: dict = Depends(require_staff)):
    rows = excelio.load_rows(await file.read())
    items = await _items_by_part()
    result = OrderUploadResult()
    groups: dict[tuple[str, str], dict] = {}
    for index, row in enumerate(rows, 2):
        code = excelio.as_str(excelio.pick(row, "customer code", "customer id", "code")).upper()
        part = excelio.as_str(excelio.pick(row, "part number", "part no")).upper()
        qty = excelio.as_int(excelio.pick(row, "ordered qty", "ordered quantity", "qty", "quantity"))
        if not code or not part or qty <= 0:
            result.skipped += 1
            result.errors.append(f"row {index}: customer code, part number and qty > 0 are required")
            continue
        ref = excelio.as_str(
            excelio.pick(row, "order reference number", "order ref", "order reference", "reference no", "ref no")
        )
        date = excelio.as_date(excelio.pick(row, "order date", "date"))
        group = groups.setdefault((code, ref), {"date": date, "lines": []})
        if date and not group["date"]:
            group["date"] = date
        group["lines"].append(
            {
                "part_number": part,
                "item_name": excelio.as_str(excelio.pick(row, "item name", "name")),
                "alt_part_number": excelio.as_str(
                    excelio.pick(row, "alternate part number", "alt part number", "alt part no", "alternate part no")
                ),
                "ordered_qty": qty,
                "notes": excelio.as_str(excelio.pick(row, "notes", "remarks", "notes/remarks")),
            }
        )
    for (code, ref), group in groups.items():
        if ref and await db.orders.find_one({"order_ref": ref}):
            result.skipped += len(group["lines"])
            result.errors.append(f"order ref {ref}: already uploaded — skipped")
            continue
        customer = await db.customers.find_one({"code": code})
        if not customer:
            result.skipped += len(group["lines"])
            result.errors.append(f"customer {code}: not in masters — order skipped")
            continue
        order_ref = ref or await next_number(db, "order", "ORD", 5)
        lines = [
            _new_line(
                line["part_number"],
                line["item_name"] or (items[line["part_number"]]["name"] if line["part_number"] in items else ""),
                line["alt_part_number"],
                line["ordered_qty"],
                line["notes"],
            )
            for line in group["lines"]
        ]
        doc = {
            "id": uuid_str(),
            "order_ref": order_ref,
            "order_date": group["date"] or today_iso(),
            "notes": "",
            "customer": _snapshot(customer).model_dump(),
            "lines": lines,
            "created_at": datetime.now(timezone.utc),
        }
        await db.orders.insert_one(doc)
        result.created += 1
        result.lines += len(lines)
    return result


@router.delete("/orders/{order_id}")
async def delete_order(order_id: str, _: dict = Depends(require_staff)):
    doc = await db.orders.find_one({"id": order_id})
    if not doc:
        raise HTTPException(404, "Order not found")
    if any(int(l.get("billed_qty", 0)) > 0 for l in doc.get("lines", [])):
        raise HTTPException(409, "Order has billed lines and cannot be deleted")
    await db.orders.delete_one({"id": order_id})
    return {"ok": True}


@router.patch("/orders/{order_id}/allocate", response_model=OrderOut)
async def allocate_order(order_id: str, body: AllocateIn, _: dict = Depends(require_staff)):
    order = await db.orders.find_one({"id": order_id})
    if not order:
        raise HTTPException(404, "Order not found")
    items = await _items_by_part()
    patch = {l.line_id: l.allocated_qty for l in body.lines}
    stock = {d["part_number"]: int(d.get("qty", 0)) for d in await db.stock.find({}).to_list(5000)}
    reserved = await reserved_by_part(db)
    # Reservations of the lines being re-ticked return to the pool first.
    for line in order.get("lines", []):
        if line["id"] in patch:
            part = line["part_number"]
            billed = int(line.get("billed_qty", 0))
            old_reserved = max(int(line.get("allocated_qty", 0)) - billed, 0)
            reserved[part] = max(reserved.get(part, 0) - old_reserved, 0)
    for line in order.get("lines", []):
        if line["id"] not in patch:
            continue
        part = line["part_number"]
        billed = int(line.get("billed_qty", 0))
        new_alloc = int(patch[line["id"]])
        if new_alloc + billed > int(line["ordered_qty"]):
            raise HTTPException(422, f"{part}: allocated + billed cannot exceed ordered quantity")
        free = stock.get(part, 0) - reserved.get(part, 0)
        if new_alloc - billed > free:
            raise HTTPException(422, f"{part}: only {max(free, 0)} unit(s) free in warehouse")
        line["allocated_qty"] = new_alloc
        reserved[part] = reserved.get(part, 0) + max(new_alloc - billed, 0)
    await db.orders.update_one({"id": order_id}, {"$set": {"lines": order["lines"]}})
    return order_to_out(order, items)


@router.post("/orders/{order_id}/auto-allocate", response_model=OrderOut)
async def auto_allocate(order_id: str, _: dict = Depends(require_staff)):
    order = await db.orders.find_one({"id": order_id})
    if not order:
        raise HTTPException(404, "Order not found")
    items = await _items_by_part()
    stock = {d["part_number"]: int(d.get("qty", 0)) for d in await db.stock.find({}).to_list(5000)}
    reserved = await reserved_by_part(db, exclude_order_id=order_id)
    changed = False
    for line in order.get("lines", []):
        part = line["part_number"]
        if part not in items:
            continue
        billed = int(line.get("billed_qty", 0))
        target = int(line["ordered_qty"]) - billed
        if target <= 0:
            continue
        free = stock.get(part, 0) - reserved.get(part, 0)
        new_alloc = max(0, min(target, free))
        if new_alloc != int(line.get("allocated_qty", 0)):
            line["allocated_qty"] = new_alloc
            changed = True
        reserved[part] = reserved.get(part, 0) + new_alloc
    if changed:
        await db.orders.update_one({"id": order_id}, {"$set": {"lines": order["lines"]}})
    return order_to_out(order, items)
