"""Stocking policy + sales history models for the N-day stock predictor."""

from pydantic import BaseModel, Field


class PartyPolicy(BaseModel):
    customer_code: str
    customer_name: str = ""
    include: bool = True
    days: int | None = None  # None -> use the default days


class StockPolicy(BaseModel):
    default_days: int = 14
    parties: list[PartyPolicy] = []


class PartyPolicyIn(BaseModel):
    customer_code: str
    include: bool = True
    days: int | None = Field(default=None, ge=1, le=365)


class StockPolicyIn(BaseModel):
    default_days: int = Field(default=14, ge=1, le=365)
    parties: list[PartyPolicyIn] = []


class PartyContribution(BaseModel):
    customer_code: str
    customer_name: str
    qty_sold: int
    avg_daily: float
    days: int
    requirement: float


class StockRequirementRow(BaseModel):
    part_number: str
    item_name: str
    moq: int
    qty_sold: int
    avg_daily: float
    raw_requirement: float
    requirement: int  # rounded up to MOQ
    on_hand: int
    free: int
    in_open_po: int
    to_order: int
    parties: list[PartyContribution] = []


class StockRequirementOut(BaseModel):
    default_days: int
    period_days: int
    period_from: str
    period_to: str
    tally_rows: int
    app_invoice_rows: int
    included_parties: int
    rows: list[StockRequirementRow]


class GeneratePoIn(BaseModel):
    vendor: str
    part_numbers: list[str] = Field(min_length=1)
    expected_date: str = ""


class SalesUploadResult(BaseModel):
    created: int = 0
    skipped: int = 0
    unknown_parts: list[str] = []
    errors: list[str] = []
