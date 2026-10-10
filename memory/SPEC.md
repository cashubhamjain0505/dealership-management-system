# PartsDesk — Suzuki 2-Wheeler Spare Parts ERP

## What the app does
Tab-per-process ERP for a Suzuki two-wheeler spare parts trading business (Firm Y), built from the
customer's requirement sheet. Shared staff password login. Everything driven by Excel uploads and
tick-to-act workflows.

## Modules (tabs)
1. **Command Center** (`/dashboard`) — pending orders, ready-to-bill, open POs, allocated-not-received,
   short items, MRP discrepancies, stock value, low-stock vs pending demand.
2. **Masters** (`/masters`) — Items (part no, name, HSN, GST%, NDP, MRP, MOQ, unit, alt part) and
   Customers (code, name, address, GST no, state code, Wholesaler/Retailer/Dealer, dealer code,
   discount %, min order qty). Excel upload + downloadable template per master.
3. **Price List** (`/price-list`) — upload updated price list; system MRP = **NDP × 1.18 ÷ 0.78**;
   tag-MRP vs system-MRP variance flag when difference > 1%.
4. **Customer Orders** (`/orders`) — upload customer order Excel (grouped by order ref + customer code)
   or manual entry; quotation priced from item MRP (tag MRP if set, else system MRP); alternate part
   number column for parts not in the price list (line shows "unmapped"); below-MOQ warnings.
5. **Stock Allocation** (`/allocation`) — pick an order, tick lines to allocate against free warehouse
   stock (server-validated against reserved = allocated − billed); auto-allocate button.
6. **Billing & E-Invoice** (`/billing`) — ready-to-bill = ticked allocations; GST invoice created on
   **tag MRP** with customer discount and CGST/SGST (intra-state) or IGST (inter-state) breakup by HSN;
   bill-to-different-customer option; e-invoice IRN + e-way bill generation buttons (simulated until
   GSP credentials configured); printable invoice at `/invoices/:id/print`.
7. **Balance & PO** (`/purchase`) — balance = ordered − billed − in-open-POs, per part across orders;
   tick rows, voluntary qty column, vendor + expected date; one PO generated per vendor with
   system-generated PO number + reference no (source order refs); DMS-ready Excel export.
8. **Vendor Invoices & GRN** (`/vendor-invoices`) — upload vendor invoice Excel (status
   "allocated not received"); staff confirms received qty + tag MRP per line, approves → stock in,
   tag MRP saved on item, >1% variance flagged, shortages → Short Received Report; PO status updated.
9. **Short Received** (`/short-items`) — short quantities tracked; resupply adds stock back and
   resolves/removes from the report.
10. **Warehouse Stock** (`/stock`) — on-hand / reserved / free per part; manual adjustments.

## Data model (Mongo, uuid string ids)
`items` (part_number unique), `customers` (code unique), `orders` (embedded lines with
ordered/allocated/billed), `purchase_orders` (po_number unique, embedded lines), `invoices`
(invoice_no unique, lines + hsn_summary + totals + irn + ewb), `vendor_invoices`
(vendor_invoice_no unique, lines), `short_items`, `stock` (part_number unique),
`sessions`, `counters`.

## Auth
- Single shared staff password in `backend/.env` → `STAFF_PASSWORD` (default `suzuki123`).
- `POST /api/auth/login {password, staff_name}` sets httpOnly cookie `session_token` (30 days);
  `GET /api/auth/me`; `POST /api/auth/logout`. All other /api routes require the session cookie.

## E-invoice / e-way bill
Provider-adapter per integration playbook: `GST_MODE=simulated` (default) generates a SHA-256 IRN,
ack no, QR payload and 12-digit e-way bill, marked `simulated: true` in the UI. `GST_MODE=live` +
`GST_API_BASE_URL` + provider credentials in `backend/.env` switch to the live GSP call (currently
returns a clear 502 until the provider adapter is wired to the chosen GSP's exact contract).

## Seller profile
`SELLER_NAME`, `SELLER_GSTIN`, `SELLER_ADDRESS`, `SELLER_STATE_CODE`, `SELLER_PIN` in backend/.env;
state code comparison decides CGST+SGST vs IGST.

## Seed
`cd /app/backend && python seed.py` — 12 items with opening stock, 4 customers, 1 sample order
(CUST001: 20× SUZ-BP-101, 200× SUZ-SP-118, 30× SUZ-OF-310). Idempotent.

## Credentials
See `memory/test_credentials.md`.

## Not built yet (agreed scope: core flow first)
- 14-day stocking predictor (Tally invoice history → average 14-day retailer stock rounded to MOQ,
  party selection, daily recalculation, auto PO).
- Firm X ↔ Firm Y purchase reconciliation (company→Firm X receipts vs Firm X→Firm Y billing,
  difference carried to next month).

## Verification
Backend pytest specs: `backend/tests/test_tscheck_*.py`. Browser checks (re-runnable by name):
`.emergent/scripts/checks/` — includes `public-preview-ingress-dashboard` which runs against the
public URL. Last report: `test_reports/iteration_1.json` (17 passed, 0 bugs).
Known fixed bug worth remembering: `_items_by_part()` in `routers/orders.py` must project
`hsn`/`gst_rate`/`unit` — billing builds invoice lines and the HSN summary from that map, and
omitting them silently charged every line 18% with a blank HSN.
