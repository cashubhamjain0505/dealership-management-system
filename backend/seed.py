"""Seed data: Suzuki spare parts, customers, opening stock and one sample order.

Run: cd /app/backend && python seed.py
Idempotent — skips when items already exist. Not imported by server.py.
"""

import asyncio
from datetime import datetime, timezone

from lib.dates import today_iso
from lib.db import db, ensure_indexes
from lib.helpers import mrp_from_ndp, next_number
from models.masters import uuid_str

# part_number, name, hsn, gst_rate, ndp, moq, unit, alt, opening_stock
ITEMS = [
    ("SUZ-BP-101", "Brake Pad Set — Front (Gixxer)", "87083000", 18.0, 1200.0, 10, "SET", "", 40),
    ("SUZ-BP-205", "Brake Shoe — Rear (Access)", "87083000", 18.0, 350.0, 10, "SET", "", 60),
    ("SUZ-OF-310", "Oil Filter (Access 125)", "84212900", 18.0, 210.0, 5, "PCS", "OF-210", 80),
    ("SUZ-AF-410", "Air Filter (Burgman)", "84213990", 18.0, 340.0, 5, "PCS", "", 50),
    ("SUZ-SP-118", "Spark Plug (Iridium)", "85111000", 28.0, 180.0, 10, "PCS", "SPK-ALT-9", 100),
    ("SUZ-CS-522", "Chain Sprocket Kit (Gixxer 250)", "87141090", 18.0, 2400.0, 2, "SET", "", 15),
    ("SUZ-CP-630", "Clutch Plate Set (Access)", "21211000", 18.0, 640.0, 5, "SET", "", 25),
    ("SUZ-HL-741", "Headlight Assembly (Burgman)", "85122010", 18.0, 1850.0, 2, "PCS", "", 8),
    ("SUZ-MR-752", "Mirror Set (Gixxer)", "87141020", 18.0, 420.0, 5, "SET", "", 30),
    ("SUZ-BT-860", "Battery 12V 5Ah (AGM)", "85071000", 28.0, 1900.0, 2, "PCS", "", 12),
    ("SUZ-TY-975", "Tubeless Tyre 90/90-12", "40111000", 28.0, 2400.0, 2, "PCS", "", 18),
    ("SUZ-LV-112", "Lever — Clutch (Access)", "87141090", 18.0, 260.0, 10, "PCS", "", 45),
]

# code, name, address, gstin, state_code, type, dealer_code, discount, moq
CUSTOMERS = [
    ("CUST001", "Royal Motors", "123 Main Street, Kanpur", "09AAACR1234F1Z5", "09", "Wholesaler", "DLR-001", 5.0, 10),
    ("CUST002", "Speedy Bikes", "456 Oak Avenue, Lucknow", "09AABCS5678G1Z2", "09", "Retailer", "", 2.0, 5),
    ("CUST003", "Suzuki World Dealer", "789 Pine Lane, Delhi", "07AAKCS9012H1Z7", "07", "Dealer", "DLR-002", 7.0, 15),
    ("CUST004", "Local Bike Shop", "101 Maple Drive, Kanpur", "", "09", "Retailer", "", 0.0, 3),
]

SAMPLE_ORDER = {
    "customer_code": "CUST001",
    "lines": [
        # part, qty, alt, notes — first has stock, second is short so the balance/PO flow has work
        ("SUZ-BP-101", 20, "", "Urgent"),
        ("SUZ-SP-118", 200, "", ""),
        ("SUZ-OF-310", 30, "OF-210", ""),
    ],
}


async def main() -> None:
    await ensure_indexes()
    if await db.items.count_documents({}) > 0:
        print("Seed skipped — items already exist. Drop the collections to reseed.")
        return
    now = datetime.now(timezone.utc)

    items_by_part: dict[str, dict] = {}
    for part, name, hsn, gst, ndp, moq, unit, alt, qty in ITEMS:
        item = {
            "id": uuid_str(),
            "part_number": part,
            "name": name,
            "hsn": hsn,
            "gst_rate": gst,
            "ndp": ndp,
            "mrp": mrp_from_ndp(ndp),
            "tag_mrp": None,
            "moq": moq,
            "unit": unit,
            "alt_part_number": alt,
            "active": True,
            "created_at": now,
        }
        await db.items.insert_one(item)
        items_by_part[part] = item
        await db.stock.insert_one({"part_number": part, "qty": qty, "updated_at": now})

    customers_by_code: dict[str, dict] = {}
    for code, name, address, gstin, state, ctype, dealer, disc, moq in CUSTOMERS:
        customer = {
            "id": uuid_str(),
            "code": code,
            "name": name,
            "address": address,
            "gstin": gstin,
            "state_code": state,
            "customer_type": ctype,
            "dealer_code": dealer,
            "discount_percent": disc,
            "min_order_qty": moq,
            "active": True,
            "created_at": now,
        }
        await db.customers.insert_one(customer)
        customers_by_code[code] = customer

    customer = customers_by_code[SAMPLE_ORDER["customer_code"]]
    snapshot = {k: customer[k] for k in ("id", "code", "name", "address", "gstin", "state_code", "customer_type", "discount_percent", "min_order_qty")}
    order_ref = await next_number(db, "order", "ORD", 5)
    order = {
        "id": uuid_str(),
        "order_ref": order_ref,
        "order_date": today_iso(),
        "notes": "Sample order seeded for the walkthrough",
        "customer": snapshot,
        "lines": [
            {
                "id": uuid_str(),
                "part_number": part,
                "item_name": items_by_part[part]["name"],
                "alt_part_number": alt,
                "ordered_qty": qty,
                "allocated_qty": 0,
                "billed_qty": 0,
                "notes": notes,
            }
            for part, qty, alt, notes in SAMPLE_ORDER["lines"]
        ],
        "created_at": now,
    }
    await db.orders.insert_one(order)

    print(f"Seeded {len(ITEMS)} items, {len(CUSTOMERS)} customers, opening stock and order {order_ref}.")


if __name__ == "__main__":
    asyncio.run(main())
