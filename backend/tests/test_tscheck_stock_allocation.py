"""Criterion: Stock allocation reserves free stock via tick-to-allocate and cannot exceed availability."""

import uuid

import httpx


def _make_item_with_stock(auth_client: httpx.Client, qty: int) -> str:
    suffix = uuid.uuid4().hex[:8].upper()
    part = f"TSCHECK-ALLOC-{suffix}"
    create = auth_client.post("/items", json={"part_number": part, "name": "TSCheck Alloc Part", "ndp": 100.0, "moq": 1})
    assert create.status_code == 201, create.text
    adjust = auth_client.post("/stock/adjust", json={"part_number": part, "delta_qty": qty, "reason": "tscheck seed"})
    assert adjust.status_code == 200, adjust.text
    assert adjust.json()["free"] == qty
    return part


def test_allocate_within_free_stock_reserves_it(auth_client: httpx.Client):
    part = _make_item_with_stock(auth_client, 15)
    order_ref = f"tscheck-alloc-order-{uuid.uuid4().hex[:8]}"
    order = auth_client.post(
        "/orders",
        json={"customer_code": "CUST002", "order_ref": order_ref, "lines": [{"part_number": part, "ordered_qty": 10}]},
    ).json()
    line_id = order["lines"][0]["id"]

    allocate = auth_client.patch(
        f"/orders/{order['id']}/allocate",
        json={"lines": [{"line_id": line_id, "allocated_qty": 10}]},
    )
    assert allocate.status_code == 200, allocate.text
    allocated_line = allocate.json()["lines"][0]
    assert allocated_line["allocated_qty"] == 10

    stock = auth_client.get("/stock").json()
    row = next(r for r in stock if r["part_number"] == part)
    assert row["reserved"] == 10
    assert row["free"] == 5


def test_allocate_above_free_stock_is_rejected(auth_client: httpx.Client):
    part = _make_item_with_stock(auth_client, 4)
    order_ref = f"tscheck-alloc-over-{uuid.uuid4().hex[:8]}"
    order = auth_client.post(
        "/orders",
        json={"customer_code": "CUST002", "order_ref": order_ref, "lines": [{"part_number": part, "ordered_qty": 50}]},
    ).json()
    line_id = order["lines"][0]["id"]

    allocate = auth_client.patch(
        f"/orders/{order['id']}/allocate",
        json={"lines": [{"line_id": line_id, "allocated_qty": 50}]},
    )
    assert allocate.status_code == 422, allocate.text

    stock = auth_client.get("/stock").json()
    row = next(r for r in stock if r["part_number"] == part)
    assert row["reserved"] == 0
    assert row["free"] == 4
