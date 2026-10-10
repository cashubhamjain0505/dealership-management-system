import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Plus } from "lucide-react";
import { toast } from "sonner";

import { apiErrorMessage, apiGet, apiPost } from "@/lib/api";
import { inr, pct } from "@/lib/format";
import type { Item, VendorInvoice as VendorInvoiceT } from "@/lib/types";
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
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

interface LineEdit {
  received: string;
  tag: string;
  reason: string;
}

interface DraftLine {
  part_number: string;
  item_name: string;
  po_qty: string;
  received_qty: string;
  unit_price: string;
  tag_mrp: string;
}

export default function VendorInvoices() {
  const queryClient = useQueryClient();
  const invoices = useQuery({ queryKey: ["vendor-invoices"], queryFn: () => apiGet<VendorInvoiceT[]>("/vendor-invoices") });
  const items = useQuery({ queryKey: ["items"], queryFn: () => apiGet<Item[]>("/items") });

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [edits, setEdits] = useState<Record<string, LineEdit>>({});
  const [showCreate, setShowCreate] = useState(false);
  const [header, setHeader] = useState({ vendor_invoice_no: "", vendor: "", invoice_date: "", po_number: "" });
  const [draftLines, setDraftLines] = useState<DraftLine[]>([
    { part_number: "", item_name: "", po_qty: "0", received_qty: "0", unit_price: "0", tag_mrp: "" },
  ]);

  const detail = useQuery({
    queryKey: ["vendor-invoice", selectedId],
    queryFn: () => apiGet<VendorInvoiceT>(`/vendor-invoices/${selectedId}`),
    enabled: !!selectedId,
  });

  useEffect(() => {
    if (detail.data) {
      const next: Record<string, LineEdit> = {};
      for (const line of detail.data.lines) {
        next[line.id] = {
          received: String(line.received_qty || line.po_qty || 0),
          tag: line.tag_mrp == null ? "" : String(line.tag_mrp),
          reason: "",
        };
      }
      setEdits(next);
    }
  }, [detail.data?.id]);

  const itemsByPart = new Map((items.data ?? []).map((item) => [item.part_number, item]));

  function previewVariance(line: VendorInvoiceT["lines"][number], edit: LineEdit) {
    const tag = Number.parseFloat(edit.tag || "0") || line.tag_mrp || 0;
    const system = line.system_mrp ?? 0;
    if (tag > 0 && system > 0) {
      const variance = Math.abs(system - tag) / tag;
      return { tag, variance, flagged: variance > 0.01 };
    }
    return { tag, variance: null, flagged: false };
  }

  const approve = useMutation({
    mutationFn: () =>
      apiPost<VendorInvoiceT>(`/vendor-invoices/${selectedId}/approve`, {
        lines: (detail.data?.lines ?? []).map((line) => {
          const edit = edits[line.id];
          const tag = Number.parseFloat(edit?.tag || "0");
          return {
            line_id: line.id,
            received_qty: Number.parseInt(edit?.received || "0", 10) || 0,
            tag_mrp: tag > 0 ? tag : null,
            reason: edit?.reason ?? "",
          };
        }),
      }),
    onSuccess: (invoice) => {
      const shorts = invoice.lines.reduce((sum, l) => sum + l.short_qty, 0);
      toast.success(
        `Invoice ${invoice.vendor_invoice_no} approved — stock updated${shorts ? `, ${shorts} unit(s) added to Short Received Report` : ""}`,
      );
      setSelectedId(null);
      void queryClient.invalidateQueries({ queryKey: ["vendor-invoices"] });
      void queryClient.invalidateQueries({ queryKey: ["vendor-invoice", selectedId] });
      void queryClient.invalidateQueries({ queryKey: ["stock"] });
      void queryClient.invalidateQueries({ queryKey: ["items"] });
      void queryClient.invalidateQueries({ queryKey: ["purchase-orders"] });
      void queryClient.invalidateQueries({ queryKey: ["short-items"] });
      void queryClient.invalidateQueries({ queryKey: ["dashboard"] });
    },
    onError: (error) => toast.error(apiErrorMessage(error)),
  });

  const create = useMutation({
    mutationFn: () =>
      apiPost<VendorInvoiceT>("/vendor-invoices", {
        ...header,
        lines: draftLines
          .filter((line) => line.part_number)
          .map((line) => ({
            part_number: line.part_number,
            item_name: line.item_name,
            po_qty: Number.parseInt(line.po_qty || "0", 10) || 0,
            received_qty: Number.parseInt(line.received_qty || "0", 10) || 0,
            unit_price: Number.parseFloat(line.unit_price || "0") || 0,
            tag_mrp: Number.parseFloat(line.tag_mrp || "0") || null,
          })),
      }),
    onSuccess: (invoice) => {
      toast.success(`Vendor invoice ${invoice.vendor_invoice_no} saved — items allocated but not received`);
      setShowCreate(false);
      setHeader({ vendor_invoice_no: "", vendor: "", invoice_date: "", po_number: "" });
      setDraftLines([{ part_number: "", item_name: "", po_qty: "0", received_qty: "0", unit_price: "0", tag_mrp: "" }]);
      void queryClient.invalidateQueries({ queryKey: ["vendor-invoices"] });
      void queryClient.invalidateQueries({ queryKey: ["dashboard"] });
    },
    onError: (error) => toast.error(apiErrorMessage(error)),
  });

  return (
    <div className="space-y-4">
      <PageHeader
        title="Vendor Invoices & GRN"
        subtitle="Upload the vendor's invoice — items show as allocated but not received until staff approves them into stock"
      />

      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" onClick={() => setShowCreate(true)} data-testid="vi-new-button">
          <Plus className="h-4 w-4" /> New Vendor Invoice
        </Button>
      </div>

      <ExcelUpload
        endpoint="/vendor-invoices/upload"
        templateKind="vendor-invoices"
        label="Upload vendor invoice Excel (invoice no, vendor, PO number, part, qty, price, tag MRP)"
        onUploaded={() => {
          void queryClient.invalidateQueries({ queryKey: ["vendor-invoices"] });
          void queryClient.invalidateQueries({ queryKey: ["dashboard"] });
        }}
        testId="vi-upload"
      />

      <div className="overflow-hidden rounded-lg border bg-white shadow-xs">
        <Table data-testid="vi-table">
          <TableHeader>
            <TableRow>
              <TableHead>Invoice No</TableHead>
              <TableHead>Vendor</TableHead>
              <TableHead>Date</TableHead>
              <TableHead>PO Number</TableHead>
              <TableHead className="text-right">Lines</TableHead>
              <TableHead className="text-right">Total</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Action</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {(invoices.data ?? []).map((invoice) => {
              const flagged = invoice.lines.filter((l) => l.variance_flag).length;
              return (
                <TableRow key={invoice.id} data-testid={`vi-row-${invoice.vendor_invoice_no}`}>
                  <TableCell className="font-mono text-xs font-medium">{invoice.vendor_invoice_no}</TableCell>
                  <TableCell>{invoice.vendor}</TableCell>
                  <TableCell className="font-mono text-xs">{invoice.invoice_date}</TableCell>
                  <TableCell className="font-mono text-xs">{invoice.po_number || "—"}</TableCell>
                  <TableCell className="text-right tabular-nums">{invoice.lines.length}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {inr(invoice.lines.reduce((sum, l) => sum + l.line_total, 0))}
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-1">
                      <StatusBadge status={invoice.status} testId={`vi-status-${invoice.vendor_invoice_no}`} />
                      {flagged > 0 && (
                        <span
                          className="rounded border border-transparent bg-rose-100 px-1.5 py-0.5 text-[10px] font-semibold text-rose-700"
                          data-testid={`vi-variance-badge-${invoice.vendor_invoice_no}`}
                        >
                          {flagged} MRP &gt;1%
                        </span>
                      )}
                    </div>
                  </TableCell>
                  <TableCell className="text-right">
                    <Button
                      variant="outline"
                      size="xs"
                      onClick={() => setSelectedId(invoice.id)}
                      data-testid={`vi-view-${invoice.vendor_invoice_no}`}
                    >
                      {invoice.status === "received" ? "View" : "Receive"}
                    </Button>
                  </TableCell>
                </TableRow>
              );
            })}
            {(invoices.data ?? []).length === 0 && (
              <TableRow>
                <TableCell colSpan={8} className="py-8 text-center text-sm text-muted-foreground">
                  {invoices.isPending ? "Loading vendor invoices…" : "No vendor invoices yet — upload the Excel the vendor sends."}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      {/* Detail / receive dialog */}
      <Dialog open={!!selectedId} onOpenChange={(next) => !next && setSelectedId(null)}>
        <DialogContent className="max-w-4xl">
          {detail.data && (
            <>
              <DialogHeader>
                <DialogTitle>
                  Vendor Invoice {detail.data.vendor_invoice_no} — {detail.data.vendor}
                </DialogTitle>
              </DialogHeader>
              <div className="grid grid-cols-3 gap-2 rounded-md border bg-slate-50 p-3 text-xs">
                <div>
                  <p className="text-muted-foreground">Invoice Date</p>
                  <p className="font-mono">{detail.data.invoice_date}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">PO Number</p>
                  <p className="font-mono">{detail.data.po_number || "—"}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Receipt Date</p>
                  <p className="font-mono">{detail.data.receipt_date || "—"}</p>
                </div>
              </div>
              <div className="overflow-hidden rounded-md border">
                <Table data-testid="vi-lines-table">
                  <TableHeader>
                    <TableRow>
                      <TableHead>Part No</TableHead>
                      <TableHead>Item</TableHead>
                      <TableHead className="text-right">PO Qty</TableHead>
                      <TableHead className="text-right">Received Qty</TableHead>
                      <TableHead className="text-right">Unit Price</TableHead>
                      <TableHead className="text-right">Tag MRP</TableHead>
                      <TableHead className="text-right">System MRP</TableHead>
                      <TableHead>MRP Check</TableHead>
                      <TableHead className="text-right">Short</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {detail.data.lines.map((line) => {
                      const edit = edits[line.id] ?? { received: String(line.received_qty), tag: "", reason: "" };
                      const preview =
                        detail.data.status === "received"
                          ? { tag: line.tag_mrp ?? 0, variance: line.variance_percent, flagged: line.variance_flag }
                          : previewVariance(line, edit);
                      return (
                        <TableRow key={line.id} data-testid={`vi-line-${line.part_number}`}>
                          <TableCell className="font-mono text-xs">{line.part_number}</TableCell>
                          <TableCell>{line.item_name}</TableCell>
                          <TableCell className="text-right tabular-nums">{line.po_qty}</TableCell>
                          <TableCell className="text-right">
                            {detail.data.status === "received" ? (
                              <span className="tabular-nums">{line.received_qty}</span>
                            ) : (
                              <Input
                                type="number"
                                value={edit.received}
                                min={0}
                                onChange={(e) =>
                                  setEdits((prev) => ({
                                    ...prev,
                                    [line.id]: { ...edit, received: e.target.value },
                                  }))
                                }
                                className="w-20 text-right"
                                data-testid={`vi-received-${line.part_number}`}
                              />
                            )}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">{inr(line.unit_price)}</TableCell>
                          <TableCell className="text-right">
                            {detail.data.status === "received" ? (
                              <span className="tabular-nums">{line.tag_mrp == null ? "—" : inr(line.tag_mrp)}</span>
                            ) : (
                              <Input
                                type="number"
                                value={edit.tag}
                                min={0}
                                onChange={(e) =>
                                  setEdits((prev) => ({ ...prev, [line.id]: { ...edit, tag: e.target.value } }))
                                }
                                className="w-24 text-right"
                                placeholder="MRP on tag"
                                data-testid={`vi-tag-${line.part_number}`}
                              />
                            )}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">{inr(line.system_mrp)}</TableCell>
                          <TableCell>
                            {preview.variance == null ? (
                              <span className="text-xs text-muted-foreground">enter tag MRP</span>
                            ) : preview.flagged ? (
                              <span
                                className="rounded bg-rose-100 px-1.5 py-0.5 text-[10px] font-semibold text-rose-700"
                                data-testid={`vi-flag-${line.part_number}`}
                              >
                                MRP &gt;1% ({pct(preview.variance)})
                              </span>
                            ) : (
                              <span className="text-xs font-medium text-emerald-700">OK</span>
                            )}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {Math.max(line.po_qty - (Number.parseInt(edit.received || "0", 10) || 0), 0) || 0}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
              {detail.data.status === "received" ? (
                <p className="flex items-center gap-2 text-sm text-emerald-700" data-testid="vi-received-note">
                  <CheckCircle2 className="h-4 w-4" /> Approved on {detail.data.receipt_date} — items taken into stock.
                </p>
              ) : (
                <p className="text-xs text-muted-foreground">
                  Confirm received quantities and the MRP written on each product tag. Short quantities are reported
                  separately and only the received units enter stock. Differences above 1% between system MRP
                  (from NDP) and tag MRP are flagged for correction or vendor claim.
                </p>
              )}
              <DialogFooter>
                <Button variant="ghost" onClick={() => setSelectedId(null)} data-testid="vi-close-button">
                  Close
                </Button>
                {detail.data.status !== "received" && (
                  <Button onClick={() => approve.mutate()} disabled={approve.isPending} data-testid="vi-approve-button">
                    {approve.isPending ? "Approving…" : "Approve & Take Into Stock"}
                  </Button>
                )}
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* Create vendor invoice dialog */}
      <Dialog open={showCreate} onOpenChange={(next) => !next && setShowCreate(false)}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>New Vendor Invoice</DialogTitle>
          </DialogHeader>
          <div className="grid grid-cols-4 gap-3">
            <div className="space-y-1">
              <Label htmlFor="vi-no">Invoice No</Label>
              <Input id="vi-no" value={header.vendor_invoice_no} onChange={(e) => setHeader({ ...header, vendor_invoice_no: e.target.value })} data-testid="vi-no-input" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="vi-vendor">Vendor</Label>
              <Input id="vi-vendor" value={header.vendor} onChange={(e) => setHeader({ ...header, vendor: e.target.value })} data-testid="vi-vendor-input" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="vi-date">Invoice Date</Label>
              <Input id="vi-date" type="date" value={header.invoice_date} onChange={(e) => setHeader({ ...header, invoice_date: e.target.value })} data-testid="vi-date-input" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="vi-po">PO Number</Label>
              <Input id="vi-po" value={header.po_number} onChange={(e) => setHeader({ ...header, po_number: e.target.value })} data-testid="vi-po-input" />
            </div>
          </div>
          <div className="space-y-2">
            {draftLines.map((line, index) => (
              <div key={index} className="grid grid-cols-12 items-end gap-2 rounded-md border p-2">
                <div className="col-span-3 space-y-1">
                  <Label className="text-xs">Part Number</Label>
                  <Input
                    value={line.part_number}
                    onChange={(e) =>
                      setDraftLines((lines) =>
                        lines.map((l, i) =>
                          i === index
                            ? { ...l, part_number: e.target.value.toUpperCase(), item_name: itemsByPart.get(e.target.value.toUpperCase())?.name ?? l.item_name }
                            : l,
                        ),
                      )
                    }
                    data-testid={`vi-draft-part-${index}`}
                  />
                </div>
                <div className="col-span-2 space-y-1">
                  <Label className="text-xs">Item</Label>
                  <Input value={line.item_name} onChange={(e) => setDraftLines((lines) => lines.map((l, i) => (i === index ? { ...l, item_name: e.target.value } : l)))} data-testid={`vi-draft-name-${index}`} />
                </div>
                <div className="col-span-1 space-y-1">
                  <Label className="text-xs">PO Qty</Label>
                  <Input type="number" value={line.po_qty} onChange={(e) => setDraftLines((lines) => lines.map((l, i) => (i === index ? { ...l, po_qty: e.target.value } : l)))} data-testid={`vi-draft-po-qty-${index}`} />
                </div>
                <div className="col-span-2 space-y-1">
                  <Label className="text-xs">Unit Price</Label>
                  <Input type="number" value={line.unit_price} onChange={(e) => setDraftLines((lines) => lines.map((l, i) => (i === index ? { ...l, unit_price: e.target.value } : l)))} data-testid={`vi-draft-price-${index}`} />
                </div>
                <div className="col-span-2 space-y-1">
                  <Label className="text-xs">Tag MRP</Label>
                  <Input type="number" value={line.tag_mrp} onChange={(e) => setDraftLines((lines) => lines.map((l, i) => (i === index ? { ...l, tag_mrp: e.target.value } : l)))} data-testid={`vi-draft-tag-${index}`} />
                </div>
                <div className="col-span-2 space-y-1">
                  <Label className="text-xs">Received Qty</Label>
                  <Input type="number" value={line.received_qty} onChange={(e) => setDraftLines((lines) => lines.map((l, i) => (i === index ? { ...l, received_qty: e.target.value } : l)))} data-testid={`vi-draft-received-${index}`} />
                </div>
              </div>
            ))}
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                setDraftLines((lines) => [
                  ...lines,
                  { part_number: "", item_name: "", po_qty: "0", received_qty: "0", unit_price: "0", tag_mrp: "" },
                ])
              }
              data-testid="vi-add-line-button"
            >
              <Plus className="h-4 w-4" /> Add Line
            </Button>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreate(false)} data-testid="vi-create-cancel-button">
              Cancel
            </Button>
            <Button
              onClick={() => create.mutate()}
              disabled={create.isPending || !header.vendor_invoice_no || !header.vendor}
              data-testid="vi-create-save-button"
            >
              {create.isPending ? "Saving…" : "Save Invoice"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
