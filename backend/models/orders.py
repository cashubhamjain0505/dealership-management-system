"""Customer order models with allocation / billing state on lines."""

from pydantic import BaseModel, Field

from models.masters import uuid_str


class OrderLineIn(BaseModel):
    part_number: str
    item_name: str = ""
    alt_part_number: str = ""
    ordered_qty: int = Field(ge=1)
    notes: str = ""


class OrderCreate(BaseModel):
    customer_code: str
    order_ref: str = ""  # blank -> system generated
    order_date: str = ""  # blank -> today (server-side)
    notes: str = ""
    lines: list[OrderLineIn] = Field(min_length=1)


class AllocateLineIn(BaseModel):
    line_id: str
    allocated_qty: int = Field(default=0, ge=0)


class AllocateIn(BaseModel):
    lines: list[AllocateLineIn] = Field(min_length=1)


# ------- response shapes (lines carry quotation + progress computed server-side) -------

class OrderLineOut(BaseModel):
    id: str
    part_number: str
    item_name: str
    alt_part_number: str = ""
    ordered_qty: int
    allocated_qty: int
    billed_qty: int
    balance_qty: int
    notes: str = ""
    status: str  # unmapped | pending | partial | billed
    rate: float | None = None  # tag MRP if known else system MRP
    rate_source: str = ""  # tag | system | ""
    line_total: float = 0.0  # rate * ordered_qty after customer discount
    below_moq: bool = False


class CustomerSnapshot(BaseModel):
    id: str = ""
    code: str
    name: str
    address: str = ""
    gstin: str = ""
    state_code: str = ""
    customer_type: str = "Retailer"
    discount_percent: float = 0.0
    min_order_qty: int = 0


class OrderTotals(BaseModel):
    subtotal: float = 0.0
    discount_amount: float = 0.0
    total: float = 0.0


class OrderOut(BaseModel):
    id: str
    order_ref: str
    order_date: str
    notes: str = ""
    customer: CustomerSnapshot
    lines: list[OrderLineOut]
    totals: OrderTotals
    status: str  # open | partial | billed
    created_at: str = ""
