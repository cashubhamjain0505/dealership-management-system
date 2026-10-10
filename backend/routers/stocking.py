"""N-day stock predictor: sales history (Tally upload + in-app invoices) -> stock requirement -> PO."""

import math
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, UploadFile
from pydantic import BaseModel

from lib import excelio
from lib.db import db
from lib.dates import today_iso
from lib.helpers import next_number, reserved_by_part
from models.purchase import PurchaseOrderOut
from models.stocking import (
    GeneratePoIn,
    PartyContribution,
    PartyPolicy,
    SalesUploadResult,
    StockPolicy,
    StockPolicyIn,
    StockRequirementOut,
    StockRequirementRow,
)
from routers.auth import require_staff
from routers.purchase import po_to_out

router = APIRouter(tags=["stocking"])

POLICY_ID = "stock_policy"


async def _load_policy() -> dict:
    doc = await db.settings.find_one({"_id": POLICY_ID})
    return doc or {"_id": POLICY_ID, "default_days": 14, "parties": []}


@router.get("/stocking/policy", response_model=StockPolicy)
async def get_policy(_: dict = Depends(require_staff)):
    """Current policy, merged with the customer master so every party is selectable."""
    policy = await _load_policy()
    saved = {p["customer_code"]: p for p in policy.get("parties", [])}
    parties: list[PartyPolicy] = []
    for customer in await db.customers.find({}).sort("code", 1).to_list(5000):
        existing = saved.get(customer["code"], {})
        parties.append(
            PartyPolicy(
                customer_code=customer["code"],
                customer_name=customer.get("name", ""),
                # Default: include every party until staff deselects it.
                include=bool(existing.get("include", True)),
                days=existing.get("days"),
            )
        )
    return StockPolicy(default_days=int(policy.get("default_days", 14)), parties=parties)


@router.put("/stocking/policy", response_model=StockPolicy)
async def update_policy(body: StockPolicyIn, _: dict = Depends(require_staff)):
    await db.settings.update_one(
        {"_id": POLICY_ID},
        {
            "$set": {
                "default_days": body.default_days,
                "parties": [p.model_dump() for p in body.parties],
                "updated_at": datetime.now(timezone.utc),
            }
        },
        upsert=True,
    )
    return await get_policy()


@router.post("/stocking/sales-upload", response_model=SalesUploadResult)
async def upload_sales_history(file: UploadFile, _: dict = Depends(require_staff)):
    """One-time (or repeatable) upload of past Tally sales invoices used as the sales baseline."""
    rows = excelio.load_rows(await file.read())
    items = {d["part_number"] for d in await db.items.find({}, {"part_number": 1}).to_list(5000)}
    customers = {
        d["name"].strip().lower(): d["code"]
        for d in await db.customers.find({}, {"code": 1, "name": 1}).to_list(5000)
    }
    result = SalesUploadResult()
    unknown: set[str] = set()
    batch: list[dict] = []
    for index, row in enumerate(rows, 2):
        part = excelio.as_str(excelio.pick(row, "part number", "part no", "item code")).upper()
        qty = excelio.as_int(excelio.pick(row, "qty", "quantity", "billed qty", "sold qty"))
        if not part or qty <= 0:
            result.skipped += 1
            result.errors.append(f"row {index}: part number and qty > 0 are required")
            continue
        if part not in items:
            unknown.add(part)
        code = excelio.as_str(excelio.pick(row, "customer code", "party code", "code")).upper()
        name = excelio.as_str(excelio.pick(row, "customer name", "party name", "party", "customer"))
        if not code and name:
            code = customers.get(name.strip().lower(), "")
        invoice_no = excelio.as_str(excelio.pick(row, "invoice no", "invoice number", "voucher no", "bill no"))
        date = excelio.as_date(excelio.pick(row, "invoice date", "date", "voucher date")) or today_iso()
        batch.append(
            {
                "id": str(uuid.uuid4()),
                "source": "tally",
                "invoice_no": invoice_no,
                "date": date,
                "part_number": part,
                "qty": qty,
                "customer_code": code,
                "customer_name": name,
                "created_at": datetime.now(timezone.utc),
            }
        )
    if batch:
        await db.sales_history.insert_many(batch)
        result.created = len(batch)
    result.unknown_parts = sorted(unknown)[:20]
    if unknown:
        result.errors.append(
            f"{len(unknown)} part(s) are not in the item master yet — they are stored but excluded from the stock plan"
        )
    return result


