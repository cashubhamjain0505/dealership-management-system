// Hand-written mirrors of the Pydantic models in backend/models/* — nothing infers across
// the HTTP boundary, so keep these in sync manually whenever a model changes.

export interface Item {
  id: string;
  part_number: string;
  name: string;
  hsn: string;
  gst_rate: number;
  ndp: number;
  mrp: number;
  tag_mrp: number | null;
  moq: number;
  unit: string;
  alt_part_number: string;
  active: boolean;
  created_at: string;
}

export interface Customer {
  id: string;
  code: string;
  name: string;
  address: string;
  gstin: string;
  state_code: string;
  customer_type: string;
  dealer_code: string;
  discount_percent: number;
  min_order_qty: number;
  active: boolean;
  created_at: string;
}

export interface CustomerSnapshot {
  id: string;
  code: string;
  name: string;
  address: string;
  gstin: string;
  state_code: string;
  customer_type: string;
  discount_percent: number;
  min_order_qty: number;
}

export type OrderLineStatus = "unmapped" | "pending" | "partial" | "billed";

export interface OrderLine {
  id: string;
  part_number: string;
  item_name: string;
  alt_part_number: string;
  ordered_qty: number;
  allocated_qty: number;
  billed_qty: number;
  balance_qty: number;
  notes: string;
  status: OrderLineStatus;
  rate: number | null;
  rate_source: string;
  line_total: number;
  below_moq: boolean;
}

export interface OrderTotals {
  subtotal: number;
  discount_amount: number;
  total: number;
}

export interface Order {
  id: string;
  order_ref: string;
  order_date: string;
  notes: string;
  customer: CustomerSnapshot;
  lines: OrderLine[];
  totals: OrderTotals;
  status: "open" | "partial" | "billed";
  created_at: string;
}

export interface BalanceRow {
  part_number: string;
  item_name: string;
  ordered_total: number;
  billed_total: number;
  in_po_qty: number;
  balance_qty: number;
  moq: number;
}

export interface POLine {
  id: string;
  part_number: string;
  item_name: string;
  balance_qty: number;
  voluntary_qty: number;
  po_qty: number;
  expected_date: string;
}

export interface PurchaseOrder {
  id: string;
  po_number: string;
  reference_no: string;
  order_date: string;
  expected_date: string;
  vendor: string;
  lines: POLine[];
  status: string;
  created_at: string;
}

export interface POCreatedOut {
  created: number;
  skipped: number;
  orders: PurchaseOrder[];
}

export interface VILine {
  id: string;
  part_number: string;
  item_name: string;
  po_qty: number;
  received_qty: number;
  short_qty: number;
  unit_price: number;
  line_total: number;
  tag_mrp: number | null;
  system_mrp: number | null;
  variance_percent: number | null;
  variance_flag: boolean;
}

export interface VendorInvoice {
  id: string;
  vendor_invoice_no: string;
  vendor: string;
  invoice_date: string;
  po_number: string;
  lines: VILine[];
  status: string;
  receipt_date: string;
  created_at: string;
}

export interface ShortItem {
  id: string;
  vendor_invoice_no: string;
  po_number: string;
  part_number: string;
  item_name: string;
  qty_short: number;
  qty_received_later: number;
  date_reported: string;
  reason: string;
  status: string;
  resolved_date: string;
}

export interface InvLine {
  id: string;
  part_number: string;
  item_name: string;
  hsn: string;
  qty: number;
  unit: string;
  rate: number;
  rate_source: string;
  discount_percent: number;
  taxable: number;
  gst_rate: number;
  cgst: number;
  sgst: number;
  igst: number;
  amount: number;
}

export interface HsnSummaryRow {
  hsn: string;
  gst_rate: number;
  taxable: number;
  cgst: number;
  sgst: number;
  igst: number;
  total: number;
}

export interface InvoiceTotals {
  subtotal: number;
  discount_amount: number;
  taxable: number;
  cgst: number;
  sgst: number;
  igst: number;
  total: number;
}

export interface IrnInfo {
  irn: string;
  ack_no: string;
  ack_date: string;
  qr_payload: string;
  simulated: boolean;
}

export interface EwbInfo {
  ewb_no: string;
  ewb_date: string;
  valid_till: string;
  vehicle_no: string;
  transport_mode: string;
  distance_km: number;
  transporter_id: string;
  simulated: boolean;
}

export interface SalesInvoice {
  id: string;
  invoice_no: string;
  invoice_date: string;
  order_id: string;
  order_ref: string;
  customer: CustomerSnapshot;
  lines: InvLine[];
  hsn_summary: HsnSummaryRow[];
  totals: InvoiceTotals;
  irn: IrnInfo | null;
  ewb: EwbInfo | null;
  status: string;
  supply_type: string;
  created_at: string;
}

export interface StockRow {
  part_number: string;
  item_name: string;
  qty: number;
  reserved: number;
  free: number;
  unit: string;
  tag_mrp: number | null;
  mrp: number;
  moq: number;
}

export interface SellerInfo {
  name: string;
  gstin: string;
  address: string;
  state_code: string;
  pin: string;
}

export interface AppConfig {
  seller: SellerInfo;
  gst_mode: string;
}

export interface Me {
  logged_in: boolean;
  staff_name: string;
}

export interface UploadResult {
  created: number;
  updated?: number;
  lines?: number;
  skipped: number;
  errors: string[];
}

export interface LowStockRow {
  part_number: string;
  item_name: string;
  free_qty: number;
  demand_qty: number;
}

export interface DiscrepancyRow {
  vendor_invoice_no: string;
  part_number: string;
  item_name: string;
  tag_mrp: number | null;
  system_mrp: number | null;
  variance_percent: number | null;
}

export interface DashboardData {
  pending_orders: number;
  ready_to_bill_orders: number;
  ready_to_bill_qty: number;
  open_purchase_orders: number;
  allocated_not_received: number;
  short_pending: number;
  mrp_discrepancies: number;
  stock_value: number;
  low_stock: LowStockRow[];
  discrepancies: DiscrepancyRow[];
}
