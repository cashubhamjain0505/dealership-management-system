import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FileDown, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { apiDelete, apiErrorMessage, apiGet, apiPost } from "@/lib/api";
import { inr, num } from "@/lib/format";
import type { FirmXInvoice, Item, ReconSummary } from "@/lib/types";
import { cn } from "@/lib/utils";
import ExcelUpload from "@/components/ExcelUpload";
import { PageHeader, StatCard, StatusBadge } from "@/components/ui-bits";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

interface DraftLine {
  part_number: string;
  item_name: string;
  qty: string;
  rate: string;
}

const EMPTY_LINE: DraftLine = { part_number: "", item_name: "", qty: "", rate: "" };

export default function Reconciliation() {
  const queryClient = useQueryClient();
  const recon = useQuery({ queryKey: ["reconciliation"], queryFn: () => apiGet<ReconSummary>("/reconciliation") });
  const invoices = useQuery({ queryKey: ["firmx-invoices"], queryFn: () => apiGet<FirmXInvoice[]>("/firmx-invoices") });
  const items = useQuery({ queryKey: ["items"], queryFn: () => apiGet<Item[]>("/items") });

  const [showCreate, setShowCreate] = useState(false);
  const [header, setHeader] = useState({ invoice_no: "", invoice_date: "", notes: "" });
  const [lines, setLines] = useState<DraftLine[]>([EMPTY_LINE]);

  const itemsByPart = new Map((items.data ?? []).map((item) => [item.part_number, item]));

  function refresh() {
    void queryClient.invalidateQueries({ queryKey: ["reconciliation"] });
    void queryClient.invalidateQueries({ queryKey: ["firmx-invoices"] });
  }

  const create = useMutation({
    mutationFn: () =>
      apiPost<FirmXInvoice>("/firmx-invoices", {
        ...header,
        lines: lines
          .filter((line) => line.part_number && (Number.parseInt(line.qty || "0", 10) || 0) > 0)
          .map((line) => ({
            part_number: line.part_number,
            item_name: line.item_name,
            qty: Number.parseInt(line.qty, 10),
            rate: Number.parseFloat(line.rate || "0") || 0,
          })),
      }),
    onSuccess: (invoice) => {
      toast.success(`Firm X invoice ${invoice.invoice_no} recorded — reconciliation updated`);
      setShowCreate(false);
      setHeader({ invoice_no: "", invoice_date: "", notes: "" });
      setLines([EMPTY_LINE]);
      refresh();
    },
    onError: (error) => toast.error(apiErrorMessage(error)),
  });

  const remove = useMutation({
    mutationFn: (id: string) => apiDelete(`/firmx-invoices/${id}`),
    onSuccess: () => {
      toast.success("Firm X invoice removed");
      refresh();
    },
    onError: (error) => toast.error(apiErrorMessage(error)),
  });

  const d = recon.data;

  return (
    <div className="space-y-5">
      <PageHeader
        title="Firm X ↔ Firm Y Reconciliation"
        subtitle="Material received in Firm Y against what Firm X has actually billed — the difference is still to be billed"
        actions={
          <a href="/api/reconciliation/export" data-testid="recon-export-link">
            <Button size="sm" variant="secondary">
              <FileDown className="h-4 w-4" /> Download Excel
            </Button>
          </a>
        }
      />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard
          label="To Be Billed"
          value={recon.isPending ? "—" : num(d?.to_be_billed_qty ?? 0)}
          hint={`${num(d?.to_be_billed_parts ?? 0)} part(s) pending`}
          tone="amber"
          testId="recon-stat-to-be-billed"
        />
        <StatCard
          label="Pending Value"
          value={recon.isPending ? "—" : inr(d?.to_be_billed_value ?? 0)}
          hint="at receipt cost"
          tone="sky"
          testId="recon-stat-value"
        />
        <StatCard
          label="Over Billed"
          value={recon.isPending ? "—" : num(d?.over_billed_qty ?? 0)}
          hint={`${num(d?.over_billed_parts ?? 0)} part(s) billed extra`}
          tone="rose"
          testId="recon-stat-over-billed"
        />
        <StatCard
          label="Matched"
          value={recon.isPending ? "—" : num(d?.matched_parts ?? 0)}
          hint={`${num(d?.firmx_invoice_count ?? 0)} Firm X invoice(s)`}
          tone="emerald"
          testId="recon-stat-matched"
        />
      </div>

      <Tabs defaultValue="report">
        <TabsList data-testid="recon-tabs">
          <TabsTrigger value="report" data-testid="recon-tab-report">
            Reconciliation Report
          </TabsTrigger>
          <TabsTrigger value="invoices" data-testid="recon-tab-invoices">
            Firm X Invoices ({invoices.data?.length ?? 0})
          </TabsTrigger>
        </TabsList>

        <TabsContent value="report" className="space-y-2">
          <div className="overflow-hidden rounded-lg border bg-white shadow-xs">
            <Table data-testid="recon-table">
              <TableHeader>
                <TableRow>
                  <TableHead>Part No</TableHead>
                  <TableHead>Item</TableHead>
                  <TableHead className="text-right">Received in Firm Y</TableHead>
                  <TableHead className="text-right">Billed by Firm X</TableHead>
                  <TableHead className="text-right">Difference</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Value Difference</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(d?.rows ?? []).map((row) => (
                  <TableRow
                    key={row.part_number}
                    data-testid={`recon-row-${row.part_number}`}
                    className={cn(
                      "transition-colors duration-150",
                      row.status === "to_be_billed" && "bg-amber-50",
                      row.status === "over_billed" && "bg-rose-50",
                    )}
                  >
                    <TableCell className="font-mono text-xs font-medium">{row.part_number}</TableCell>
                    <TableCell>{row.item_name || "—"}</TableCell>
                    <TableCell className="text-right tabular-nums">{row.received_qty}</TableCell>
                    <TableCell className="text-right tabular-nums">{row.billed_qty}</TableCell>
                    <TableCell
                      className={cn(
                        "text-right font-semibold tabular-nums",
                        row.difference > 0 && "text-amber-700",
                        row.difference < 0 && "text-rose-700",
                      )}
                      data-testid={`recon-diff-${row.part_number}`}
                    >
                      {row.difference > 0 ? `+${row.difference}` : row.difference}
                    </TableCell>
                    <TableCell>
                      <StatusBadge
                        status={row.status === "to_be_billed" ? "draft" : row.status === "over_billed" ? "short" : "received"}
                        testId={`recon-status-${row.part_number}`}
                      />
                      <span className="ml-1 text-[10px] uppercase text-muted-foreground">
                        {row.status.replace(/_/g, " ")}
                      </span>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{inr(row.value_difference)}</TableCell>
                  </TableRow>
                ))}
                {(d?.rows ?? []).length === 0 && (
                  <TableRow>
                    <TableCell colSpan={7} className="py-8 text-center text-sm text-muted-foreground">
                      {recon.isPending
                        ? "Loading…"
                        : "Nothing to reconcile yet — receive material under Vendor Invoices, then record Firm X's invoice."}
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
          <p className="text-xs text-muted-foreground">
            Received = quantities approved into Firm Y's stock from vendor invoices. Billed = quantities on Firm X's
            invoices to Firm Y. A positive difference is still to be billed by Firm X; a negative one means Firm X
            billed more than was received.
          </p>
        </TabsContent>

        <TabsContent value="invoices" className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" onClick={() => setShowCreate(true)} data-testid="firmx-new-button">
              <Plus className="h-4 w-4" /> Record Firm X Invoice
            </Button>
          </div>
          <ExcelUpload
            endpoint="/firmx-invoices/upload"
            templateKind="firmx-invoices"
            label="Upload Firm X invoice details (invoice no, date, part number, qty, rate)"
            onUploaded={refresh}
            testId="firmx-upload"
          />
          <p className="text-xs text-muted-foreground">
            Firm X sends a PDF, so either key its lines in with "Record Firm X Invoice" or fill the template above —
            figures are entered rather than read from the PDF so nothing is misread on a tax document.
          </p>
          <div className="overflow-hidden rounded-lg border bg-white shadow-xs">
            <Table data-testid="firmx-table">
              <TableHeader>
                <TableRow>
                  <TableHead>Invoice No</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead className="text-right">Lines</TableHead>
                  <TableHead className="text-right">Qty</TableHead>
                  <TableHead className="text-right">Value</TableHead>
                  <TableHead>Notes</TableHead>
                  <TableHead className="text-right">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(invoices.data ?? []).map((invoice) => (
                  <TableRow key={invoice.id} data-testid={`firmx-row-${invoice.invoice_no}`}>
                    <TableCell className="font-mono text-xs font-medium">{invoice.invoice_no}</TableCell>
                    <TableCell className="font-mono text-xs">{invoice.invoice_date}</TableCell>
                    <TableCell className="text-right tabular-nums">{invoice.lines.length}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {num(invoice.lines.reduce((sum, l) => sum + l.qty, 0))}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{inr(invoice.total)}</TableCell>
                    <TableCell className="max-w-40 truncate text-xs">{invoice.notes || "—"}</TableCell>
                    <TableCell className="text-right">
                      <Button
                        variant="ghost"
                        size="icon-xs"
                        onClick={() => {
                          if (window.confirm(`Remove Firm X invoice ${invoice.invoice_no}?`)) remove.mutate(invoice.id);
                        }}
                        data-testid={`firmx-delete-${invoice.invoice_no}`}
                      >
                        <Trash2 className="h-3.5 w-3.5 text-red-600" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
                {(invoices.data ?? []).length === 0 && (
                  <TableRow>
                    <TableCell colSpan={7} className="py-8 text-center text-sm text-muted-foreground">
                      {invoices.isPending ? "Loading…" : "No Firm X invoices recorded yet."}
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </TabsContent>
      </Tabs>

      <Dialog open={showCreate} onOpenChange={(next) => !next && setShowCreate(false)}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>Record Firm X Invoice (billed to Firm Y)</DialogTitle>
          </DialogHeader>
          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-1">
              <Label htmlFor="firmx-no">Invoice No</Label>
              <Input
                id="firmx-no"
                value={header.invoice_no}
                onChange={(e) => setHeader({ ...header, invoice_no: e.target.value })}
                placeholder="INV-X-1001"
                data-testid="firmx-no-input"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="firmx-date">Invoice Date</Label>
              <Input
                id="firmx-date"
                type="date"
                value={header.invoice_date}
                onChange={(e) => setHeader({ ...header, invoice_date: e.target.value })}
                data-testid="firmx-date-input"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="firmx-notes">Notes</Label>
              <Input
                id="firmx-notes"
                value={header.notes}
                onChange={(e) => setHeader({ ...header, notes: e.target.value })}
                data-testid="firmx-notes-input"
              />
            </div>
          </div>
          <div className="space-y-2">
            {lines.map((line, index) => (
              <div key={index} className="grid grid-cols-12 items-end gap-2 rounded-md border p-2">
                <div className="col-span-4 space-y-1">
                  <Label className="text-xs">Part Number</Label>
                  <Input
                    value={line.part_number}
                    onChange={(e) =>
                      setLines((prev) =>
                        prev.map((l, i) =>
                          i === index
                            ? {
                                ...l,
                                part_number: e.target.value.toUpperCase(),
                                item_name: itemsByPart.get(e.target.value.toUpperCase())?.name ?? l.item_name,
                              }
                            : l,
                        ),
                      )
                    }
                    data-testid={`firmx-draft-part-${index}`}
                  />
                </div>
                <div className="col-span-4 space-y-1">
                  <Label className="text-xs">Item</Label>
                  <Input
                    value={line.item_name}
                    onChange={(e) =>
                      setLines((prev) => prev.map((l, i) => (i === index ? { ...l, item_name: e.target.value } : l)))
                    }
                    data-testid={`firmx-draft-name-${index}`}
                  />
                </div>
                <div className="col-span-2 space-y-1">
                  <Label className="text-xs">Qty</Label>
                  <Input
                    type="number"
                    value={line.qty}
                    onChange={(e) =>
                      setLines((prev) => prev.map((l, i) => (i === index ? { ...l, qty: e.target.value } : l)))
                    }
                    data-testid={`firmx-draft-qty-${index}`}
                  />
                </div>
                <div className="col-span-2 space-y-1">
                  <Label className="text-xs">Rate</Label>
                  <Input
                    type="number"
                    value={line.rate}
                    onChange={(e) =>
                      setLines((prev) => prev.map((l, i) => (i === index ? { ...l, rate: e.target.value } : l)))
                    }
                    data-testid={`firmx-draft-rate-${index}`}
                  />
                </div>
              </div>
            ))}
            <Button
              variant="outline"
              size="sm"
              onClick={() => setLines((prev) => [...prev, EMPTY_LINE])}
              data-testid="firmx-add-line-button"
            >
              <Plus className="h-4 w-4" /> Add Line
            </Button>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreate(false)} data-testid="firmx-cancel-button">
              Cancel
            </Button>
            <Button
              onClick={() => create.mutate()}
              disabled={create.isPending || !header.invoice_no}
              data-testid="firmx-save-button"
            >
              {create.isPending ? "Saving…" : "Save Invoice"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
