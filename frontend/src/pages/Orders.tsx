import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Eye, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { apiErrorMessage, apiDelete, apiGet, apiPost } from "@/lib/api";
import { inr, num } from "@/lib/format";
import type { Customer, Item, Order, OrderLine } from "@/lib/types";
import ExcelUpload from "@/components/ExcelUpload";
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

interface DraftLine {
  part_number: string;
  item_name: string;
  alt_part_number: string;
  ordered_qty: string;
  notes: string;
}

export default function Orders() {
  const queryClient = useQueryClient();
  const orders = useQuery({ queryKey: ["orders"], queryFn: () => apiGet<Order[]>("/orders") });
  const items = useQuery({ queryKey: ["items"], queryFn: () => apiGet<Item[]>("/items") });
  const customers = useQuery({ queryKey: ["customers"], queryFn: () => apiGet<Customer[]>("/customers") });

  const [viewOrder, setViewOrder] = useState<Order | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [customerCode, setCustomerCode] = useState("");
  const [orderRef, setOrderRef] = useState("");
  const [notes, setNotes] = useState("");
  const [draftLines, setDraftLines] = useState<DraftLine[]>([
    { part_number: "", item_name: "", alt_part_number: "", ordered_qty: "1", notes: "" },
  ]);

  const itemsByPart = useMemo(() => {
    const map: Record<string, Item> = {};
    for (const item of items.data ?? []) map[item.part_number] = item;
    return map;
  }, [items.data]);

  const selectedCustomer = (customers.data ?? []).find((c) => c.code === customerCode) ?? null;

  const createOrder = useMutation({
    mutationFn: () =>
      apiPost<Order>("/orders", {
        customer_code: customerCode,
        order_ref: orderRef,
        notes,
        lines: draftLines
          .filter((line) => line.part_number && Number.parseInt(line.ordered_qty || "0", 10) > 0)
          .map((line) => ({
            part_number: line.part_number,
            item_name: line.item_name,
            alt_part_number: line.alt_part_number,
            ordered_qty: Number.parseInt(line.ordered_qty, 10),
            notes: line.notes,
          })),
      }),
    onSuccess: (order) => {
      toast.success(`Order ${order.order_ref} saved with quotation`);
      void queryClient.invalidateQueries({ queryKey: ["orders"] });
      void queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      setShowCreate(false);
      setDraftLines([{ part_number: "", item_name: "", alt_part_number: "", ordered_qty: "1", notes: "" }]);
      setCustomerCode("");
      setOrderRef("");
      setNotes("");
    },
    onError: (error) => toast.error(apiErrorMessage(error)),
  });

  const deleteOrder = useMutation({
    mutationFn: (id: string) => apiDelete(`/orders/${id}`),
    onSuccess: () => {
      toast.success("Order deleted");
      void queryClient.invalidateQueries({ queryKey: ["orders"] });
      void queryClient.invalidateQueries({ queryKey: ["dashboard"] });
    },
    onError: (error) => toast.error(apiErrorMessage(error)),
  });

  function updateDraftLine(index: number, patch: Partial<DraftLine>) {
    setDraftLines((lines) => lines.map((line, i) => (i === index ? { ...line, ...patch } : line)));
  }

  function lookupPart(index: number, part: string) {
    const item = itemsByPart[part.toUpperCase()];
    if (item) updateDraftLine(index, { item_name: item.name });
  }

  const rateOf = (part: string): number | null => {
    const item = itemsByPart[part.toUpperCase()];
    if (!item) return null;
    return item.tag_mrp ?? (item.mrp > 0 ? item.mrp : null);
  };

  const discount = selectedCustomer?.discount_percent ?? 0;
  const draftTotal = draftLines.reduce(
    (sum, line) => {
      const rate = rateOf(line.part_number);
      if (!rate) return sum;
      return sum + rate * (Number.parseInt(line.ordered_qty || "0", 10) || 0) * (1 - discount / 100);
    },
    0,
  );

  return (
    <div className="space-y-4">
      <PageHeader
        title="Customer Orders & Quotation"
        subtitle="Upload the order Excel your customers send, or enter orders by hand — quotation is priced from the item MRP"
      />

      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" onClick={() => setShowCreate(true)} data-testid="new-order-button">
          <Plus className="h-4 w-4" /> New Order
        </Button>
      </div>

      <ExcelUpload
        endpoint="/orders/upload"
        templateKind="orders"
        label="Upload customer order Excel (customer code, part number, ordered qty…)"
        onUploaded={() => {
          void queryClient.invalidateQueries({ queryKey: ["orders"] });
          void queryClient.invalidateQueries({ queryKey: ["dashboard"] });
        }}
        testId="orders-upload"
      />

      <div className="overflow-hidden rounded-lg border bg-white shadow-xs">
        <Table data-testid="orders-table">
          <TableHeader>
            <TableRow>
              <TableHead>Order Ref</TableHead>
              <TableHead>Date</TableHead>
              <TableHead>Customer</TableHead>
              <TableHead className="text-right">Lines</TableHead>
              <TableHead className="text-right">Ordered Qty</TableHead>
              <TableHead className="text-right">Quotation Total</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {(orders.data ?? []).map((order) => (
              <TableRow key={order.id} data-testid={`orders-row-${order.order_ref}`}>
                <TableCell className="font-mono text-xs font-medium">{order.order_ref}</TableCell>
                <TableCell className="font-mono text-xs">{order.order_date}</TableCell>
                <TableCell>
                  {order.customer.name}
                  <span className="ml-1 font-mono text-xs text-muted-foreground">({order.customer.code})</span>
                </TableCell>
                <TableCell className="text-right tabular-nums">{order.lines.length}</TableCell>
                <TableCell className="text-right tabular-nums">
                  {num(order.lines.reduce((sum, l) => sum + l.ordered_qty, 0))}
                </TableCell>
                <TableCell className="text-right font-medium tabular-nums">{inr(order.totals.total)}</TableCell>
                <TableCell>
                  <StatusBadge status={order.status} testId={`orders-status-${order.order_ref}`} />
                </TableCell>
                <TableCell className="text-right">
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    onClick={() => setViewOrder(order)}
                    data-testid={`order-view-${order.order_ref}`}
                  >
                    <Eye className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    onClick={() => {
                      if (window.confirm(`Delete order ${order.order_ref}?`)) deleteOrder.mutate(order.id);
                    }}
                    data-testid={`order-delete-${order.order_ref}`}
                  >
                    <Trash2 className="h-3.5 w-3.5 text-red-600" />
                  </Button>
                </TableCell>
              </TableRow>
            ))}
            {(orders.data ?? []).length === 0 && (
              <TableRow>
                <TableCell colSpan={8} className="py-8 text-center text-sm text-muted-foreground">
                  {orders.isPending ? "Loading orders…" : "No orders yet — upload the customer's Excel order or create one."}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      {/* View order + quotation */}
      <Dialog open={!!viewOrder} onOpenChange={(next) => !next && setViewOrder(null)}>
        <DialogContent className="max-w-4xl">
          {viewOrder && (
            <>
              <DialogHeader>
                <DialogTitle>
                  Order {viewOrder.order_ref} — {viewOrder.customer.name}
                </DialogTitle>
              </DialogHeader>
              <div className="grid grid-cols-2 gap-2 rounded-md border bg-slate-50 p-3 text-xs md:grid-cols-4">
                <div>
                  <p className="text-muted-foreground">GST No</p>
                  <p className="font-mono">{viewOrder.customer.gstin || "—"}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Type</p>
                  <p className="capitalize">{viewOrder.customer.customer_type}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Discount</p>
                  <p>{viewOrder.customer.discount_percent}%</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Min Order Qty</p>
                  <p>{viewOrder.customer.min_order_qty || "—"}</p>
                </div>
              </div>
              <div className="overflow-hidden rounded-md border">
                <Table data-testid="order-lines-table">
                  <TableHeader>
                    <TableRow>
                      <TableHead>Part No</TableHead>
                      <TableHead>Item</TableHead>
                      <TableHead>Alt Part</TableHead>
                      <TableHead className="text-right">Ordered</TableHead>
                      <TableHead className="text-right">Allocated</TableHead>
                      <TableHead className="text-right">Billed</TableHead>
                      <TableHead className="text-right">Rate</TableHead>
                      <TableHead className="text-right">Line Total</TableHead>
                      <TableHead>Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {viewOrder.lines.map((line: OrderLine) => (
                      <TableRow key={line.id} data-testid={`order-line-${line.part_number}`}>
                        <TableCell className="font-mono text-xs">{line.part_number}</TableCell>
                        <TableCell>
                          {line.item_name || "—"}
                          {line.below_moq && (
                            <span className="ml-1 rounded bg-amber-100 px-1 text-[10px] font-semibold text-amber-800">
                              BELOW MOQ
                            </span>
                          )}
                        </TableCell>
                        <TableCell className="font-mono text-xs">{line.alt_part_number || "—"}</TableCell>
                        <TableCell className="text-right tabular-nums">{line.ordered_qty}</TableCell>
                        <TableCell className="text-right tabular-nums">{line.allocated_qty}</TableCell>
                        <TableCell className="text-right tabular-nums">{line.billed_qty}</TableCell>
                        <TableCell className="text-right tabular-nums">
                          {line.rate == null ? (
                            <span className="text-xs text-rose-600">not in price list</span>
                          ) : (
                            <>
                              {inr(line.rate)}
                              <span className="ml-1 text-[10px] uppercase text-muted-foreground">
                                ({line.rate_source})
                              </span>
                            </>
                          )}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">{inr(line.line_total)}</TableCell>
                        <TableCell>
                          <StatusBadge status={line.status} testId={`order-line-status-${line.part_number}`} />
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              <div className="flex justify-end gap-6 text-sm">
                <span className="text-muted-foreground">
                  Subtotal <span className="tabular-nums">{inr(viewOrder.totals.subtotal)}</span>
                </span>
                <span className="text-muted-foreground">
                  Discount <span className="tabular-nums">− {inr(viewOrder.totals.discount_amount)}</span>
                </span>
                <span className="font-semibold">
                  Total <span className="tabular-nums" data-testid="order-view-total">{inr(viewOrder.totals.total)}</span>
                </span>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* Create order */}
      <Dialog open={showCreate} onOpenChange={(next) => !next && setShowCreate(false)}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>New Customer Order</DialogTitle>
          </DialogHeader>
          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-1">
              <Label>Customer</Label>
              <Select value={customerCode} onValueChange={(value: string) => setCustomerCode(value)}>
                <SelectTrigger data-testid="order-customer-select">
                  <SelectValue placeholder="Select customer" />
                </SelectTrigger>
                <SelectContent>
                  {(customers.data ?? []).map((customer) => (
                    <SelectItem key={customer.id} value={customer.code}>
                      {customer.name} ({customer.code})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="order-ref">Order Ref (blank = auto)</Label>
              <Input id="order-ref" value={orderRef} onChange={(e) => setOrderRef(e.target.value)} data-testid="order-ref-input" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="order-notes">Notes</Label>
              <Input id="order-notes" value={notes} onChange={(e) => setNotes(e.target.value)} data-testid="order-notes-input" />
            </div>
          </div>

          <div className="space-y-2">
            {draftLines.map((line, index) => {
              const rate = rateOf(line.part_number);
              const belowMoq =
                !!selectedCustomer &&
                selectedCustomer.min_order_qty > 0 &&
                (Number.parseInt(line.ordered_qty || "0", 10) || 0) < selectedCustomer.min_order_qty;
              return (
                <div key={index} className="grid grid-cols-12 items-end gap-2 rounded-md border p-2">
                  <div className="col-span-3 space-y-1">
                    <Label className="text-xs">Part Number</Label>
                    <Input
                      value={line.part_number}
                      onChange={(e) =>
                        updateDraftLine(index, { part_number: e.target.value.toUpperCase(), item_name: itemsByPart[e.target.value.toUpperCase()]?.name ?? line.item_name })
                      }
                      onBlur={(e) => lookupPart(index, e.target.value)}
                      placeholder="SUZ-12345"
                      data-testid={`order-draft-part-${index}`}
                    />
                  </div>
                  <div className="col-span-3 space-y-1">
                    <Label className="text-xs">Item Name</Label>
                    <Input value={line.item_name} onChange={(e) => updateDraftLine(index, { item_name: e.target.value })} data-testid={`order-draft-name-${index}`} />
                  </div>
                  <div className="col-span-2 space-y-1">
                    <Label className="text-xs">Alt Part No</Label>
                    <Input value={line.alt_part_number} onChange={(e) => updateDraftLine(index, { alt_part_number: e.target.value })} data-testid={`order-draft-alt-${index}`} />
                  </div>
                  <div className="col-span-1 space-y-1">
                    <Label className="text-xs">Qty</Label>
                    <Input type="number" value={line.ordered_qty} onChange={(e) => updateDraftLine(index, { ordered_qty: e.target.value })} data-testid={`order-draft-qty-${index}`} />
                  </div>
                  <div className="col-span-2 space-y-1">
                    <Label className="text-xs">Notes</Label>
                    <Input value={line.notes} onChange={(e) => updateDraftLine(index, { notes: e.target.value })} data-testid={`order-draft-notes-${index}`} />
                  </div>
                  <div className="col-span-1 pb-1 text-right text-xs">
                    {rate == null ? (
                      <span className="text-rose-600">no MRP</span>
                    ) : (
                      <span className="tabular-nums">{inr(rate * (Number.parseInt(line.ordered_qty || "0", 10) || 0) * (1 - discount / 100))}</span>
                    )}
                    {belowMoq && <p className="text-[10px] font-semibold text-amber-700">below MOQ</p>}
                  </div>
                </div>
              );
            })}
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                setDraftLines((lines) => [
                  ...lines,
                  { part_number: "", item_name: "", alt_part_number: "", ordered_qty: "1", notes: "" },
                ])
              }
              data-testid="order-add-line-button"
            >
              <Plus className="h-4 w-4" /> Add Line
            </Button>
          </div>

          <div className="flex items-center justify-between">
            <p className="text-sm text-muted-foreground">Quotation total after {discount}% discount</p>
            <p className="font-heading text-lg font-semibold tabular-nums" data-testid="order-draft-total">
              {inr(draftTotal)}
            </p>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreate(false)} data-testid="order-create-cancel-button">
              Cancel
            </Button>
            <Button
              onClick={() => createOrder.mutate()}
              disabled={createOrder.isPending || !customerCode}
              data-testid="order-create-save-button"
            >
              {createOrder.isPending ? "Saving…" : "Save Order"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