class SalesHistoryStats(BaseModel):
    tally_rows: int
    tally_qty: int
    period_from: str
    period_to: str


@router.get("/stocking/sales-history", response_model=SalesHistoryStats)
async def sales_history_stats(_: dict = Depends(require_staff)):
    rows = await db.sales_history.find({}, {"qty": 1, "date": 1}).to_list(50000)
    dates = sorted(r.get("date", "") for r in rows if r.get("date"))
    return SalesHistoryStats(
        tally_rows=len(rows),
        tally_qty=sum(int(r.get("qty", 0)) for r in rows),
        period_from=dates[0] if dates else "",
        period_to=dates[-1] if dates else "",
    )


@router.delete("/stocking/sales-history")
async def clear_sales_history(_: dict = Depends(require_staff)):
    result = await db.sales_history.delete_many({"source": "tally"})
    return {"deleted": result.deleted_count}


def _days_between(start: str, end: str) -> int:
    try:
        a = datetime.strptime(start, "%Y-%m-%d")
        b = datetime.strptime(end, "%Y-%m-%d")
        return max((b - a).days + 1, 1)
    except ValueError:
        return 1


async def _collect_sales() -> tuple[list[dict], int, int]:
    """Sales lines from the Tally upload plus every invoice raised in the app."""
    sales: list[dict] = []
    tally = await db.sales_history.find({}).to_list(50000)
    for row in tally:
        sales.append(
            {
                "part_number": row.get("part_number", ""),
                "qty": int(row.get("qty", 0)),
                "date": row.get("date", ""),
                "customer_code": row.get("customer_code", ""),
                "customer_name": row.get("customer_name", ""),
            }
        )
    app_rows = 0
    async for invoice in db.invoices.find({}, {"lines": 1, "invoice_date": 1, "customer": 1}):
        customer = invoice.get("customer", {})
        for line in invoice.get("lines", []):
            app_rows += 1
            sales.append(
                {
                    "part_number": line.get("part_number", ""),
                    "qty": int(line.get("qty", 0)),
                    "date": invoice.get("invoice_date", ""),
                    "customer_code": customer.get("code", ""),
                    "customer_name": customer.get("name", ""),
                }
            )
    return sales, len(tally), app_rows


