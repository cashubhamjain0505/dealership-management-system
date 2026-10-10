"""Warehouse stock: on-hand vs reserved (allocated, unbilled) vs free, plus adjustments."""

from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from lib.db import db
from lib.helpers import reserved_by_part
from routers.auth import require_staff

router = APIRouter(tags=["stock"])


class StockRow(BaseModel):
    part_number: str
    item_name: str
    qty: int
    reserved: int
    free: int
    unit: str
    tag_mrp: float | None
    mrp: float
    moq: int


class StockAdjustIn(BaseModel):
    part_number: str
    delta_qty: int
    reason: str = ""


@router.get("/stock", response_model=list[StockRow])
async def list_stock(_: dict = Depends(require_staff)):
    items = {d["part_number"]: d for d in await db.items.find({}).to_list(5000)}
    stock = {d["part_number"]: int(d.get("qty", 0)) for d in await db.stock.find({}).to_list(5000)}
    reserved = await reserved_by_part(db)
    rows: list[StockRow] = []
    for part in sorted(set(stock) | set(items)):
        item = items.get(part)
        qty = stock.get(part, 0)
        res = reserved.get(part, 0)
        rows.append(
            StockRow(
                part_number=part,
                item_name=item["name"] if item else "",
                qty=qty,
                reserved=res,
                free=max(qty - res, 0),
                unit=item.get("unit", "PCS") if item else "PCS",
                tag_mrp=item.get("tag_mrp") if item else None,
                mrp=float(item.get("mrp", 0.0) or 0.0) if item else 0.0,
                moq=int(item.get("moq", 1)) if item else 1,
            )
        )
    return rows


@router.post("/stock/adjust", response_model=StockRow)
async def adjust_stock(body: StockAdjustIn, _: dict = Depends(require_staff)):
    part = body.part_number.strip().upper()
    item = await db.items.find_one({"part_number": part})
    if not item:
        raise HTTPException(404, f"{part} not found in item master")
    doc = await db.stock.find_one({"part_number": part})
    current = int(doc.get("qty", 0)) if doc else 0
    new_qty = max(current + body.delta_qty, 0)
    await db.stock.update_one(
        {"part_number": part},
        {"$set": {"qty": new_qty, "updated_at": datetime.now(timezone.utc)}},
        upsert=True,
    )
    reserved = (await reserved_by_part(db)).get(part, 0)
    return StockRow(
        part_number=part,
        item_name=item["name"],
        qty=new_qty,
        reserved=reserved,
        free=max(new_qty - reserved, 0),
        unit=item.get("unit", "PCS"),
        tag_mrp=item.get("tag_mrp"),
        mrp=float(item.get("mrp", 0.0) or 0.0),
        moq=int(item.get("moq", 1)),
    )
