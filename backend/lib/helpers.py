"""Shared backend helpers: doc cleaning, sequences, MRP math, variance."""

import random
from datetime import datetime, timedelta, timezone
from typing import Any

from motor.motor_asyncio import AsyncIOMotorDatabase
from pymongo import ReturnDocument

from models.masters import mrp_from_ndp  # re-exported for routers

__all__ = ["clean", "next_number", "mrp_from_ndp", "mrp_variance", "rand_digits", "clean_doc_list"]


def clean(doc: dict[str, Any] | None) -> dict[str, Any]:
    """Strip Mongo's _id so the dict can feed a Pydantic model / JSON body."""
    if not doc:
        return {}
    out = dict(doc)
    out.pop("_id", None)
    for key, value in list(out.items()):
        if isinstance(value, datetime):
            out[key] = value
    return out


def clean_doc_list(docs: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return [clean(d) for d in docs]


async def next_number(db: AsyncIOMotorDatabase, key: str, prefix: str, width: int = 4) -> str:
    """System generated sequential document numbers, e.g. PO-2026-0001."""
    doc = await db.counters.find_one_and_update(
        {"_id": key},
        {"$inc": {"seq": 1}},
        upsert=True,
        return_document=ReturnDocument.AFTER,
    )
    year = datetime.now(timezone.utc).year
    return f"{prefix}-{year}-{doc['seq']:0{width}d}"


def mrp_variance(system_mrp: float | None, tag_mrp: float | None) -> tuple[float | None, bool]:
    """Return (variance_fraction, flagged). Flag when |system - tag| / tag > 1%."""
    if not system_mrp or not tag_mrp or tag_mrp <= 0:
        return None, False
    variance = abs(system_mrp - tag_mrp) / tag_mrp
    return round(variance, 4), variance > 0.01


def rand_digits(n: int) -> str:
    return "".join(str(random.randint(0, 9)) for _ in range(n))


def ews_valid_till(days: int = 1) -> str:
    return (datetime.now(timezone.utc) + timedelta(days=days)).strftime("%Y-%m-%d")


async def reserved_by_part(db, exclude_order_id: str | None = None) -> dict[str, int]:
    """Reserved = allocated on customer orders but not yet billed, per part number."""
    query: dict = {"id": {"$ne": exclude_order_id}} if exclude_order_id else {}
    reserved: dict[str, int] = {}
    async for order in db.orders.find(query, {"lines.allocated_qty": 1, "lines.billed_qty": 1, "lines.part_number": 1}):
        for line in order.get("lines", []):
            qty = int(line.get("allocated_qty", 0) or 0) - int(line.get("billed_qty", 0) or 0)
            if qty > 0:
                part = line.get("part_number", "")
                reserved[part] = reserved.get(part, 0) + qty
    return reserved
