"""Sales billing: GST invoices from allocated order lines, tag-MRP pricing, IRN + e-way bill."""

import hashlib
import os
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException

from lib.db import db
from lib.dates import today_iso
from lib.helpers import clean, ews_valid_till, next_number, rand_digits
from models.invoices import (
    EwbIn,
    EwbInfo,
    HsnSummaryRow,
    InvLineOut,
    InvoiceCreate,
    InvoiceTotals,
    IrnInfo,
    SalesInvoiceOut,
)
from models.orders import CustomerSnapshot, OrderOut
from routers.auth import require_staff
from routers.orders import _items_by_part, order_to_out

router = APIRouter(tags=["billing"])


def invoice_to_out(doc: dict) -> SalesInvoiceOut:
    data = clean(doc)
    return SalesInvoiceOut(
        id=data["id"],
        invoice_no=data["invoice_no"],
        invoice_date=data.get("invoice_date", ""),
        order_id=data.get("order_id", ""),
        order_ref=data.get("order_ref", ""),
        customer=CustomerSnapshot(**data["customer"]),
        lines=[InvLineOut(**l) for l in data.get("lines", [])],
        hsn_summary=[HsnSummaryRow(**h) for h in data.get("hsn_summary", [])],
        totals=InvoiceTotals(**data["totals"]),
        irn=IrnInfo(**data["irn"]) if data.get("irn") else None,
        ewb=EwbInfo(**data["ewb"]) if data.get("ewb") else None,
        status=data.get("status", "issued"),
        supply_type=data.get("supply_type", "intra"),
        created_at=str(data.get("created_at", "")),
    )


@router.get("/billing/ready", response_model=list[OrderOut])
async def ready_to_bill(_: dict = Depends(require_staff)):
    docs = await db.orders.find({}).sort("created_at", -1).to_list(2000)
    items = await _items_by_part()
    outs = [order_to_out(d, items) for d in docs]
    return [o for o in outs if any(l.allocated_qty - l.billed_qty > 0 for l in o.lines)]


@router.get("/invoices", response_model=list[SalesInvoiceOut])
async def list_invoices(_: dict = Depends(require_staff)):
    docs = await db.invoices.find({}).sort("created_at", -1).to_list(1000)
    return [invoice_to_out(d) for d in docs]


@router.get("/invoices/{invoice_id}", response_model=SalesInvoiceOut)
async def get_invoice(invoice_id: str, _: dict = Depends(require_staff)):
    doc = await db.invoices.find_one({"id": invoice_id})
    if not doc:
        raise HTTPException(404, "Invoice not found")
    return invoice_to_out(doc)


