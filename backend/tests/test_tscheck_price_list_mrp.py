"""Criterion: Price list MRP derives from NDP, and tag-MRP vs system-MRP variance > 1% is flagged."""

import uuid

import httpx


def test_editing_ndp_updates_system_mrp(auth_client: httpx.Client):
    suffix = uuid.uuid4().hex[:8]
    part = f"TSCHECK-PRICE-{suffix}"
    create = auth_client.post(
        "/items",
        json={"part_number": part, "name": "TSCheck Price Part", "ndp": 100.0, "moq": 1},
    )
    assert create.status_code == 201, create.text
    item_id = create.json()["id"]
    assert abs(create.json()["mrp"] - round(100.0 * 1.18 / 0.78, 2)) < 0.01

    new_ndp = 500.0
    patch = auth_client.patch(f"/items/{item_id}", json={"ndp": new_ndp})
    assert patch.status_code == 200, patch.text
    updated = patch.json()
    assert abs(updated["ndp"] - new_ndp) < 0.01
    expected_mrp = round(new_ndp * 1.18 / 0.78, 2)
    assert abs(updated["mrp"] - expected_mrp) < 0.01


def test_seeded_spark_plug_tag_mrp_variance_over_1_percent_flagged(auth_client: httpx.Client):
    resp = auth_client.get("/items", params={"query": "SUZ-SP-118"})
    assert resp.status_code == 200, resp.text
    matches = [i for i in resp.json() if i["part_number"] == "SUZ-SP-118"]
    assert matches, "seeded SUZ-SP-118 not found"
    item = matches[0]
    system_mrp = item["mrp"]
    tag_mrp = item["tag_mrp"]
    assert tag_mrp, "SUZ-SP-118 expected to have a tag MRP set by seed"
    variance_percent = abs(tag_mrp - system_mrp) / system_mrp * 100
    assert variance_percent > 1.0, f"expected >1% variance, got {variance_percent}"


def test_tag_mrp_within_1_percent_not_flagged(auth_client: httpx.Client):
    suffix = uuid.uuid4().hex[:8]
    part = f"TSCHECK-NOFLAG-{suffix}"
    create = auth_client.post(
        "/items",
        json={"part_number": part, "name": "TSCheck Within Tolerance Part", "ndp": 200.0, "moq": 1},
    )
    assert create.status_code == 201, create.text
    item_id = create.json()["id"]
    system_mrp = create.json()["mrp"]
    # Set tag MRP to within 0.5% of system MRP -> should NOT be flagged.
    close_tag = round(system_mrp * 1.005, 2)
    patch = auth_client.patch(f"/items/{item_id}", json={"tag_mrp": close_tag})
    assert patch.status_code == 200, patch.text
    updated = patch.json()
    variance_percent = abs(updated["tag_mrp"] - updated["mrp"]) / updated["mrp"] * 100
    assert variance_percent <= 1.0, f"expected <=1% variance, got {variance_percent}"
