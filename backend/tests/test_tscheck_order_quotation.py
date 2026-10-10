"""Criterion: Customer order creation prices a quotation from MRP, applies discount,
supports alternate part numbers, and flags unmapped parts."""

import uuid

import httpx


def test_order_quotation_prices_from_mrp_with_customer_discount(auth_client: httpx.Client):
    items = auth_client.get("/items", params={"query": "SUZ-OF-310"}).json()
    item = next(i for i in items if i["part_number"] == "SUZ-OF-310")
    rate = item["tag_mrp"] if item.get("tag_mrp") else item["mrp"]

    order_ref = f"tscheck-order-{uuid.uuid4().hex[:8]}"
    resp = auth_client.post(
        "/orders",
        json={
            "customer_code": "CUST002",
            "order_ref": order_ref,
            "lines": [{"part_number": "SUZ-OF-310", "ordered_qty": 12}],
        },
    )
    assert resp.status_code == 201, resp.text
    order = resp.json()
    assert order["order_ref"] == order_ref
    assert order["customer"]["code"] == "CUST002"
    assert order["customer"]["discount_percent"] == 2.0

    line = order["lines"][0]
    assert line["part_number"] == "SUZ-OF-310"
    assert line["item_name"] == item["name"]
    assert line["rate"] == rate
    gross = round(rate * 12, 2)
    expected_discount = round(gross * 2.0 / 100, 2)
    expected_total = round(gross - expected_discount, 2)
    assert abs(order["totals"]["discount_amount"] - expected_discount) < 0.01
    assert abs(order["totals"]["total"] - expected_total) < 0.01

    # Fetch by id, lines + rate source persisted.
    fetched = auth_client.get(f"/orders/{order['id']}")
    assert fetched.status_code == 200
    assert fetched.json()["lines"][0]["rate_source"] in ("tag", "system")


def test_order_line_with_unmapped_part_number_does_not_crash(auth_client: httpx.Client):
    order_ref = f"tscheck-order-unmapped-{uuid.uuid4().hex[:8]}"
    bogus_part = f"TSCHECK-NOPE-{uuid.uuid4().hex[:6]}"
    resp = auth_client.post(
        "/orders",
        json={
            "customer_code": "CUST002",
            "order_ref": order_ref,
            "lines": [{"part_number": bogus_part, "item_name": "Not In Master", "ordered_qty": 3}],
        },
    )
    assert resp.status_code == 201, resp.text
    order = resp.json()
    line = order["lines"][0]
    assert line["status"] == "unmapped"
    assert line["rate"] is None
