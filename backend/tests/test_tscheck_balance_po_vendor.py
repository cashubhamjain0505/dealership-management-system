"""Criterion: Balance to PO and vendor receipt — DMS export, shortages, stock-in."""

import uuid

import httpx


def test_balance_po_vendor_receipt_and_short_item_resupply_flow(auth_client: httpx.Client):
    suffix = uuid.uuid4().hex[:8].upper()
    part = f"TSCHECK-PO-{suffix}"
    create_item = auth_client.post("/items", json={"part_number": part, "name": "TSCheck PO Part", "ndp": 300.0, "moq": 1})
    assert create_item.status_code == 201, create_item.text
    system_mrp = create_item.json()["mrp"]

    order_ref = f"tscheck-po-order-{suffix}"
    order = auth_client.post(
        "/orders",
        json={"customer_code": "CUST001", "order_ref": order_ref, "lines": [{"part_number": part, "ordered_qty": 20}]},
    ).json()

    balance = auth_client.get("/purchase/balance").json()
    row = next(r for r in balance if r["part_number"] == part)
    assert row["balance_qty"] == 20

    vendor = f"TSCheck Vendor {suffix}"
    po_resp = auth_client.post(
        "/purchase-orders",
        json={"vendor": vendor, "lines": [{"part_number": part, "balance_qty": 20, "voluntary_qty": 5}]},
    )
    assert po_resp.status_code == 201, po_resp.text
    po = po_resp.json()["orders"][0]
    assert po["po_number"].startswith("PO-")
    assert order_ref in po["reference_no"]
    po_line = po["lines"][0]
    assert po_line["po_qty"] == 25  # 20 balance + 5 voluntary

    dms = auth_client.get(f"/purchase-orders/{po['id']}/export")
    assert dms.status_code == 200, dms.text
    assert "spreadsheet" in dms.headers.get("content-type", "")

    # Vendor invoice: allocated not received.
    over_tag_mrp = round(system_mrp * 1.5, 2)  # deliberately > 1% variance
    vinv_resp = auth_client.post(
        "/vendor-invoices",
        json={
            "vendor_invoice_no": f"tscheck-vinv-{suffix}",
            "vendor": vendor,
            "po_number": po["po_number"],
            "lines": [{"part_number": part, "po_qty": 10, "received_qty": 0, "unit_price": 300.0}],
        },
    )
    assert vinv_resp.status_code == 201, vinv_resp.text
    vinv = vinv_resp.json()
    assert vinv["status"] == "allocated_not_received"
    line_id = vinv["lines"][0]["id"]

    stock_before = next(r for r in auth_client.get("/stock").json() if r["part_number"] == part)
    qty_before = stock_before["qty"]

    approve = auth_client.post(
        f"/vendor-invoices/{vinv['id']}/approve",
        json={"lines": [{"line_id": line_id, "received_qty": 6, "tag_mrp": over_tag_mrp}]},
    )
    assert approve.status_code == 200, approve.text
    approved = approve.json()
    assert approved["status"] == "received"
    approved_line = approved["lines"][0]
    assert approved_line["received_qty"] == 6
    assert approved_line["short_qty"] == 4
    assert approved_line["variance_flag"] is True

    stock_after_approve = next(r for r in auth_client.get("/stock").json() if r["part_number"] == part)
    assert stock_after_approve["qty"] == qty_before + 6

    shorts = auth_client.get("/short-items").json()
    short_row = next(
        s for s in shorts if s["part_number"] == part and s["vendor_invoice_no"] == vinv["vendor_invoice_no"]
    )
    assert short_row["qty_short"] == 4
    assert short_row["status"] == "pending"

    resupply = auth_client.post(f"/short-items/{short_row['id']}/resupply", json={"qty": 4})
    assert resupply.status_code == 200, resupply.text
    resupplied = resupply.json()
    assert resupplied["status"] == "resolved"
    assert resupplied["qty_received_later"] == 4

    stock_final = next(r for r in auth_client.get("/stock").json() if r["part_number"] == part)
    assert stock_final["qty"] == qty_before + 6 + 4
