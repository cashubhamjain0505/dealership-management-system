import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { FileText, Printer, QrCode, Truck } from "lucide-react";
import { toast } from "sonner";

import { apiErrorMessage, apiGet, apiPost } from "@/lib/api";
import { inr, num } from "@/lib/format";
import type { AppConfig, Customer, Item, Order, SalesInvoice } from "@/lib/types";
import InvoiceDoc from "@/components/InvoiceDoc";
import { PageHeader, StatusBadge } from "@/components/ui-bits";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

interface Draft {
  order: Order;
  qtys: Record<string, string>;
  billTo: string;
  invoiceDate: string;
}

export default function Billing() {
  const queryClient = useQueryClient();
  const ready = useQuery({ queryKey: ["billing-ready"], queryFn: () => apiGet<Order[]>("/billing/ready") });
  const invoices = useQuery({ queryKey: ["invoices"], queryFn: () => apiGet<SalesInvoice[]>("/invoices") });
  const customers = useQuery({ queryKey: ["customers"], queryFn: () => apiGet<Customer[]>("/customers") });
  const items = useQuery({ queryKey: ["items"], queryFn: () => apiGet<Item[]>("/items") });
  const config = useQuery({ queryKey: ["config"], queryFn: () => apiGet<AppConfig>("/config") });

  const [draft, setDraft] = useState<Draft | null>(null);
  const [selectedInvoiceId, setSelectedInvoiceId] = useState<string | null>(null);
  const [ewbOpen, setEwbOpen] = useState(false);
  const [ewbForm, setEwbForm] = useState({ vehicle_no: "", transport_mode: "1", distance_km: "0", transporter_id: "" });

  const invoiceDetail = useQuery({
    queryKey: ["invoice", selectedInvoiceId],
    queryFn: () => apiGet<SalesInvoice>(`/invoices/${selectedInvoiceId}`),
    enabled: !!selectedInvoiceId,
  });

  const gstByPart = useMemo(() => {
    const map: Record<string, number> = {};
    for (const item of items.data ?? []) map[item.part_number] = item.gst_rate;
    return map;
  }, [items.data]);

  function openDraft(order: Order) {
    const qtys: Record<string, string> = {};
    for (const line of order.lines) {
      const billable = line.allocated_qty - line.billed_qty;
      if (billable > 0) qtys[line.id] = String(billable);
    }
    setDraft({ order, qtys, billTo: "", invoiceDate: "" });
  }

  const billToCustomer = (customers.data ?? []).find((c) => c.code === draft?.billTo) ?? null;
  const discount = draft ? (billToCustomer?.discount_percent ?? draft.order.customer.discount_percent) : 0;
  // Same state as the seller -> CGST+SGST, otherwise IGST. Mirrors the backend's supply_type rule.
  const sellerState = config.data?.seller.state_code ?? "";
  const buyerState = billToCustomer?.state_code ?? draft?.order.customer.state_code ?? "";
  const intra = (buyerState || sellerState) === sellerState;

  const preview = useMemo(() => {
    if (!draft) return null;
    let subtotal = 0;
    let discountAmount = 0;
    let taxable = 0;
    let cgst = 0;
    let sgst = 0;
    let igst = 0;
    for (const line of draft.order.lines) {
      const qty = Number.parseInt(draft.qtys[line.id] || "0", 10) || 0;
      if (qty <= 0 || line.rate == null) continue;
      const gross = Math.round(qty * line.rate * 100) / 100;
      const lineDisc = Math.round(((gross * discount) / 100) * 100) / 100;
      const base = Math.round((gross - lineDisc) * 100) / 100;
      const gstRate = gstByPart[line.part_number] ?? 18;
      subtotal += gross;
      discountAmount += lineDisc;
      taxable += base;
      if (intra) {
        cgst += Math.round(((base * gstRate) / 200) * 100) / 100;
        sgst += Math.round(((base * gstRate) / 200) * 100) / 100;
      } else {
        igst += Math.round(((base * gstRate) / 100) * 100) / 100;
      }
    }
    return { subtotal, discountAmount, taxable, cgst, sgst, igst, total: cgst + sgst + igst + taxable };
  }, [draft, discount, gstByPart, intra]);

  function createInvoice() {
    if (!draft) return;
    const lines = Object.entries(draft.qtys)
      .map(([line_id, qty]) => ({ line_id, qty: Number.parseInt(qty, 10) || 0 }))
      .filter((l) => l.qty > 0);
    if (!lines.length) {
      toast.warning("Enter a quantity for at least one line");
      return;
    }
    create.mutate(lines);
  }

  const create = useMutation({
    mutationFn: (lines: { line_id: string; qty: number }[]) =>
      apiPost<SalesInvoice>("/invoices", {
        order_id: draft?.order.id ?? "",
        bill_to_customer_code: draft?.billTo || null,
        invoice_date: draft?.invoiceDate || "",
        lines,
      }),
    onSuccess: (invoice) => {
      toast.success(`Invoice ${invoice.invoice_no} created — billed on tag MRP`);
      setDraft(null);
      setSelectedInvoiceId(invoice.id);
      void queryClient.invalidateQueries({ queryKey: ["invoices"] });
      void queryClient.invalidateQueries({ queryKey: ["billing-ready"] });
      void queryClient.invalidateQueries({ queryKey: ["orders"] });
      void queryClient.invalidateQueries({ queryKey: ["stock"] });
      void queryClient.invalidateQueries({ queryKey: ["dashboard"] });
    },
    onError: (error) => toast.error(apiErrorMessage(error)),
  });

  const generateIrn = useMutation({
    mutationFn: () => apiPost<SalesInvoice>(`/invoices/${selectedInvoiceId}/irn`),
    onSuccess: () => {
      toast.success("E-invoice IRN registered (simulated until GSP credentials are configured)");
      void queryClient.invalidateQueries({ queryKey: ["invoice", selectedInvoiceId] });
      void queryClient.invalidateQueries({ queryKey: ["invoices"] });
    },
    onError: (error) => toast.error(apiErrorMessage(error)),
  });

  const generateEwb = useMutation({
    mutationFn: () =>
      apiPost<SalesInvoice>(`/invoices/${selectedInvoiceId}/ewb`, {
        vehicle_no: ewbForm.vehicle_no,
        transport_mode: ewbForm.transport_mode,
        distance_km: Number.parseInt(ewbForm.distance_km || "0", 10) || 0,
        transporter_id: ewbForm.transporter_id,
      }),
    onSuccess: () => {
      toast.success("E-way bill generated (simulated)");
      setEwbOpen(false);
      void queryClient.invalidateQueries({ queryKey: ["invoice", selectedInvoiceId] });
      void queryClient.invalidateQueries({ queryKey: ["invoices"] });
    },
    onError: (error) => toast.error(apiErrorMessage(error)),
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="GST Invoicing & E-Invoice"
        subtitle="Ticked allocations are billed automatically on tag MRP, with GST breakup by HSN and customer discount"
      />

      <section className="space-y-2">
        <h3 className="font-heading text-sm font-semibold uppercase tracking-wider text-muted-foreground">
          Ready to bill — allocated, not yet invoiced
        </h3>
        <div className="overflow-hidden rounded-lg border bg-white shadow-xs">
          <Table data-testid="ready-to-bill-table">
            <TableHeader>
              <TableRow>
                <TableHead>Order Ref</TableHead>
                <TableHead>Customer</TableHead>
                <TableHead className="text-right">Units Ticked</TableHead>
                <TableHead className="text-right">Action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(ready.data ?? []).map((order) => {
                const billable = order.lines.reduce((sum, l) => sum + Math.max(l.allocated_qty - l.billed_qty, 0), 0);
                return (
                  <TableRow key={order.id} data-testid={`ready-row-${order.order_ref}`}>
                    <TableCell className="font-mono text-xs font-medium">{order.order_ref}</TableCell>
                    <TableCell>
                      {order.customer.name}{" "}
                      <span className="font-mono text-xs text-muted-foreground">({order.customer.code})</span>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{billable}</TableCell>
                    <TableCell className="text-right">
                      <Button size="sm" onClick={() => openDraft(order)} data-testid={`create-invoice-${order.order_ref}`}>
                        <FileText className="h-4 w-4" /> Create Invoice
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })}
              {(ready.data ?? []).length === 0 && (
                <TableRow>
                  <TableCell colSpan={4} className="py-6 text-center text-sm text-muted-foreground">
                    {ready.isPending ? "Loading…" : "Nothing ready — tick parts under Stock Allocation first."}
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      </section>

      <section className="space-y-2">
        <h3 className="font-heading text-sm font-semibold uppercase tracking-wider text-muted-foreground">
          Issued invoices
        </h3>
        <div className="overflow-hidden rounded-lg border bg-white shadow-xs">
          <Table data-testid="invoices-table">
            <TableHeader>
              <TableRow>
                <TableHead>Invoice No</TableHead>
                <TableHead>Date</TableHead>
                <TableHead>Customer</TableHead>
                <TableHead className="text-right">Units</TableHead>
                <TableHead className="text-right">Total</TableHead>
                <TableHead>IRN / EWB</TableHead>
                <TableHead className="text-right">Action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(invoices.data ?? []).map((invoice) => (
                <TableRow key={invoice.id} data-testid={`invoice-row-${invoice.invoice_no}`}>
                  <TableCell className="font-mono text-xs font-medium">{invoice.invoice_no}</TableCell>
                  <TableCell className="font-mono text-xs">{invoice.invoice_date}</TableCell>
                  <TableCell>{invoice.customer.name}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {num(invoice.lines.reduce((sum, l) => sum + l.qty, 0))}
                  </TableCell>
                  <TableCell className="text-right font-medium tabular-nums">{inr(invoice.totals.total)}</TableCell>
                  <TableCell>
                    <div className="flex gap-1">
                      {invoice.irn && <StatusBadge status="allocated" testId={`irn-badge-${invoice.invoice_no}`} />}
                      {invoice.ewb && <StatusBadge status="received" testId={`ewb-badge-${invoice.invoice_no}`} />}
                      {!invoice.irn && <span className="text-xs text-muted-foreground">—</span>}
                    </div>
                  </TableCell>
                  <TableCell className="text-right">
                    <Button
                      variant="outline"
                      size="xs"
                      onClick={() => setSelectedInvoiceId(invoice.id)}
                      data-testid={`invoice-view-${invoice.invoice_no}`}
                    >
                      View
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
              {(invoices.data ?? []).length === 0 && (
                <TableRow>
                  <TableCell colSpan={7} className="py-6 text-center text-sm text-muted-foreground">
                      {invoices.isPending ? "Loading invoices…" : "No invoices yet."}
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      </section>

      {/* Create invoice dialog */}
      <Dialog open={!!draft} onOpenChange={(next) => !next && setDraft(null)}>
        <DialogContent className="max-w-4xl">
          {draft && (
            <>
              <DialogHeader>
                <DialogTitle>Create GST Invoice — {draft.order.order_ref}</DialogTitle>
              </DialogHeader>
              <div className="grid grid-cols-3 gap-3">
                <div className="space-y-1">
                  <Label htmlFor="invoice-date">Invoice Date (blank = today)</Label>
                  <Input
                    id="invoice-date"
                    type="date"
                    value={draft.invoiceDate}
                    onChange={(e) => setDraft({ ...draft, invoiceDate: e.target.value })}
                    data-testid="invoice-date-input"
                  />
                </div>
                <div className="col-span-2 space-y-1">
                  <Label>Bill To (choose a different customer if needed)</Label>
                  <Select
                    value={draft.billTo || draft.order.customer.code}
                    onValueChange={(value: string) =>
                      setDraft({ ...draft, billTo: value === draft.order.customer.code ? "" : value })
                    }
                  >
                    <SelectTrigger data-testid="bill-to-select">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {(customers.data ?? []).map((customer) => (
                        <SelectItem key={customer.id} value={customer.code}>
                          {customer.name} ({customer.code}){customer.code === draft.order.customer.code ? " — ordering customer" : ""}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="overflow-hidden rounded-md border">
                <Table data-testid="invoice-draft-table">
                  <TableHeader>
                    <TableRow>
                      <TableHead>Part No</TableHead>
                      <TableHead>Item</TableHead>
                      <TableHead className="text-right">Qty</TableHead>
                      <TableHead className="text-right">Rate (Tag MRP)</TableHead>
                      <TableHead className="text-right">Taxable</TableHead>
                      <TableHead className="text-right">GST</TableHead>
                      <TableHead className="text-right">Amount</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {draft.order.lines.map((line) => {
                      const billable = line.allocated_qty - line.billed_qty;
                      if (billable <= 0) return null;
                      const qty = Number.parseInt(draft.qtys[line.id] || "0", 10) || 0;
                      const gross = line.rate == null ? 0 : Math.round(qty * line.rate * 100) / 100;
                      const base = Math.round((gross * (1 - discount / 100)) * 100) / 100;
                      const gstRate = gstByPart[line.part_number] ?? 18;
                      const tax = intra
                        ? Math.round(((base * gstRate) / 200) * 100) / 100 * 2
                        : Math.round(((base * gstRate) / 100) * 100) / 100;
                      return (
                        <TableRow key={line.id} data-testid={`invoice-draft-line-${line.part_number}`}>
                          <TableCell className="font-mono text-xs">{line.part_number}</TableCell>
                          <TableCell>{line.item_name}</TableCell>
                          <TableCell className="text-right">
                            <Input
                              type="number"
                              value={draft.qtys[line.id] ?? ""}
                              min={0}
                              max={billable}
                              onChange={(e) =>
                                setDraft({
                                  ...draft,
                                  qtys: { ...draft.qtys, [line.id]: e.target.value },
                                })
                              }
                              className="w-20 text-right"
                              data-testid={`invoice-draft-qty-${line.part_number}`}
                            />
                            <span className="ml-1 text-[10px] text-muted-foreground">/{billable}</span>
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {inr(line.rate)}
                            <span className="ml-1 text-[10px] uppercase text-muted-foreground">({line.rate_source})</span>
                          </TableCell>
                          <TableCell className="text-right tabular-nums">{inr(base)}</TableCell>
                          <TableCell className="text-right tabular-nums">{inr(tax)}</TableCell>
                          <TableCell className="text-right font-medium tabular-nums">{inr(base + tax)}</TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>

              <div className="flex flex-wrap justify-end gap-x-6 gap-y-1 text-sm">
                <span className="text-muted-foreground">
                  Subtotal <span className="tabular-nums">{inr(preview?.subtotal ?? 0)}</span>
                </span>
                <span className="text-muted-foreground">
                  Discount ({discount}%) <span className="tabular-nums">− {inr(preview?.discountAmount ?? 0)}</span>
                </span>
                <span className="text-muted-foreground">
                  Taxable <span className="tabular-nums">{inr(preview?.taxable ?? 0)}</span>
                </span>
                <span className="font-heading text-base font-semibold">
                  Payable <span className="tabular-nums" data-testid="invoice-draft-total">{inr(preview?.total ?? 0)}</span>
                </span>
              </div>

              <DialogFooter>
                <Button variant="outline" onClick={() => setDraft(null)} data-testid="invoice-draft-cancel-button">
                  Cancel
                </Button>
                <Button onClick={createInvoice} disabled={create.isPending} data-testid="invoice-draft-create-button">
                  {create.isPending ? "Creating…" : "Create Invoice"}
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* Invoice detail dialog */}
      <Dialog open={!!selectedInvoiceId} onOpenChange={(next) => !next && setSelectedInvoiceId(null)}>
        <DialogContent className="max-w-4xl">
          {invoiceDetail.data && (
            <>
              <DialogHeader>
                <DialogTitle>Invoice {invoiceDetail.data.invoice_no}</DialogTitle>
              </DialogHeader>
              <div className="max-h-[55vh] overflow-y-auto pr-1">
                <InvoiceDoc invoice={invoiceDetail.data} seller={null} />
              </div>
              <DialogFooter className="flex-wrap gap-2">
                {!invoiceDetail.data.irn && (
                  <Button
                    onClick={() => generateIrn.mutate()}
                    disabled={generateIrn.isPending}
                    data-testid="generate-irn-button"
                  >
                    <QrCode className="h-4 w-4" />
                    {generateIrn.isPending ? "Registering…" : "Generate E-Invoice (IRN)"}
                  </Button>
                )}
                {invoiceDetail.data.irn && !invoiceDetail.data.ewb && (
                  <Button
                    variant="outline"
                    onClick={() => setEwbOpen(true)}
                    data-testid="open-ewb-button"
                  >
                    <Truck className="h-4 w-4" /> Generate E-Way Bill
                  </Button>
                )}
                <Link to={`/invoices/${invoiceDetail.data.id}/print`} data-testid="invoice-print-link">
                  <Button variant="secondary">
                    <Printer className="h-4 w-4" /> Print / Save PDF
                  </Button>
                </Link>
                <Button variant="ghost" onClick={() => setSelectedInvoiceId(null)} data-testid="invoice-view-close-button">
                  Close
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* E-way bill dialog */}
      <Dialog open={ewbOpen} onOpenChange={setEwbOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>E-Way Bill Details</DialogTitle>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label htmlFor="ewb-vehicle">Vehicle No</Label>
              <Input
                id="ewb-vehicle"
                value={ewbForm.vehicle_no}
                onChange={(e) => setEwbForm({ ...ewbForm, vehicle_no: e.target.value.toUpperCase() })}
                placeholder="UP78AB1234"
                data-testid="ewb-vehicle-input"
              />
            </div>
            <div className="space-y-1">
              <Label>Transport Mode</Label>
              <Select value={ewbForm.transport_mode} onValueChange={(value: string) => setEwbForm({ ...ewbForm, transport_mode: value })}>
                <SelectTrigger data-testid="ewb-mode-select">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="1">Road</SelectItem>
                  <SelectItem value="2">Rail</SelectItem>
                  <SelectItem value="3">Air</SelectItem>
                  <SelectItem value="4">Ship</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="ewb-distance">Distance (km)</Label>
              <Input
                id="ewb-distance"
                type="number"
                value={ewbForm.distance_km}
                onChange={(e) => setEwbForm({ ...ewbForm, distance_km: e.target.value })}
                data-testid="ewb-distance-input"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="ewb-transporter">Transporter ID</Label>
              <Input
                id="ewb-transporter"
                value={ewbForm.transporter_id}
                onChange={(e) => setEwbForm({ ...ewbForm, transporter_id: e.target.value })}
                data-testid="ewb-transporter-input"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEwbOpen(false)} data-testid="ewb-cancel-button">
              Cancel
            </Button>
            <Button onClick={() => generateEwb.mutate()} disabled={generateEwb.isPending} data-testid="ewb-generate-button">
              {generateEwb.isPending ? "Generating…" : "Generate E-Way Bill"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
