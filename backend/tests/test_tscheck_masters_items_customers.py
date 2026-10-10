"""Criterion: Masters items/customers load, accept new records; Excel templates download."""

import uuid

import httpx


def test_items_list_has_seeded_parts_and_accepts_new_item(auth_client: httpx.Client):
    resp = auth_client.get("/items")
    assert resp.status_code == 200, resp.text
    items = resp.json()
    assert len(items) >= 12
    part_numbers = {i["part_number"] for i in items}
    assert "SUZ-BP-101" in part_numbers
    assert "SUZ-OF-310" in part_numbers

    suffix = uuid.uuid4().hex[:8].upper()
    part = f"TSCHECK-ITEM-{suffix}"
    create = auth_client.post(
        "/items",
        json={"part_number": part, "name": "TSCheck Test Part", "ndp": 1000.0, "moq": 2, "unit": "PCS"},
    )
    assert create.status_code == 201, create.text
    created = create.json()
    assert created["part_number"] == part
    expected_mrp = round(1000.0 * 1.18 / 0.78, 2)
    assert abs(created["mrp"] - expected_mrp) < 0.01

    listed = auth_client.get("/items")
    assert any(i["part_number"] == part for i in listed.json())


def test_customers_list_has_seeded_customers_and_accepts_new_customer(auth_client: httpx.Client):
    resp = auth_client.get("/customers")
    assert resp.status_code == 200, resp.text
    customers = resp.json()
    assert len(customers) >= 4
    codes = {c["code"] for c in customers}
    assert {"CUST001", "CUST002", "CUST003", "CUST004"}.issubset(codes)

    suffix = uuid.uuid4().hex[:8]
    code = f"TSCHK{suffix[:6]}".upper()
    create = auth_client.post(
        "/customers",
        json={
            "code": code,
            "name": "TSCheck Test Customer",
            "state_code": "09",
            "customer_type": "Retailer",
            "discount_percent": 1.0,
            "min_order_qty": 1,
        },
    )
    assert create.status_code == 201, create.text
    assert create.json()["code"] == code

    listed = auth_client.get("/customers")
    assert any(c["code"] == code for c in listed.json())


def test_item_and_customer_templates_download_as_xlsx(auth_client: httpx.Client):
    for kind in ("items", "customers"):
        resp = auth_client.get(f"/templates/{kind}")
        assert resp.status_code == 200, resp.text
        assert "spreadsheet" in resp.headers.get("content-type", "")
        assert len(resp.content) > 0
