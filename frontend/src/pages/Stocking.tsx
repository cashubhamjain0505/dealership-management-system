import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarCog, ShoppingCart, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { apiDelete, apiErrorMessage, apiGet, apiPost, apiPut } from "@/lib/api";
import { num } from "@/lib/format";
import type { PartyPolicy, PurchaseOrder, SalesHistoryStats, StockPolicy, StockRequirement } from "@/lib/types";
import { cn } from "@/lib/utils";
import ExcelUpload from "@/components/ExcelUpload";
import { PageHeader, StatCard } from "@/components/ui-bits";
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
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export default function Stocking() {
  const queryClient = useQueryClient();
  const plan = useQuery({ queryKey: ["stock-requirement"], queryFn: () => apiGet<StockRequirement>("/stocking/requirement") });
  const policy = useQuery({ queryKey: ["stock-policy"], queryFn: () => apiGet<StockPolicy>("/stocking/policy") });
  const history = useQuery({ queryKey: ["sales-history"], queryFn: () => apiGet<SalesHistoryStats>("/stocking/sales-history") });

  const [draftPolicy, setDraftPolicy] = useState<StockPolicy | null>(null);
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [showPo, setShowPo] = useState(false);
  const [vendor, setVendor] = useState("");
  const [expected, setExpected] = useState("");

  const working = draftPolicy ?? policy.data ?? null;
  const rows = plan.data?.rows ?? [];
  const toOrderRows = useMemo(() => rows.filter((r) => r.to_order > 0), [rows]);
  const selectedParts = Object.entries(selected).filter(([, v]) => v).map(([k]) => k);

  function patchParty(code: string, patch: Partial<PartyPolicy>) {
    if (!working) return;
    setDraftPolicy({
      ...working,
      parties: working.parties.map((p) => (p.customer_code === code ? { ...p, ...patch } : p)),
    });
  }

  const savePolicy = useMutation({
    mutationFn: () =>
      apiPut<StockPolicy>("/stocking/policy", {
        default_days: working?.default_days ?? 14,
        parties: (working?.parties ?? []).map((p) => ({
          customer_code: p.customer_code,
          include: p.include,
          days: p.days,
        })),
      }),
    onSuccess: () => {
      toast.success("Stock policy saved — plan recalculated");
      setDraftPolicy(null);
      void queryClient.invalidateQueries({ queryKey: ["stock-policy"] });
      void queryClient.invalidateQueries({ queryKey: ["stock-requirement"] });
    },
    onError: (error) => toast.error(apiErrorMessage(error)),
  });

  const generate = useMutation({
    mutationFn: () =>
      apiPost<PurchaseOrder>("/stocking/generate-po", {
        vendor,
        part_numbers: selectedParts,
        expected_date: expected,
      }),
    onSuccess: (po) => {
      toast.success(`Stock purchase order ${po.po_number} created`);
      setShowPo(false);
      setSelected({});
      setVendor("");
      void queryClient.invalidateQueries({ queryKey: ["stock-requirement"] });
      void queryClient.invalidateQueries({ queryKey: ["purchase-orders"] });
      void queryClient.invalidateQueries({ queryKey: ["dashboard"] });
    },
    onError: (error) => toast.error(apiErrorMessage(error)),
  });

  const clearHistory = useMutation({
    mutationFn: () => apiDelete<{ deleted: number }>("/stocking/sales-history"),
    onSuccess: (result) => {
      toast.success(`Cleared ${result.deleted} uploaded sales row(s)`);
      void queryClient.invalidateQueries({ queryKey: ["sales-history"] });
      void queryClient.invalidateQueries({ queryKey: ["stock-requirement"] });
    },
    onError: (error) => toast.error(apiErrorMessage(error)),
  });

  return (
    <div className="space-y-5">
      <PageHeader
        title="Stock Planner"
        subtitle="Keep enough stock to cover the days of sales you choose — averaged from uploaded Tally invoices and invoices raised here"
        actions={
          <Button
            size="sm"
            onClick={() => setShowPo(true)}
            disabled={selectedParts.length === 0}
            data-testid="stocking-open-po-button"
          >
            <ShoppingCart className="h-4 w-4" /> Generate Stock PO ({selectedParts.length})
          </Button>
        }
      />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard
          label="Stock Days"
          value={plan.isPending ? "—" : String(plan.data?.default_days ?? 14)}
          hint="default cover"
          tone="sky"
          testId="stocking-stat-days"
        />
        <StatCard
          label="Parts To Order"
          value={plan.isPending ? "—" : num(toOrderRows.length)}
          hint="below the plan"
          tone="amber"
          testId="stocking-stat-to-order"
        />
        <StatCard
          label="Sales History Rows"
          value={plan.isPending ? "—" : num((plan.data?.tally_rows ?? 0) + (plan.data?.app_invoice_rows ?? 0))}
          hint={`${num(plan.data?.tally_rows ?? 0)} Tally + ${num(plan.data?.app_invoice_rows ?? 0)} in-app`}
          testId="stocking-stat-history"
        />
        <StatCard
          label="Sales Period"
          value={plan.isPending ? "—" : `${num(plan.data?.period_days ?? 0)} d`}
          hint={plan.data?.period_from ? `from ${plan.data.period_from}` : "upload history to start"}
          testId="stocking-stat-period"
        />
      </div>

      <div className="space-y-2">
        <ExcelUpload
          endpoint="/stocking/sales-upload"
          templateKind="sales-history"
          label="Upload past Tally sales invoices (invoice no, date, customer, part number, qty)"
          onUploaded={() => {
            void queryClient.invalidateQueries({ queryKey: ["sales-history"] });
            void queryClient.invalidateQueries({ queryKey: ["stock-requirement"] });
          }}
          testId="sales-history-upload"
        />
        {(history.data?.tally_rows ?? 0) > 0 && (
          <p className="flex items-center gap-2 text-xs text-muted-foreground">
            <span data-testid="sales-history-summary">
              {num(history.data?.tally_rows ?? 0)} uploaded row(s), {num(history.data?.tally_qty ?? 0)} units
              {history.data?.period_from ? ` from ${history.data.period_from} to ${history.data.period_to}` : ""}
            </span>
            <Button
              variant="ghost"
              size="xs"
              onClick={() => {
                if (window.confirm("Remove all uploaded Tally sales history? In-app invoices are kept.")) {
                  clearHistory.mutate();
                }
              }}
              data-testid="clear-sales-history-button"
            >
              <Trash2 className="h-3.5 w-3.5 text-red-600" /> Clear upload
            </Button>
          </p>
        )}
      </div>

      {/* Policy: days + party selection */}
      <section className="space-y-2 rounded-lg border bg-white p-4 shadow-xs">
        <div className="flex flex-wrap items-end gap-3">
          <div className="space-y-1">
            <Label htmlFor="stocking-days" className="flex items-center gap-1">
              <CalendarCog className="h-3.5 w-3.5" /> Days of sales to keep in stock
            </Label>
            <Input
              id="stocking-days"
              type="number"
              min={1}
              max={365}
              value={working?.default_days ?? 14}
              onChange={(e) =>
                working &&
                setDraftPolicy({ ...working, default_days: Math.max(Number.parseInt(e.target.value || "1", 10) || 1, 1) })
              }
              className="w-28"
              data-testid="stocking-days-input"
            />
          </div>
          <p className="mr-auto max-w-md text-xs text-muted-foreground">
            Pick the parties whose orders you want to hold stock for, and override the days for any party that
            needs more or less cover. Requirement is rounded up to each item's MOQ.
          </p>
          <Button
            size="sm"
            onClick={() => savePolicy.mutate()}
            disabled={savePolicy.isPending || !draftPolicy}
            data-testid="stocking-save-policy-button"
          >
            {savePolicy.isPending ? "Saving…" : "Save Policy"}
          </Button>
        </div>

        <div className="overflow-hidden rounded-md border">
          <Table data-testid="stocking-parties-table">
            <TableHeader>
              <TableRow>
                <TableHead>Keep Stock</TableHead>
                <TableHead>Party</TableHead>
                <TableHead>Code</TableHead>
                <TableHead className="text-right">Days Override</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(working?.parties ?? []).map((party) => (
                <TableRow
                  key={party.customer_code}
                  data-testid={`stocking-party-${party.customer_code}`}
                  className={cn("transition-colors duration-150", !party.include && "opacity-50")}
                >
                  <TableCell>
                    <input
                      type="checkbox"
                      checked={party.include}
                      onChange={(e) => patchParty(party.customer_code, { include: e.target.checked })}
                      className="h-4 w-4 accent-sky-600"
                      data-testid={`stocking-party-include-${party.customer_code}`}
                    />
                  </TableCell>
                  <TableCell>{party.customer_name}</TableCell>
                  <TableCell className="font-mono text-xs">{party.customer_code}</TableCell>
                  <TableCell className="text-right">
                    <Input
                      type="number"
                      min={1}
                      max={365}
                      value={party.days ?? ""}
                      placeholder={String(working?.default_days ?? 14)}
                      onChange={(e) =>
                        patchParty(party.customer_code, {
                          days: e.target.value ? Math.max(Number.parseInt(e.target.value, 10) || 1, 1) : null,
                        })
                      }
                      className="w-24 text-right"
                      data-testid={`stocking-party-days-${party.customer_code}`}
                    />
                  </TableCell>
                </TableRow>
              ))}
              {(working?.parties ?? []).length === 0 && (
                <TableRow>
                  <TableCell colSpan={4} className="py-6 text-center text-sm text-muted-foreground">
                    {policy.isPending ? "Loading parties…" : "No customers yet — add them under Masters."}
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      </section>

      {/* The plan */}
      <section className="space-y-2">
        <h3 className="font-heading text-sm font-semibold uppercase tracking-wider text-muted-foreground">
          Stock plan — rolling average of all counted sales
        </h3>
        <div className="overflow-hidden rounded-lg border bg-white shadow-xs">
          <Table data-testid="stocking-plan-table">
            <TableHeader>
              <TableRow>
                <TableHead>
                  <input
                    type="checkbox"
                    checked={toOrderRows.length > 0 && toOrderRows.every((r) => selected[r.part_number])}
                    onChange={(e) => {
                      const next: Record<string, boolean> = {};
                      for (const row of toOrderRows) next[row.part_number] = e.target.checked;
                      setSelected(next);
                    }}
                    className="h-4 w-4 accent-sky-600"
                    data-testid="stocking-select-all"
                  />
                </TableHead>
                <TableHead>Part No</TableHead>
                <TableHead>Item</TableHead>
                <TableHead className="text-right">Sold</TableHead>
                <TableHead className="text-right">Avg/Day</TableHead>
                <TableHead className="text-right">MOQ</TableHead>
                <TableHead className="text-right">Requirement</TableHead>
                <TableHead className="text-right">Free Stock</TableHead>
                <TableHead className="text-right">On Open PO</TableHead>
                <TableHead className="text-right">To Order</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow
                  key={row.part_number}
                  data-testid={`stocking-row-${row.part_number}`}
                  className={cn("transition-colors duration-150", row.to_order > 0 && "bg-amber-50")}
                >
                  <TableCell>
                    {row.to_order > 0 && (
                      <input
                        type="checkbox"
                        checked={!!selected[row.part_number]}
                        onChange={(e) => setSelected((prev) => ({ ...prev, [row.part_number]: e.target.checked }))}
                        className="h-4 w-4 accent-sky-600"
                        data-testid={`stocking-checkbox-${row.part_number}`}
                      />
                    )}
                  </TableCell>
                  <TableCell className="font-mono text-xs font-medium">{row.part_number}</TableCell>
                  <TableCell>
                    {row.item_name}
                    {row.parties.length > 0 && (
                      <span className="ml-1 text-[10px] text-muted-foreground">
                        ({row.parties.map((p) => `${p.customer_name || p.customer_code}: ${p.qty_sold}`).join(", ")})
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{row.qty_sold}</TableCell>
                  <TableCell className="text-right tabular-nums">{row.avg_daily.toFixed(2)}</TableCell>
                  <TableCell className="text-right tabular-nums">{row.moq}</TableCell>
                  <TableCell className="text-right font-medium tabular-nums">{row.requirement}</TableCell>
                  <TableCell className="text-right tabular-nums">{row.free}</TableCell>
                  <TableCell className="text-right tabular-nums">{row.in_open_po}</TableCell>
                  <TableCell
                    className={cn("text-right font-semibold tabular-nums", row.to_order > 0 && "text-amber-700")}
                    data-testid={`stocking-to-order-${row.part_number}`}
                  >
                    {row.to_order}
                  </TableCell>
                </TableRow>
              ))}
              {rows.length === 0 && (
                <TableRow>
                  <TableCell colSpan={10} className="py-8 text-center text-sm text-muted-foreground">
                    {plan.isPending
                      ? "Calculating…"
                      : "No sales counted yet — upload your Tally invoices above (or raise invoices here) and the plan builds itself."}
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
        <p className="text-xs text-muted-foreground">
          Requirement = sum over selected parties of (that party's daily average × its days), rounded up to MOQ.
          To order = requirement − free stock − quantities already on open purchase orders. The average updates
          automatically as new invoices are raised in the app.
        </p>
      </section>

      <Dialog open={showPo} onOpenChange={setShowPo}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Generate Stock Purchase Order</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              {selectedParts.length} part(s) selected from the stock plan.
            </p>
            <div className="space-y-1">
              <Label htmlFor="stocking-vendor">Vendor</Label>
              <Input
                id="stocking-vendor"
                value={vendor}
                onChange={(e) => setVendor(e.target.value)}
                placeholder="e.g. Suzuki Company"
                data-testid="stocking-vendor-input"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="stocking-expected">Expected Delivery</Label>
              <Input
                id="stocking-expected"
                type="date"
                value={expected}
                onChange={(e) => setExpected(e.target.value)}
                data-testid="stocking-expected-input"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowPo(false)} data-testid="stocking-po-cancel-button">
              Cancel
            </Button>
            <Button
              onClick={() => generate.mutate()}
              disabled={generate.isPending || !vendor}
              data-testid="stocking-po-create-button"
            >
              {generate.isPending ? "Creating…" : "Create PO"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
