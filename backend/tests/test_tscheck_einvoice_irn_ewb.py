"""Criterion: E-invoice IRN and e-way bill generate in simulated mode and are idempotent."""

import uuid

import httpx


def _make_billed_invoice(auth_client: httpx.Client) -> dict:
    suffix = uuid.uuid4().hex[:8]
    part = f"TSCHECK-EINV-{suffix}"
    auth_client.post("/items", json={"part_number": part, "name": "TSCheck Einvoice Part", "ndp": 500.0, "moq": 1})
    auth_client.post("/stock/adjust", json={"part_number": part, "delta_qty": 20})
    order = auth_client.post(
        "/orders",
        json={
            "customer_code": "CUST003",
            "order_ref": f"tscheck-einv-order-{suffix}",
            "lines": [{"part_number": part, "ordered_qty": 5}],
        },
    ).json()
    line_id = order["lines"][0]["id"]
    auth_client.patch(f"/orders/{order['id']}/allocate", json={"lines": [{"line_id": line_id, "allocated_qty": 5}]})
    invoice = auth_client.post(
        "/invoices", json={"order_id": order["id"], "lines": [{"line_id": line_id, "qty": 5}]}
    ).json()
    return invoice


def test_irn_then_ewb_generate_simulated_and_irn_is_idempotent(auth_client: httpx.Client):
    invoice = _make_billed_invoice(auth_client)
    invoice_id = invoice["id"]
    assert invoice.get("irn") is None

    irn_resp = auth_client.post(f"/invoices/{invoice_id}/irn")
    assert irn_resp.status_code == 200, irn_resp.text
    irn_info = irn_resp.json()["irn"]
    assert len(irn_info["irn"]) == 64
    assert irn_info["simulated"] is True
    assert irn_info["ack_no"]
    assert irn_info["ack_date"]

    # Re-generating must NOT change the IRN (idempotent).
    irn_resp_2 = auth_client.post(f"/invoices/{invoice_id}/irn")
    assert irn_resp_2.status_code == 200
    assert irn_resp_2.json()["irn"]["irn"] == irn_info["irn"]

    # Re-fetching the invoice keeps the same IRN.
    fetched = auth_client.get(f"/invoices/{invoice_id}")
    assert fetched.json()["irn"]["irn"] == irn_info["irn"]

    ewb_resp = auth_client.post(
        f"/invoices/{invoice_id}/ewb", json={"vehicle_no": "UP32AB1234", "distance_km": 120}
    )
    assert ewb_resp.status_code == 200, ewb_resp.text
    ewb_info = ewb_resp.json()["ewb"]
    assert len(ewb_info["ewb_no"]) == 12
    assert ewb_info["valid_till"]
    assert ewb_info["simulated"] is True


def test_ewb_unavailable_before_irn_exists(auth_client: httpx.Client):
    invoice = _make_billed_invoice(auth_client)
    invoice_id = invoice["id"]
    assert invoice.get("irn") is None

    ewb_resp = auth_client.post(
        f"/invoices/{invoice_id}/ewb", json={"vehicle_no": "UP32AB9999", "distance_km": 50}
    )
    assert ewb_resp.status_code == 409, ewb_resp.text
