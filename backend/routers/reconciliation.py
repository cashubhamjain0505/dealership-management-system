"""Firm X -> Firm Y reconciliation: material received in Firm Y vs invoices raised by Firm X."""

import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Response, UploadFile
from pydantic import BaseModel

from lib import excelio
from lib.db import db
from lib.dates import today_iso
from lib.helpers import clean
from models.reconciliation import (
    FirmXInvoiceCreate,
    FirmXInvoiceOut,
    FirmXLineOut,
    ReconRow,
    ReconSummary,
)
from routers.auth import require_staff

router = APIRouter(tags=["reconciliation"])


def _firmx_to_out(doc: dict) -> FirmXInvoiceOut:
    data = clean(doc)
    lines = [FirmXLineOut(**line) for line in data.get("lines", [])]
    return FirmXInvoiceOut(
        id=data["id"],
        invoice_no=data["invoice_no"],
        invoice_date=data.get("invoice_date", ""),
        notes=data.get("notes", ""),
        lines=lines,
        total=round(sum(line.amount for line in lines), 2),
        created_at=str(data.get("created_at", "")),
    )


async def _build_lines(raw_lines: list[dict]) -> list[dict]:
    items = {d["part_number"]: d for d in await db.items.find({}, {"part_number": 1, "name": 1}).to_list(5000)}
    lines: list[dict] = []
    for raw in raw_lines:
        part = str(raw["part_number"]).strip().upper()
        qty = int(raw.get("qty", 0))
        rate = float(raw.get("rate", 0.0) or 0.0)
        lines.append(
            {
                "id": str(uuid.uuid4()),
                "part_number": part,
                "item_name": raw.get("item_name") or (items[part]["name"] if part in items else ""),
                "qty": qty,
                "rate": rate,
                "amount": round(qty * rate, 2),
            }
        )
    return lines


@router.get("/firmx-invoices", response_model=list[FirmXInvoiceOut])
async def list_firmx_invoices(_: dict = Depends(require_staff)):
    docs = await db.firmx_invoices.find({}).sort("created_at", -1).to_list(2000)
    return [_firmx_to_out(d) for d in docs]


@router.post("/firmx-invoices", response_model=FirmXInvoiceOut, status_code=201)
async def create_firmx_invoice(body: FirmXInvoiceCreate, _: dict = Depends(require_staff)):
    number = body.invoice_no.strip()
    if not number:
        raise HTTPException(422, "Firm X invoice number is required")
    if await db.firmx_invoices.find_one({"invoice_no": number}):
        raise HTTPException(409, f"Firm X invoice {number} already entered")
    doc = {
        "id": str(uuid.uuid4()),
        "invoice_no": number,
        "invoice_date": body.invoice_date or today_iso(),
        "notes": body.notes.strip(),
        "lines": await _build_lines([line.model_dump() for line in body.lines]),
        "created_at": datetime.now(timezone.utc),
    }
    await db.firmx_invoices.insert_one(doc)
    return _firmx_to_out(doc)


@router.delete("/firmx-invoices/{invoice_id}")
async def delete_firmx_invoice(invoice_id: str, _: dict = Depends(require_staff)):
    result = await db.firmx_invoices.delete_one({"id": invoice_id})
    if not result.deleted_count:
        raise HTTPException(404, "Firm X invoice not found")
    return {"ok": True}


class FirmXUploadResult(BaseModel):
    created: int = 0
    lines: int = 0
    skipped: int = 0
    errors: list[str] = []


@router.post("/firmx-invoices/upload", response_model=FirmXUploadResult)
async def upload_firmx_invoices(file: UploadFile, _: dict = Depends(require_staff)):
    """Key the figures off Firm X's PDF into this sheet (or export it from Firm X's books)."""
    rows = excelio.load_rows(await file.read())
    result = FirmXUploadResult()
    groups: dict[str, dict] = {}
    for index, row in enumerate(rows, 2):
        number = excelio.as_str(excelio.pick(row, "invoice no", "invoice number", "firm x invoice no", "bill no"))
        part = excelio.as_str(excelio.pick(row, "part number", "part no")).upper()
        qty = excelio.as_int(excelio.pick(row, "qty", "quantity", "billed qty"))
        if not number or not part or qty <= 0:
            result.skipped += 1
            result.errors.append(f"row {index}: invoice no, part number and qty > 0 are required")
            continue
        group = groups.setdefault(
            number,
            {"date": excelio.as_date(excelio.pick(row, "invoice date", "date")), "lines": []},
        )
        group["lines"].append(
            {
                "part_number": part,
                "item_name": excelio.as_str(excelio.pick(row, "item name", "name")),
                "qty": qty,
                "rate": excelio.as_float(excelio.pick(row, "rate", "unit price", "price")),
            }
        )
    for number, group in groups.items():
        if await db.firmx_invoices.find_one({"invoice_no": number}):
            result.skipped += len(group["lines"])
            result.errors.append(f"invoice {number}: already entered — skipped")
            continue
        doc = {
            "id": str(uuid.uuid4()),
            "invoice_no": number,
            "invoice_date": group["date"] or today_iso(),
            "notes": "",
            "lines": await _build_lines(group["lines"]),
            "created_at": datetime.now(timezone.utc),
        }
        await db.firmx_invoices.insert_one(doc)
        result.created += 1
        result.lines += len(doc["lines"])
    return result


