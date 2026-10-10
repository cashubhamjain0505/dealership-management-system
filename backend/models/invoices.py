"""Sales invoice (GST) models + e-invoice / e-way bill payloads."""

from pydantic import BaseModel, Field

from models.masters import uuid_str
from models.orders import CustomerSnapshot


class InvLineIn(BaseModel):
    line_id: str
    qty: int = Field(ge=1)


class InvoiceCreate(BaseModel):
    order_id: str
    bill_to_customer_code: str | None = None  # option to bill another customer
    invoice_date: str = ""  # blank -> today (server-side)
    lines: list[InvLineIn] = Field(min_length=1)


class EwbIn(BaseModel):
    vehicle_no: str = ""
    transport_mode: str = "1"  # 1 road | 2 rail | 3 air | 4 ship
    distance_km: int = Field(default=0, ge=0, le=5000)
    transporter_id: str = ""


class InvLineOut(BaseModel):
    id: str
    part_number: str
    item_name: str
    hsn: str
    qty: int
    unit: str
    rate: float
    rate_source: str  # tag | system
    discount_percent: float
    taxable: float
    gst_rate: float
    cgst: float
    sgst: float
    igst: float
    amount: float


class HsnSummaryRow(BaseModel):
    hsn: str
    gst_rate: float
    taxable: float
    cgst: float
    sgst: float
    igst: float
    total: float


class InvoiceTotals(BaseModel):
    subtotal: float
    discount_amount: float
    taxable: float
    cgst: float
    sgst: float
    igst: float
    total: float


class IrnInfo(BaseModel):
    irn: str
    ack_no: str
    ack_date: str
    qr_payload: str = ""
    simulated: bool = True


class EwbInfo(BaseModel):
    ewb_no: str
    ewb_date: str
    valid_till: str
    vehicle_no: str = ""
    transport_mode: str = "1"
    distance_km: int = 0
    transporter_id: str = ""
    simulated: bool = True


class SalesInvoiceOut(BaseModel):
    id: str
    invoice_no: str
    invoice_date: str
    order_id: str
    order_ref: str
    customer: CustomerSnapshot
    lines: list[InvLineOut]
    hsn_summary: list[HsnSummaryRow]
    totals: InvoiceTotals
    irn: IrnInfo | None = None
    ewb: EwbInfo | None = None
    status: str = "issued"
    supply_type: str = "intra"  # intra -> CGST+SGST, inter -> IGST
    created_at: str = ""
