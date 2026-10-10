import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FileDown, ShoppingCart } from "lucide-react";
import { toast } from "sonner";

import { apiErrorMessage, apiGet, apiPatch, apiPost } from "@/lib/api";
import { inr, num } from "@/lib/format";
import type { BalanceRow, PurchaseOrder } from "@/lib/types";
import { cn } from "@/lib/utils";
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

interface RowState {
  selected: boolean;
  voluntary: string;
  vendor: string;
  expected: string;
}

const PO_STATUSES = ["draft", "sent", "partially_received", "received", "closed"];

export default function Purchase() {
  const queryClient = useQueryClient();
  const balance = useQuery({ queryKey: ["balance"], queryFn: () => apiGet<BalanceRow[]>("/purchase/balance") });
  const pos = useQuery({ queryKey: ["purchase-orders"], queryFn: () => apiGet<PurchaseOrder[]>("/purchase-orders") });

  const [rows, setRows] = useState<Record<string, RowState>>({});
  const [defaultVendor, setDefaultVendor] = useState("");
  const [defaultExpected, setDefaultExpected] = useState("");
  const [viewPo, setViewPo] = useState<PurchaseOrder | null>(null);

  function rowFor(part: string): RowState {
    return rows[part] ?? { selected: false, voluntary: "0", vendor: "", expected: "" };
  }

  function setRow(part: string, patch: Partial<RowState>) {
    setRows((prev) => ({ ...prev, [part]: { ...rowFor(part), ...patch } }));
  }

  const generate = useMutation({
    mutationFn: async () => {
      const byVendor: Record<string, { row: BalanceRow; state: RowState }[]> = {};
      let skipped = 0;
      for (const row of balance.data ?? []) {
        const state = rowFor(row.part_number);
        if (!state.selected) continue;
        const vendor = (state.vendor || defaultVendor).trim();
        if (!vendor) {
          skipped += 1;
          continue;
        }
        byVendor[vendor] = [...(byVendor[vendor] ?? []), { row, state }];
      }
      const created: string[] = [];
      for (const [vendor, entries] of Object.entries(byVendor)) {
        const response = await apiPost<{ created: number; orders: PurchaseOrder[] }>("/purchase-orders", {
          vendor,
          expected_date: defaultExpected,
          lines: entries.map(({ row, state }) => ({
            part_number: row.part_number,
            item_name: row.item_name,
            balance_qty: row.balance_qty,
            voluntary_qty: Number.parseInt(state.voluntary || "0", 10) || 0,
            expected_date: state.expected || defaultExpected,
          })),
        });
        created.push(...response.orders.map((po) => po.po_number));
      }
      return { created, skipped };
    },
    onSuccess: ({ created, skipped }) => {
      if (!created.length) {
        toast.warning("Nothing generated — tick rows and fill a vendor name first");
        return;
      }
      toast.success(
        `Purchase order${created.length > 1 ? "s" : ""} ${created.join(", ")} created${skipped ? ` (${skipped} row(s) skipped — no vendor)` : ""}`,
      );
      setRows({});
      void queryClient.invalidateQueries({ queryKey: ["balance"] });
      void queryClient.invalidateQueries({ queryKey: ["purchase-orders"] });
      void queryClient.invalidateQueries({ queryKey: ["dashboard"] });
    },
    onError: (error) => toast.error(apiErrorMessage(error)),
  });

  const updateStatus = useMutation({
    mutationFn: ({ poId, status }: { poId: string; status: string }) =>
      apiPatch<PurchaseOrder>(`/purchase-orders/${poId}`, { status }),
    onSuccess: (po) => {
      toast.success(`${po.po_number} marked ${po.status}`);
      void queryClient.invalidateQueries({ queryKey: ["purchase-orders"] });
      void queryClient.invalidateQueries({ queryKey: ["balance"] });
    },
    onError: (error) => toast.error(apiErrorMessage(error)),
  });

  const allSelected = (balance.data ?? []).length > 0 && (balance.data ?? []).every((row) => rowFor(row.part_number).selected);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Balance Orders & DMS Purchase Orders"
        subtitle="Balance quantities from unfilled customer orders — tick and generate a PO in DMS-ready Excel format"
      />

      <section className="space-y-2">
        <div className="flex flex-wrap items-end gap-3">
          <div className="space-y-1">
            <Label htmlFor="default-vendor">Default Vendor (rows can override)</Label>
            <Input
              id="default-vendor"
              value={defaultVendor}
              onChange={(e) => setDefaultVendor(e.target.value)}
              placeholder="e.g. Vendor A"
              data-testid="default-vendor-input"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="default-expected">Expected Delivery</Label>
            <Input
              id="default-expected"
              type="date"
              value={defaultExpected}
              onChange={(e) => setDefaultExpected(e.target.value)}
              data-testid="default-expected-input"
            />
          </div>
          <Button
            onClick={() => generate.mutate()}
            disabled={generate.isPending}
            data-testid="generate-po-button"
          >
            <ShoppingCart className="h-4 w-4" />
            {generate.isPending ? "Generating…" : "Generate PO from Ticked Rows"}
          </Button>
        </div>

        <div className="overflow-hidden rounded-lg border bg-white shadow-xs">
          <Table data-testid="balance-table">
            <TableHeader>
              <TableRow>
                <TableHead>
                  <input
                    type="checkbox"
                    checked={allSelected}
                    onChange={(e) => {
                      const checked = e.target.checked;
                      for (const row of balance.data ?? []) setRow(row.part_number, { selected: checked });
                    }}
                    data-testid="balance-select-all"
                    className="h-4 w-4 accent-sky-600"
                  />
                </TableHead>
                <TableHead>Part No</TableHead>
                <TableHead>Item</TableHead>
                <TableHead className="text-right">Ordered</TableHead>
                <TableHead className="text-right">Billed</TableHead>
                <TableHead className="text-right">In PO</TableHead>
                <TableHead className="text-right">Balance</TableHead>
                <TableHead className="text-right">Voluntary Qty</TableHead>
                <TableHead>Vendor</TableHead>
                <TableHead>Expected</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(balance.data ?? []).map((row) => {
                const state = rowFor(row.part_number);
                return (
                  <TableRow
                    key={row.part_number}
                    data-testid={`balance-row-${row.part_number}`}
                    className={cn("transition-colors duration-150", state.selected && "bg-amber-50")}
                  >
                    <TableCell>
                      <input
                        type="checkbox"
                        checked={state.selected}
                        onChange={(e) => setRow(row.part_number, { selected: e.target.checked })}
                        data-testid={`balance-checkbox-${row.part_number}`}
                        className="h-4 w-4 accent-sky-600"
                      />
                    </TableCell>
                    <TableCell className="font-mono text-xs font-medium">{row.part_number}</TableCell>
                    <TableCell>{row.item_name || "—"}</TableCell>
                    <TableCell className="text-right tabular-nums">{row.ordered_total}</TableCell>
                    <TableCell className="text-right tabular-nums">{row.billed_total}</TableCell>
                    <TableCell className="text-right tabular-nums">{row.in_po_qty}</TableCell>
                    <TableCell className="text-right font-semibold tabular-nums">{row.balance_qty}</TableCell>
                    <TableCell className="text-right">
                      <Input
                        type="number"
                        value={state.voluntary}
                        min={0}
                        onChange={(e) => setRow(row.part_number, { voluntary: e.target.value })}
                        className="w-20 text-right"
                        data-testid={`balance-voluntary-${row.part_number}`}
                      />
                    </TableCell>
                    <TableCell>
                      <Input
                        value={state.vendor}
                        onChange={(e) => setRow(row.part_number, { vendor: e.target.value })}
                        placeholder={defaultVendor || "Vendor"}
                        data-testid={`balance-vendor-${row.part_number}`}
                      />
                    </TableCell>
                    <TableCell>
                      <Input
                        type="date"
                        value={state.expected || defaultExpected}
                        onChange={(e) => setRow(row.part_number, { expected: e.target.value })}
                        data-testid={`balance-expected-${row.part_number}`}
                      />
                    </TableCell>
                  </TableRow>
                );
              })}
              {(balance.data ?? []).length === 0 && (
                <TableRow>
                  <TableCell colSpan={10} className="py-6 text-center text-sm text-muted-foreground">
                    {balance.isPending
                    ? "Loading balance…"
                    : "No balance to purchase — customer orders are fully billed or already on a PO."}
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      </section>

      <section className="space-y-2">
        <h3 className="font-heading text-sm font-semibold uppercase tracking-wider text-muted-foreground">
          Purchase orders
        </h3>
        <div className="overflow-hidden rounded-lg border bg-white shadow-xs">
          <Table data-testid="po-table">
            <TableHeader>
              <TableRow>
                <TableHead>PO Number</TableHead>
                <TableHead>Reference No</TableHead>
                <TableHead>Date</TableHead>
                <TableHead>Vendor</TableHead>
                <TableHead className="text-right">Lines</TableHead>
                <TableHead className="text-right">PO Qty</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(pos.data ?? []).map((po) => (
                <TableRow key={po.id} data-testid={`po-row-${po.po_number}`}>
                  <TableCell className="font-mono text-xs font-medium">{po.po_number}</TableCell>
                  <TableCell className="max-w-48 truncate text-xs text-muted-foreground">{po.reference_no || "—"}</TableCell>
                  <TableCell className="font-mono text-xs">{po.order_date}</TableCell>
                  <TableCell>{po.vendor}</TableCell>
                  <TableCell className="text-right tabular-nums">{po.lines.length}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {num(po.lines.reduce((sum, l) => sum + l.po_qty, 0))}
                  </TableCell>
                  <TableCell>
                    <StatusBadge status={po.status} testId={`po-status-${po.po_number}`} />
                  </TableCell>
                  <TableCell className="text-right">
                    <Button
                      variant="outline"
                      size="xs"
                      onClick={() => setViewPo(po)}
                      data-testid={`po-view-${po.po_number}`}
                    >
                      View
                    </Button>
                    <a
                      href={`/api/purchase-orders/${po.id}/export`}
                      className="ml-1 inline-flex"
                      data-testid={`po-export-${po.po_number}`}
                    >
                      <Button variant="ghost" size="xs">
                        <FileDown className="h-3.5 w-3.5" /> DMS
                      </Button>
                    </a>
                  </TableCell>
                </TableRow>
              ))}
              {(pos.data ?? []).length === 0 && (
                <TableRow>
                  <TableCell colSpan={8} className="py-6 text-center text-sm text-muted-foreground">
                    {pos.isPending ? "Loading purchase orders…" : "No purchase orders yet — tick balance rows above and generate."}
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      </section>

      <Dialog open={!!viewPo} onOpenChange={(next) => !next && setViewPo(null)}>
        <DialogContent className="max-w-3xl">
          {viewPo && (
            <>
              <DialogHeader>
                <DialogTitle>
                  {viewPo.po_number} — {viewPo.vendor}
                </DialogTitle>
              </DialogHeader>
              <div className="grid grid-cols-2 gap-2 rounded-md border bg-slate-50 p-3 text-xs md:grid-cols-4">
                <div>
                  <p className="text-muted-foreground">Reference No</p>
                  <p className="font-mono">{viewPo.reference_no || "—"}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Order Date</p>
                  <p className="font-mono">{viewPo.order_date}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Expected Delivery</p>
                  <p className="font-mono">{viewPo.expected_date || "—"}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Status</p>
                  <Select
                    value={viewPo.status}
                    onValueChange={(value: string) =>
                      updateStatus.mutate({ poId: viewPo.id, status: value })
                    }
                  >
                    <SelectTrigger size="sm" data-testid="po-status-select">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {PO_STATUSES.map((status) => (
                        <SelectItem key={status} value={status}>
                          {status.replace(/_/g, " ")}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="overflow-hidden rounded-md border">
                <Table data-testid="po-lines-table">
                  <TableHeader>
                    <TableRow>
                      <TableHead>Part No</TableHead>
                      <TableHead>Item</TableHead>
                      <TableHead className="text-right">Balance</TableHead>
                      <TableHead className="text-right">Voluntary</TableHead>
                      <TableHead className="text-right">PO Qty</TableHead>
                      <TableHead>Expected</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {viewPo.lines.map((line) => (
                      <TableRow key={line.id} data-testid={`po-line-${line.part_number}`}>
                        <TableCell className="font-mono text-xs">{line.part_number}</TableCell>
                        <TableCell>{line.item_name}</TableCell>
                        <TableCell className="text-right tabular-nums">{line.balance_qty}</TableCell>
                        <TableCell className="text-right tabular-nums">{line.voluntary_qty}</TableCell>
                        <TableCell className="text-right font-medium tabular-nums">{line.po_qty}</TableCell>
                        <TableCell className="font-mono text-xs">{line.expected_date || "—"}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              <DialogFooter>
                <a href={`/api/purchase-orders/${viewPo.id}/export`} data-testid="po-export-dialog-link">
                  <Button variant="secondary">
                    <FileDown className="h-4 w-4" /> Download DMS Excel
                  </Button>
                </a>
                <Button variant="ghost" onClick={() => setViewPo(null)} data-testid="po-view-close-button">
                  Close
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