@router.get("/stocking/requirement", response_model=StockRequirementOut)
async def stock_requirement(_: dict = Depends(require_staff)):
    """Per-part stock target = Σ over included parties of (that party's daily average × its days),
    rounded up to the item MOQ, less free stock and quantities already on open stock POs."""
    policy = await _load_policy()
    default_days = int(policy.get("default_days", 14))
    saved = {p["customer_code"]: p for p in policy.get("parties", [])}

    sales, tally_rows, app_rows = await _collect_sales()
    items = {d["part_number"]: d for d in await db.items.find({}).to_list(5000)}
    stock = {d["part_number"]: int(d.get("qty", 0)) for d in await db.stock.find({}).to_list(5000)}
    reserved = await reserved_by_part(db)

    open_po: dict[str, int] = {}
    async for po in db.purchase_orders.find({"status": {"$in": ["draft", "sent", "partially_received"]}}):
        for line in po.get("lines", []):
            part = line.get("part_number", "")
            open_po[part] = open_po.get(part, 0) + int(line.get("po_qty", 0))

    dates = sorted(s["date"] for s in sales if s.get("date"))
    period_from = dates[0] if dates else ""
    period_to = dates[-1] if dates else ""
    period_days = _days_between(period_from, today_iso()) if period_from else 1

    def party_days(code: str) -> int:
        entry = saved.get(code, {})
        value = entry.get("days")
        return int(value) if value else default_days

    def included(code: str) -> bool:
        # Unknown/blank party codes still count toward demand under the default policy.
        entry = saved.get(code)
        return bool(entry.get("include", True)) if entry else True

    # part -> party -> qty
    grouped: dict[str, dict[str, dict]] = {}
    for sale in sales:
        part = sale["part_number"]
        if part not in items or not included(sale["customer_code"]):
            continue
        party = grouped.setdefault(part, {}).setdefault(
            sale["customer_code"] or "—",
            {"name": sale["customer_name"] or sale["customer_code"] or "Other", "qty": 0},
        )
        party["qty"] += sale["qty"]

    rows: list[StockRequirementRow] = []
    for part, parties in grouped.items():
        item = items[part]
        moq = max(int(item.get("moq", 1) or 1), 1)
        contributions: list[PartyContribution] = []
        raw_requirement = 0.0
        total_qty = 0
        for code, info in sorted(parties.items()):
            avg_daily = info["qty"] / period_days
            days = party_days(code)
            requirement = avg_daily * days
            raw_requirement += requirement
            total_qty += info["qty"]
            contributions.append(
                PartyContribution(
                    customer_code=code,
                    customer_name=info["name"],
                    qty_sold=info["qty"],
                    avg_daily=round(avg_daily, 3),
                    days=days,
                    requirement=round(requirement, 2),
                )
            )
        target = int(math.ceil(raw_requirement / moq) * moq) if raw_requirement > 0 else 0
        on_hand = stock.get(part, 0)
        free = max(on_hand - reserved.get(part, 0), 0)
        in_po = open_po.get(part, 0)
        to_order_raw = target - free - in_po
        to_order = int(math.ceil(to_order_raw / moq) * moq) if to_order_raw > 0 else 0
        rows.append(
            StockRequirementRow(
                part_number=part,
                item_name=item.get("name", ""),
                moq=moq,
                qty_sold=total_qty,
                avg_daily=round(total_qty / period_days, 3),
                raw_requirement=round(raw_requirement, 2),
                requirement=target,
                on_hand=on_hand,
                free=free,
                in_open_po=in_po,
                to_order=to_order,
                parties=contributions,
            )
        )
    rows.sort(key=lambda r: (-r.to_order, r.part_number))
    return StockRequirementOut(
        default_days=default_days,
        period_days=period_days,
        period_from=period_from,
        period_to=period_to or today_iso(),
        tally_rows=tally_rows,
        app_invoice_rows=app_rows,
        included_parties=sum(1 for code in saved if included(code)) or len(saved),
        rows=rows,
    )


@router.post("/stocking/generate-po", response_model=PurchaseOrderOut, status_code=201)
async def generate_stock_po(body: GeneratePoIn, _: dict = Depends(require_staff)):
    vendor = body.vendor.strip()
    if not vendor:
        raise HTTPException(422, "Vendor name is required")
    plan = await stock_requirement()
    wanted = {p.strip().upper() for p in body.part_numbers}
    lines = [
        {
            "id": str(uuid.uuid4()),
            "part_number": row.part_number,
            "item_name": row.item_name,
            "balance_qty": row.to_order,
            "voluntary_qty": 0,
            "po_qty": row.to_order,
            "expected_date": body.expected_date,
        }
        for row in plan.rows
        if row.part_number in wanted and row.to_order > 0
    ]
    if not lines:
        raise HTTPException(422, "Nothing to order for the selected parts — stock already covers the plan")
    doc = {
        "id": str(uuid.uuid4()),
        "po_number": await next_number(db, "po", "PO", 4),
        "reference_no": f"{plan.default_days}-day stock plan",
        "order_date": today_iso(),
        "expected_date": body.expected_date,
        "vendor": vendor,
        "lines": lines,
        "status": "draft",
        # Tagged so the customer-order balance screen never nets these off against customer demand.
        "po_type": "stock",
        "created_at": datetime.now(timezone.utc),
    }
    await db.purchase_orders.insert_one(doc)
    return po_to_out(doc)
