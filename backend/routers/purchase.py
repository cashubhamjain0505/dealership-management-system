"""Purchase side: balance order list, DMS-ready POs with voluntary qty, Excel export."""

import io
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Response
from openpyxl import Workbook
from openpyxl.styles import Font
from pydantic import BaseModel

from lib import excelio
from lib.db import db
from lib.dates import today_iso
from lib.helpers import next_number
from models.purchase import BalanceRow, POCreate, POLineOut, POStatusUpdate, PurchaseOrderOut
from routers.auth import require_staff

router = APIRouter(tags=["purchase"])

OPEN_PO_STATUSES = ("draft", "sent", "partially_received")
VALID_PO_STATUSES = ("draft", "sent", "partially_received", "received", "closed")


class POCreatedOut(BaseModel):
    created: int = 0
    skipped: int = 0
    orders: list[PurchaseOrderOut] = []


def po_to_out(doc: dict) -> PurchaseOrderOut:
    return PurchaseOrderOut(
        id=doc["id"],
        po_number=doc["po_number"],
        reference_no=doc.get("reference_no", ""),
        order_date=doc.get("order_date", ""),
        expected_date=doc.get("expected_date", ""),
        vendor=doc.get("vendor", ""),
        lines=[POLineOut(**l) for l in doc.get("lines", [])],
        status=doc.get("status", "draft"),
        created_at=str(doc.get("created_at", "")),
    )


@router.get("/purchase/balance", response_model=list[BalanceRow])
async def balance_rows(_: dict = Depends(require_staff)):
    orders = await db.orders.find({}).to_list(2000)
    # Stock-plan POs are not raised against customer orders, so they must not net off customer demand.
    open_pos = await db.purchase_orders.find(
        {"status": {"$in": list(OPEN_PO_STATUSES)}, "po_type": {"$ne": "stock"}}
    ).to_list(2000)
    items = {d["part_number"]: d for d in await db.items.find({}).to_list(5000)}
    agg: dict[str, dict] = {}
    for order in orders:
        for line in order.get("lines", []):
            part = line["part_number"]
            entry = agg.setdefault(part, {"ordered": 0, "billed": 0})
            entry["ordered"] += int(line.get("ordered_qty", 0))
            entry["billed"] += int(line.get("billed_qty", 0))
    for po in open_pos:
        for line in po.get("lines", []):
            part = line["part_number"]
            entry = agg.setdefault(part, {"ordered": 0, "billed": 0})
            entry["in_po"] = entry.get("in_po", 0) + int(line.get("po_qty", 0))
    rows: list[BalanceRow] = []
    for part, entry in agg.items():
        in_po = int(entry.get("in_po", 0))
        balance = entry["ordered"] - entry["billed"] - in_po
        if balance > 0:
            item = items.get(part)
            rows.append(
                BalanceRow(
                    part_number=part,
                    item_name=item["name"] if item else "",
                    ordered_total=entry["ordered"],
                    billed_total=entry["billed"],
                    in_po_qty=in_po,
                    balance_qty=balance,
                    moq=int(item.get("moq", 1)) if item else 1,
                )
            )
    return sorted(rows, key=lambda r: r.part_number)


@router.post("/purchase-orders", response_model=POCreatedOut, status_code=201)
async def create_purchase_order(body: POCreate, _: dict = Depends(require_staff)):
    vendor = body.vendor.strip()
    if not vendor:
        raise HTTPException(422, "Vendor name is required")
    items = {d["part_number"]: d for d in await db.items.find({}).to_list(5000)}
    parts = {l.part_number for l in body.lines}
    refs: set[str] = set()
    for order in await db.orders.find({}).to_list(2000):
        for line in order.get("lines", []):
            if line["part_number"] in parts and int(line.get("billed_qty", 0)) < int(line.get("ordered_qty", 0)):
                refs.add(order.get("order_ref", ""))
    refs.discard("")
    order_date = body.order_date or today_iso()
    lines: list[dict] = []
    skipped = 0
    for line in body.lines:
        po_qty = line.balance_qty + line.voluntary_qty
        if po_qty <= 0:
            skipped += 1
            continue
        part = line.part_number.strip().upper()
        item = items.get(part)
        lines.append(
            {
                "id": str(uuid.uuid4()),
                "part_number": part,
                "item_name": line.item_name.strip() or (item["name"] if item else ""),
                "balance_qty": line.balance_qty,
                "voluntary_qty": line.voluntary_qty,
                "po_qty": po_qty,
                "expected_date": line.expected_date or body.expected_date,
            }
        )
    if not lines:
        raise HTTPException(422, "No lines with a positive PO quantity")
    doc = {
        "id": str(uuid.uuid4()),
        "po_number": await next_number(db, "po", "PO", 4),
        "reference_no": ", ".join(sorted(refs)),
        "order_date": order_date,
        "expected_date": body.expected_date,
        "vendor": vendor,
        "lines": lines,
        "status": "draft",
        "created_at": datetime.now(timezone.utc),
    }
    await db.purchase_orders.insert_one(doc)
    return POCreatedOut(created=1, skipped=skipped, orders=[po_to_out(doc)])


