"""Master data models: spare parts items and customers."""

import uuid
from datetime import datetime, timezone

from pydantic import BaseModel, Field


def uuid_str() -> str:
    return str(uuid.uuid4())


def now_utc() -> datetime:
    return datetime.now(timezone.utc)


def mrp_from_ndp(ndp: float) -> float:
    """Business formula: MRP = NDP * 1.18 / 0.78."""
    return round(ndp * 1.18 / 0.78, 2)


# ---------------- Items ----------------

class Item(BaseModel):
    id: str = Field(default_factory=uuid_str)
    part_number: str
    name: str
    hsn: str = ""
    gst_rate: float = 18.0
    ndp: float = 0.0
    mrp: float = 0.0
    tag_mrp: float | None = None
    moq: int = 1
    unit: str = "PCS"
    alt_part_number: str = ""
    active: bool = True
    created_at: datetime = Field(default_factory=now_utc)


class ItemCreate(BaseModel):
    part_number: str
    name: str
    hsn: str = ""
    gst_rate: float = 18.0
    ndp: float = 0.0
    moq: int = Field(default=1, ge=1)
    unit: str = "PCS"
    alt_part_number: str = ""
    mrp: float | None = None  # optional direct MRP; computed from NDP when NDP is given


class ItemUpdate(BaseModel):
    name: str | None = None
    hsn: str | None = None
    gst_rate: float | None = None
    ndp: float | None = None
    moq: int | None = None
    unit: str | None = None
    alt_part_number: str | None = None
    active: bool | None = None
    tag_mrp: float | None = None


# ---------------- Customers ----------------

CUSTOMER_TYPES = ("Wholesaler", "Retailer", "Dealer")


class Customer(BaseModel):
    id: str = Field(default_factory=uuid_str)
    code: str
    name: str
    address: str = ""
    gstin: str = ""
    state_code: str = ""
    customer_type: str = "Retailer"
    dealer_code: str = ""
    discount_percent: float = 0.0
    min_order_qty: int = 0
    active: bool = True
    created_at: datetime = Field(default_factory=now_utc)


class CustomerCreate(BaseModel):
    code: str
    name: str
    address: str = ""
    gstin: str = ""
    state_code: str = ""
    customer_type: str = "Retailer"
    dealer_code: str = ""
    discount_percent: float = Field(default=0.0, ge=0, le=100)
    min_order_qty: int = Field(default=0, ge=0)


class CustomerUpdate(BaseModel):
    name: str | None = None
    address: str | None = None
    gstin: str | None = None
    state_code: str | None = None
    customer_type: str | None = None
    dealer_code: str | None = None
    discount_percent: float | None = Field(default=None, ge=0, le=100)
    min_order_qty: int | None = None
    active: bool | None = None
