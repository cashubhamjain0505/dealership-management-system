"""Command-center aggregates: pending work, discrepancies, low stock, stock value."""

from fastapi import APIRouter, Depends
from pydantic import BaseModel

from lib.db import db
from lib.helpers import reserved_by_part
from routers.auth import require_staff

router = APIRouter(tags=["dashboard"])


class LowStockRow(BaseModel):
    part_number: str
    item_name: str
    free_qty: int
    demand_qty: int


class DiscrepancyRow(BaseModel):
    vendor_invoice_no: str
    part_number: str
    item_name: str
    tag_mrp: float | None
    system_mrp: float | None
    variance_percent: float | None


class DashboardOut(BaseModel):
    pending_orders: int
    ready_to_bill_orders: int
    ready_to_bill_qty: int
    open_purchase_orders: int
    allocated_not_received: int
    short_pending: int
    mrp_discrepancies: int
    stock_value: float
    low_stock: list[LowStockRow]
    discrepancies: list[DiscrepancyRow]


@router.get("/dashboard", response_model=DashboardOut)
async def dashboard(_: dict = Depends(require_staff)):
    orders = await db.orders.find({}).to_list(2000)
    pending_orders = 0
    ready_orders = 0
    ready_qty = 0
    demand: dict[str, int] = {}
    for order in orders:
        has_pending = has_ready = False
        for line in order.get("lines", []):
            ordered = int(line.get("ordered_qty", 0))
            billed = int(line.get("billed_qty", 0))
            allocated = int(line.get("allocated_qty", 0))
            if billed < ordered:
                has_pending = True
                part = line["part_number"]
                demand[part] = demand.get(part, 0) + (ordered - billed)
            if allocated - billed > 0:
                has_ready = True
                ready_qty += allocated - billed
        pending_orders += 1 if has_pending else 0
        ready_orders += 1 if has_ready else 0

    open_pos = await db.purchase_orders.count_documents({"status": {"$in": ["draft", "sent", "partially_received"]}})
    allocated_not_received = await db.vendor_invoices.count_documents({"status": "allocated_not_received"})
    short_pending = await db.short_items.count_documents({"status": "pending"})

    items = {d["part_number"]: d for d in await db.items.find({}).to_list(5000)}
    stock = {d["part_number"]: int(d.get("qty", 0)) for d in await db.stock.find({}).to_list(5000)}
    reserved = await reserved_by_part(db)
    stock_value = 0.0
    for part, qty in stock.items():
        item = items.get(part, {})
        rate = float(item.get("tag_mrp") or item.get("mrp") or 0.0)
        stock_value += qty * rate

    low_stock = [
        LowStockRow(
            part_number=part,
            item_name=items.get(part, {}).get("name", ""),
            free_qty=max(stock.get(part, 0) - reserved.get(part, 0), 0),
            demand_qty=qty,
        )
        for part, qty in sorted(demand.items())
        if max(stock.get(part, 0) - reserved.get(part, 0), 0) < qty
    ][:20]

    discrepancies: list[DiscrepancyRow] = []
    async for vi in db.vendor_invoices.find({}).sort("created_at", -1):
        for line in vi.get("lines", []):
            if line.get("variance_flag"):
                discrepancies.append(
                    DiscrepancyRow(
                        vendor_invoice_no=vi.get("vendor_invoice_no", ""),
                        part_number=line.get("part_number", ""),
                        item_name=line.get("item_name", ""),
                        tag_mrp=line.get("tag_mrp"),
                        system_mrp=line.get("system_mrp"),
                        variance_percent=line.get("variance_percent"),
                    )
                )
    mrp_discrepancies = len(discrepancies)

    return DashboardOut(
        pending_orders=pending_orders,
        ready_to_bill_orders=ready_orders,
        ready_to_bill_qty=ready_qty,
        open_purchase_orders=open_pos,
        allocated_not_received=allocated_not_received,
        short_pending=short_pending,
        mrp_discrepancies=mrp_discrepancies,
        stock_value=round(stock_value, 2),
        low_stock=low_stock,
        discrepancies=discrepancies[:10],
    )