@router.post("/invoices", response_model=SalesInvoiceOut, status_code=201)
async def create_invoice(body: InvoiceCreate, _: dict = Depends(require_staff)):
    order = await db.orders.find_one({"id": body.order_id})
    if not order:
        raise HTTPException(404, "Order not found")
    line_map = {l["id"]: l for l in order.get("lines", [])}
    for req in body.lines:
        line = line_map.get(req.line_id)
        if not line:
            raise HTTPException(422, "Unknown order line")
        free_to_bill = int(line.get("allocated_qty", 0)) - int(line.get("billed_qty", 0))
        if req.qty > free_to_bill:
            raise HTTPException(422, f"{line['part_number']}: only {max(free_to_bill, 0)} allocated unit(s) left to bill")

    # Bill-to: the ordering customer, or a different one chosen by staff.
    customer_doc: dict | None = None
    if body.bill_to_customer_code and body.bill_to_customer_code.strip():
        customer_doc = await db.customers.find_one({"code": body.bill_to_customer_code.strip().upper()})
        if not customer_doc:
            raise HTTPException(422, f"Bill-to customer {body.bill_to_customer_code} not found")
    if customer_doc is None:
        customer_doc = await db.customers.find_one({"id": order["customer"]["id"]}) or dict(order["customer"])
    customer = CustomerSnapshot(
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

    items = await _items_by_part()
    seller_state = os.environ.get("SELLER_STATE_CODE", "09")
    invoice_no = await next_number(db, "invoice", "SI", 5)
    invoice_date = body.invoice_date or today_iso()
    supply_type = "intra" if (customer.state_code or seller_state) == seller_state else "inter"

    inv_lines: list[InvLineOut] = []
    for req in body.lines:
        src = line_map[req.line_id]
        part = src["part_number"]
        item = items.get(part)
        if not item:
            raise HTTPException(422, f"{part}: not found in item master — fix the part number or add an alternate")
        tag = item.get("tag_mrp")
        system = float(item.get("mrp", 0.0) or 0.0)
        if tag:
            rate, source = float(tag), "tag"
        elif system > 0:
            rate, source = system, "system"
        else:
            raise HTTPException(422, f"{part}: no MRP available — upload the price list first")
        gst_rate = float(item.get("gst_rate", 18.0))
        gross = round(req.qty * rate, 2)
        discount_amount = round(gross * customer.discount_percent / 100, 2)
        taxable = round(gross - discount_amount, 2)
        if supply_type == "intra":
            cgst = round(taxable * gst_rate / 200, 2)
            sgst = cgst
            igst = 0.0
        else:
            cgst = sgst = 0.0
            igst = round(taxable * gst_rate / 100, 2)
        inv_lines.append(
            InvLineOut(
                id=src["id"],
                part_number=part,
                item_name=src.get("item_name", ""),
                hsn=item.get("hsn", ""),
                qty=req.qty,
                unit=item.get("unit", "PCS"),
                rate=rate,
                rate_source=source,
                discount_percent=customer.discount_percent,
                taxable=taxable,
                gst_rate=gst_rate,
                cgst=cgst,
                sgst=sgst,
                igst=igst,
                amount=round(taxable + cgst + sgst + igst, 2),
            )
        )

    totals = InvoiceTotals(
        subtotal=round(sum(round(l.qty * l.rate, 2) for l in inv_lines), 2),
        discount_amount=round(sum(round(l.qty * l.rate * l.discount_percent / 100, 2) for l in inv_lines), 2),
        taxable=round(sum(l.taxable for l in inv_lines), 2),
        cgst=round(sum(l.cgst for l in inv_lines), 2),
        sgst=round(sum(l.sgst for l in inv_lines), 2),
        igst=round(sum(l.igst for l in inv_lines), 2),
        total=round(sum(l.amount for l in inv_lines), 2),
    )

    hsn_agg: dict[tuple[str, float], dict] = {}
    for l in inv_lines:
        key = (l.hsn or "-", l.gst_rate)
        agg = hsn_agg.setdefault(key, {"taxable": 0.0, "cgst": 0.0, "sgst": 0.0, "igst": 0.0})
        agg["taxable"] += l.taxable
        agg["cgst"] += l.cgst
        agg["sgst"] += l.sgst
        agg["igst"] += l.igst
    hsn_summary = [
        HsnSummaryRow(
            hsn=hsn,
            gst_rate=rate,
            taxable=round(v["taxable"], 2),
            cgst=round(v["cgst"], 2),
            sgst=round(v["sgst"], 2),
            igst=round(v["igst"], 2),
            total=round(v["taxable"] + v["cgst"] + v["sgst"] + v["igst"], 2),
        )
        for (hsn, rate), v in hsn_agg.items()
    ]

    doc = {
        "id": str(uuid.uuid4()),
        "invoice_no": invoice_no,
        "invoice_date": invoice_date,
        "order_id": order["id"],
        "order_ref": order.get("order_ref", ""),
        "customer": customer.model_dump(),
        "lines": [l.model_dump() for l in inv_lines],
        "hsn_summary": [h.model_dump() for h in hsn_summary],
        "totals": totals.model_dump(),
        "irn": None,
        "ewb": None,
        "status": "issued",
        "supply_type": supply_type,
        "created_at": datetime.now(timezone.utc),
    }
    await db.invoices.insert_one(doc)

    for req in body.lines:
        src = line_map[req.line_id]
        src["billed_qty"] = int(src.get("billed_qty", 0)) + req.qty
    await db.orders.update_one({"id": order["id"]}, {"$set": {"lines": order["lines"]}})
    for l in inv_lines:
        await db.stock.update_one(
            {"part_number": l.part_number},
            {"$inc": {"qty": -l.qty}, "$set": {"updated_at": datetime.now(timezone.utc)}},
            upsert=True,
        )
    return invoice_to_out(doc)


@router.post("/invoices/{invoice_id}/irn", response_model=SalesInvoiceOut)
async def generate_irn(invoice_id: str, _: dict = Depends(require_staff)):
    invoice = await db.invoices.find_one({"id": invoice_id})
    if not invoice:
        raise HTTPException(404, "Invoice not found")
    if invoice.get("irn"):
        return invoice_to_out(invoice)  # idempotent — never register twice
    if os.environ.get("GST_MODE", "simulated") == "live":
        raise HTTPException(
            502,
            "Live GSP credentials are not configured. Set GST_API_BASE_URL and provider credentials in backend/.env, "
            "or keep GST_MODE=simulated.",
        )
    key = f"{os.environ.get('SELLER_GSTIN', '')}|{invoice['invoice_no']}|{invoice['invoice_date']}"
    irn = hashlib.sha256(key.encode()).hexdigest()
    info = IrnInfo(
        irn=irn,
        ack_no=rand_digits(12),
        ack_date=datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S"),
        qr_payload=f"IRN:{irn}|INV:{invoice['invoice_no']}|AMT:{invoice['totals']['total']}",
        simulated=True,
    )
    await db.invoices.update_one({"id": invoice_id}, {"$set": {"irn": info.model_dump()}})
    refreshed = await db.invoices.find_one({"id": invoice_id})
    return invoice_to_out(refreshed)


@router.post("/invoices/{invoice_id}/ewb", response_model=SalesInvoiceOut)
async def generate_ewb(invoice_id: str, body: EwbIn, _: dict = Depends(require_staff)):
    invoice = await db.invoices.find_one({"id": invoice_id})
    if not invoice:
        raise HTTPException(404, "Invoice not found")
    if invoice.get("ewb"):
        return invoice_to_out(invoice)
    if not invoice.get("irn"):
        raise HTTPException(409, "Generate the e-invoice IRN first")
    if os.environ.get("GST_MODE", "simulated") == "live":
        raise HTTPException(
            502,
            "Live e-way bill credentials are not configured. Set GST_API_BASE_URL and provider credentials in "
            "backend/.env, or keep GST_MODE=simulated.",
        )
    info = EwbInfo(
        ewb_no=rand_digits(12),
        ewb_date=today_iso(),
        valid_till=ews_valid_till(1),
        vehicle_no=body.vehicle_no.strip(),
        transport_mode=body.transport_mode,
        distance_km=body.distance_km,
        transporter_id=body.transporter_id.strip(),
        simulated=True,
    )
    await db.invoices.update_one({"id": invoice_id}, {"$set": {"ewb": info.model_dump()}})
    refreshed = await db.invoices.find_one({"id": invoice_id})
    return invoice_to_out(refreshed)
