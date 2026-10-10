"""Purchase order models (DMS-ready) built from balance order quantities."""

from pydantic import BaseModel, Field

from models.masters import uuid_str


class POLineIn(BaseModel):
    part_number: str
    item_name: str = ""
    balance_qty: int = Field(ge=0)
    voluntary_qty: int = Field(default=0, ge=0)
    expected_date: str = ""


class POCreate(BaseModel):
    vendor: str
    order_date: str = ""  # blank -> today (server-side)
    expected_date: str = ""
    lines: list[POLineIn] = Field(min_length=1)


class POStatusUpdate(BaseModel):
    status: str  # draft | sent | partially_received | received | closed


class POLineOut(BaseModel):
    id: str
    part_number: str
    item_name: str
    balance_qty: int
    voluntary_qty: int
    po_qty: int
    expected_date: str = ""


class PurchaseOrderOut(BaseModel):
    id: str
    po_number: str
    reference_no: str
    order_date: str
    expected_date: str
    vendor: str
    lines: list[POLineOut]
    status: str
    created_at: str = ""


class BalanceRow(BaseModel):
    part_number: str
    item_name: str
    ordered_total: int
    billed_total: int
    in_po_qty: int
    balance_qty: int
    moq: int = 1
