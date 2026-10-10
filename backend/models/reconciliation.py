"""Firm X -> Firm Y purchase reconciliation models.

Firm Y receives material (already captured by the vendor-invoice receipt flow). Firm X later
raises its own invoice to Firm Y; this module compares received vs billed per part and reports
the difference still to be billed (or over-billed).
"""

from pydantic import BaseModel, Field


class FirmXLineIn(BaseModel):
    part_number: str
    item_name: str = ""
    qty: int = Field(ge=1)
    rate: float = Field(default=0.0, ge=0)


class FirmXInvoiceCreate(BaseModel):
    invoice_no: str
    invoice_date: str = ""  # blank -> today (server-side)
    notes: str = ""
    lines: list[FirmXLineIn] = Field(min_length=1)


class FirmXLineOut(BaseModel):
    id: str
    part_number: str
    item_name: str
    qty: int
    rate: float
    amount: float


class FirmXInvoiceOut(BaseModel):
    id: str
    invoice_no: str
    invoice_date: str
    notes: str = ""
    lines: list[FirmXLineOut]
    total: float
    created_at: str = ""


class ReconRow(BaseModel):
    part_number: str
    item_name: str
    received_qty: int  # received into Firm Y from the company
    billed_qty: int  # billed by Firm X to Firm Y
    difference: int  # received - billed
    status: str  # matched | to_be_billed | over_billed
    received_value: float
    billed_value: float
    value_difference: float


class ReconSummary(BaseModel):
    rows: list[ReconRow]
    to_be_billed_parts: int
    over_billed_parts: int
    matched_parts: int
    to_be_billed_qty: int
    over_billed_qty: int
    to_be_billed_value: float
    firmx_invoice_count: int
