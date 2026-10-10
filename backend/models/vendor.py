"""Vendor invoice (purchase side) + short received report models."""

from pydantic import BaseModel, Field

from models.masters import uuid_str


class VILineIn(BaseModel):
    part_number: str
    item_name: str = ""
    po_qty: int = Field(default=0, ge=0)
    received_qty: int = Field(default=0, ge=0)
    unit_price: float = Field(default=0.0, ge=0)
    tag_mrp: float | None = None


class VendorInvoiceCreate(BaseModel):
    vendor_invoice_no: str
    vendor: str
    invoice_date: str = ""  # blank -> today (server-side)
    po_number: str = ""
    lines: list[VILineIn] = Field(min_length=1)


class ApproveLineIn(BaseModel):
    line_id: str
    received_qty: int = Field(ge=0)
    tag_mrp: float | None = None
    reason: str = ""


class ApproveIn(BaseModel):
    lines: list[ApproveLineIn] = Field(min_length=1)


class ResupplyIn(BaseModel):
    qty: int = Field(ge=1)
    reason: str = ""


class VILineOut(BaseModel):
    id: str
    part_number: str
    item_name: str
    po_qty: int
    received_qty: int
    short_qty: int = 0
    unit_price: float
    line_total: float
    tag_mrp: float | None = None
    system_mrp: float | None = None
    variance_percent: float | None = None
    variance_flag: bool = False


class VendorInvoiceOut(BaseModel):
    id: str
    vendor_invoice_no: str
    vendor: str
    invoice_date: str
    po_number: str
    lines: list[VILineOut]
    status: str  # allocated_not_received | received
    receipt_date: str = ""
    created_at: str = ""


class ShortItemOut(BaseModel):
    id: str
    vendor_invoice_no: str
    po_number: str
    part_number: str
    item_name: str
    qty_short: int
    qty_received_later: int = 0
    date_reported: str
    reason: str = ""
    status: str  # pending | resolved
    resolved_date: str = ""