async def _recon_rows() -> tuple[list[ReconRow], int]:
    """Received (Firm Y, approved vendor invoices) vs billed (Firm X invoices), per part."""
    items = {d["part_number"]: d for d in await db.items.find({}, {"part_number": 1, "name": 1}).to_list(5000)}
    received: dict[str, dict] = {}
    async for vi in db.vendor_invoices.find({"status": "received"}, {"lines": 1}):
        for line in vi.get("lines", []):
            qty = int(line.get("received_qty", 0))
            if qty <= 0:
                continue
            part = line.get("part_number", "")
            entry = received.setdefault(part, {"qty": 0, "value": 0.0})
            entry["qty"] += qty
            entry["value"] += qty * float(line.get("unit_price", 0.0) or 0.0)

    billed: dict[str, dict] = {}
    invoice_count = 0
    async for invoice in db.firmx_invoices.find({}, {"lines": 1}):
        invoice_count += 1
        for line in invoice.get("lines", []):
            part = line.get("part_number", "")
            entry = billed.setdefault(part, {"qty": 0, "value": 0.0})
            entry["qty"] += int(line.get("qty", 0))
            entry["value"] += float(line.get("amount", 0.0) or 0.0)

    rows: list[ReconRow] = []
    for part in sorted(set(received) | set(billed)):
        received_qty = int(received.get(part, {}).get("qty", 0))
        billed_qty = int(billed.get(part, {}).get("qty", 0))
        difference = received_qty - billed_qty
        status = "matched" if difference == 0 else ("to_be_billed" if difference > 0 else "over_billed")
        received_value = round(received.get(part, {}).get("value", 0.0), 2)
        billed_value = round(billed.get(part, {}).get("value", 0.0), 2)
        rows.append(
            ReconRow(
                part_number=part,
                item_name=items.get(part, {}).get("name", ""),
                received_qty=received_qty,
                billed_qty=billed_qty,
                difference=difference,
                status=status,
                received_value=received_value,
                billed_value=billed_value,
                value_difference=round(received_value - billed_value, 2),
            )
        )
    # Differences first — that is the actionable part of the report.
    rows.sort(key=lambda r: (r.status == "matched", -abs(r.difference), r.part_number))
    return rows, invoice_count


@router.get("/reconciliation", response_model=ReconSummary)
async def reconciliation(_: dict = Depends(require_staff)):
    rows, invoice_count = await _recon_rows()
    return ReconSummary(
        rows=rows,
        to_be_billed_parts=sum(1 for r in rows if r.status == "to_be_billed"),
        over_billed_parts=sum(1 for r in rows if r.status == "over_billed"),
        matched_parts=sum(1 for r in rows if r.status == "matched"),
        to_be_billed_qty=sum(r.difference for r in rows if r.difference > 0),
        over_billed_qty=sum(-r.difference for r in rows if r.difference < 0),
        to_be_billed_value=round(sum(r.value_difference for r in rows if r.difference > 0), 2),
        firmx_invoice_count=invoice_count,
    )


@router.get("/reconciliation/export")
async def export_reconciliation(_: dict = Depends(require_staff)):
    rows, _count = await _recon_rows()
    content = excelio.build_xlsx(
        "Reconciliation",
        [
            "Part Number",
            "Item Name",
            "Received in Firm Y",
            "Billed by Firm X",
            "Difference (Qty)",
            "Status",
            "Received Value",
            "Billed Value",
            "Value Difference",
        ],
        [
            [
                row.part_number,
                row.item_name,
                row.received_qty,
                row.billed_qty,
                row.difference,
                row.status.replace("_", " "),
                row.received_value,
                row.billed_value,
                row.value_difference,
            ]
            for row in rows
        ],
        [16, 30, 18, 18, 16, 14, 16, 16, 16],
    )
    return Response(
        content=content,
        media_type=excelio.XLSX_MIME,
        headers={
            "Content-Disposition": f'attachment; filename="firmx-firmy-reconciliation-{today_iso()}.xlsx"'
        },
    )
