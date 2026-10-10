"""Criterion: Billing produces a GST invoice from tag/system MRP with HSN breakup, discount,
and supports billing to a different customer; stock on-hand decreases after billing."""

import uuid

import httpx


def test_create_invoice_with_hsn_breakup_discount_and_bill_to_other_customer(auth_client: httpx.Client):
    suffix = uuid.uuid4().hex[:8].upper()
    part = f"TSCHECK-BILL-{suffix}"
    hsn = "87089900"
    create_item = auth_client.post(
        "/items",
        json={"part_number": part, "name": "TSCheck Billing Part", "ndp": 1000.0, "hsn": hsn, "moq": 1},
    )
    assert create_item.status_code == 201, create_item.text
    item = create_item.json()
    system_mrp = item["mrp"]

    stock_before = auth_client.get("/stock").json()
    adjust = auth_client.post("/stock/adjust", json={"part_number": part, "delta_qty": 50})
    assert adjust.status_code == 200, adjust.text

    order_ref = f"tscheck-bill-order-{suffix}"
    order = auth_client.post(
        "/orders",
        json={"customer_code": "CUST001", "order_ref": order_ref, "lines": [{"part_number": part, "ordered_qty": 10}]},
    ).json()
    line_id = order["lines"][0]["id"]

    allocate = auth_client.patch(
        f"/orders/{order['id']}/allocate", json={"lines": [{"line_id": line_id, "allocated_qty": 10}]}
    )
    assert allocate.status_code == 200, allocate.text

    # Ready-to-bill should now surface this order.
    ready = auth_client.get("/billing/ready").json()
    assert any(o["id"] == order["id"] for o in ready)

    # Bill to a different customer (CUST004, 0% discount) than the ordering one (CUST001, 5%).
    invoice_resp = auth_client.post(
        "/invoices",
        json={"order_id": order["id"], "bill_to_customer_code": "CUST004", "lines": [{"line_id": line_id, "qty": 10}]},
    )
    assert invoice_resp.status_code == 201, invoice_resp.text
    invoice = invoice_resp.json()
    assert invoice["invoice_no"].startswith("SI-")
    assert invoice["customer"]["code"] == "CUST004"

    line = invoice["lines"][0]
    assert line["hsn"] == hsn
    assert line["rate"] == system_mrp
    assert line["discount_percent"] == 0.0  # CUST004 has 0% discount
    assert len(invoice["hsn_summary"]) >= 1
    hsn_row = next(h for h in invoice["hsn_summary"] if h["hsn"] == hsn)
    assert abs(hsn_row["total"] - line["amount"]) < 0.02
    assert abs(invoice["totals"]["total"] - line["amount"]) < 0.02
    assert invoice["totals"]["total"] > 0

    stock_after = auth_client.get("/stock").json()
    row = next(r for r in stock_after if r["part_number"] == part)
    assert row["qty"] == 40  # 50 added - 10 billed
