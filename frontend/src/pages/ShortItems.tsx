import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { PackageCheck } from "lucide-react";
import { toast } from "sonner";

import { apiErrorMessage, apiGet, apiPost } from "@/lib/api";
import type { ShortItem } from "@/lib/types";
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

export default function ShortItems() {
  const queryClient = useQueryClient();
  const shorts = useQuery({ queryKey: ["short-items"], queryFn: () => apiGet<ShortItem[]>("/short-items") });
  const [resupplying, setResupplying] = useState<ShortItem | null>(null);
  const [qty, setQty] = useState("0");
  const [reason, setReason] = useState("");

  const resupply = useMutation({
    mutationFn: () =>
      apiPost<ShortItem>(`/short-items/${resupplying?.id ?? ""}/resupply`, {
        qty: Number.parseInt(qty || "0", 10) || 0,
        reason,
      }),
    onSuccess: (item) => {
      toast.success(
        item.status === "resolved"
          ? `Short item fully resolved — ${item.part_number} back in stock and removed from the report`
          : `Resupply recorded — ${item.qty_short - item.qty_received_later} unit(s) still outstanding`,
      );
      setResupplying(null);
      setQty("0");
      setReason("");
      void queryClient.invalidateQueries({ queryKey: ["short-items"] });
      void queryClient.invalidateQueries({ queryKey: ["stock"] });
      void queryClient.invalidateQueries({ queryKey: ["dashboard"] });
    },
    onError: (error) => toast.error(apiErrorMessage(error)),
  });

  return (
    <div className="space-y-4">
      <PageHeader
        title="Short Received Report"
        subtitle="Quantities the vendor did not supply — stock was reduced; resupply re-enters stock and clears the report"
      />

      <div className="overflow-hidden rounded-lg border bg-white shadow-xs">
        <Table data-testid="short-table">
          <TableHeader>
            <TableRow>
              <TableHead>Vendor Inv</TableHead>
              <TableHead>PO Number</TableHead>
              <TableHead>Part No</TableHead>
              <TableHead>Item</TableHead>
              <TableHead className="text-right">Short Qty</TableHead>
              <TableHead className="text-right">Received Later</TableHead>
              <TableHead className="text-right">Outstanding</TableHead>
              <TableHead>Reported</TableHead>
              <TableHead>Reason</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Action</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {(shorts.data ?? []).map((item) => (
              <TableRow key={item.id} data-testid={`short-row-${item.part_number}`}>
                <TableCell className="font-mono text-xs">{item.vendor_invoice_no}</TableCell>
                <TableCell className="font-mono text-xs">{item.po_number || "—"}</TableCell>
                <TableCell className="font-mono text-xs font-medium">{item.part_number}</TableCell>
                <TableCell>{item.item_name}</TableCell>
                <TableCell className="text-right tabular-nums">{item.qty_short}</TableCell>
                <TableCell className="text-right tabular-nums">{item.qty_received_later}</TableCell>
                <TableCell className="text-right font-medium tabular-nums">
                  {item.qty_short - item.qty_received_later}
                </TableCell>
                <TableCell className="font-mono text-xs">{item.date_reported}</TableCell>
                <TableCell className="max-w-40 truncate text-xs">{item.reason || "—"}</TableCell>
                <TableCell>
                  <StatusBadge status={item.status} testId={`short-status-${item.part_number}`} />
                </TableCell>
                <TableCell className="text-right">
                  {item.status === "pending" && (
                    <Button
                      size="xs"
                      variant="outline"
                      onClick={() => {
                        setResupplying(item);
                        setQty(String(item.qty_short - item.qty_received_later));
                      }}
                      data-testid={`short-resupply-${item.part_number}`}
                    >
                      <PackageCheck className="h-3.5 w-3.5" /> Resupply
                    </Button>
                  )}
                </TableCell>
              </TableRow>
            ))}
            {(shorts.data ?? []).length === 0 && (
              <TableRow>
                <TableCell colSpan={11} className="py-8 text-center text-sm text-muted-foreground">
                {shorts.isPending ? "Loading report…" : "No short receipts — vendors have shipped everything."}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      <Dialog open={!!resupplying} onOpenChange={(next) => !next && setResupplying(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Record Resupply — {resupplying?.part_number}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label htmlFor="resupply-qty">Quantity received now</Label>
              <Input
                id="resupply-qty"
                type="number"
                value={qty}
                min={1}
                max={resupplying ? resupplying.qty_short - resupplying.qty_received_later : undefined}
                onChange={(e) => setQty(e.target.value)}
                data-testid="resupply-qty-input"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="resupply-reason">Note (optional)</Label>
              <Input
                id="resupply-reason"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="e.g. Vendor sent balance material"
                data-testid="resupply-reason-input"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setResupplying(null)} data-testid="resupply-cancel-button">
              Cancel
            </Button>
            <Button onClick={() => resupply.mutate()} disabled={resupply.isPending} data-testid="resupply-save-button">
              {resupply.isPending ? "Saving…" : "Add To Stock"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