@router.get("/purchase-orders", response_model=list[PurchaseOrderOut])
async def list_purchase_orders(_: dict = Depends(require_staff)):
    docs = await db.purchase_orders.find({}).sort("created_at", -1).to_list(1000)
    return [po_to_out(d) for d in docs]


@router.get("/purchase-orders/{po_id}", response_model=PurchaseOrderOut)
async def get_purchase_order(po_id: str, _: dict = Depends(require_staff)):
    doc = await db.purchase_orders.find_one({"id": po_id})
    if not doc:
        raise HTTPException(404, "Purchase order not found")
    return po_to_out(doc)


@router.patch("/purchase-orders/{po_id}", response_model=PurchaseOrderOut)
async def update_purchase_order(po_id: str, body: POStatusUpdate, _: dict = Depends(require_staff)):
    if body.status not in VALID_PO_STATUSES:
        raise HTTPException(422, f"Status must be one of {', '.join(VALID_PO_STATUSES)}")
    doc = await db.purchase_orders.find_one({"id": po_id})
    if not doc:
        raise HTTPException(404, "Purchase order not found")
    await db.purchase_orders.update_one({"id": po_id}, {"$set": {"status": body.status}})
    doc = await db.purchase_orders.find_one({"id": po_id})
    return po_to_out(doc)


@router.get("/purchase-orders/{po_id}/export")
async def export_purchase_order(po_id: str, _: dict = Depends(require_staff)):
    doc = await db.purchase_orders.find_one({"id": po_id})
    if not doc:
        raise HTTPException(404, "Purchase order not found")
    po = po_to_out(doc)
    workbook = Workbook()
    sheet = workbook.active
    sheet.title = "Purchase Order"
    bold = Font(bold=True)
    sheet.append(["PURCHASE ORDER — DMS UPLOAD FORMAT"])
    sheet["A1"].font = Font(bold=True, size=14)
    sheet.append([])
    sheet.append(["PO Number", po.po_number])
    sheet.append(["Reference No", po.reference_no])
    sheet.append(["Order Date", po.order_date])
    sheet.append(["Expected Delivery", po.expected_date])
    sheet.append(["Vendor", po.vendor])
    sheet.append([])
    sheet.append(["Sr", "Part Number", "Item Name", "PO Qty", "Voluntary Qty", "Balance Qty", "Rate (NDP)", "Value", "Expected Date"])
    for cell in sheet[9]:
        cell.font = bold
    total_value = 0.0
    for index, line in enumerate(po.lines, 1):
        item = await db.items.find_one({"part_number": line.part_number}, {"ndp": 1}) or {}
        rate = float(item.get("ndp", 0.0) or 0.0)
        value = round(rate * line.po_qty, 2)
        total_value += value
        sheet.append([index, line.part_number, line.item_name, line.po_qty, line.voluntary_qty, line.balance_qty, rate, value, line.expected_date])
    sheet.append([])
    total_row = sheet.max_row + 1
    sheet.append(["", "", "", "", "", "Total", "", total_value, ""])
    sheet[f"F{total_row}"].font = bold
    sheet[f"H{total_row}"].font = bold
    for column, width in zip("ABCDEFGHI", (6, 16, 28, 10, 12, 12, 12, 14, 16)):
        sheet.column_dimensions[column].width = width
    out = io.BytesIO()
    workbook.save(out)
    return Response(
        content=out.getvalue(),
        media_type=excelio.XLSX_MIME,
        headers={"Content-Disposition": f'attachment; filename="{po.po_number}-DMS.xlsx"'},
    )
