import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { SlidersHorizontal } from "lucide-react";
import { toast } from "sonner";

import { apiErrorMessage, apiGet, apiPost } from "@/lib/api";
import { inr } from "@/lib/format";
import type { Item, StockRow } from "@/lib/types";
import { PageHeader } from "@/components/ui-bits";

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

export default function Stock() {
  const queryClient = useQueryClient();
  const stock = useQuery({ queryKey: ["stock"], queryFn: () => apiGet<StockRow[]>("/stock") });
  const items = useQuery({ queryKey: ["items"], queryFn: () => apiGet<Item[]>("/items") });

  const [showAdjust, setShowAdjust] = useState(false);
  const [part, setPart] = useState("");
  const [delta, setDelta] = useState("0");
  const [reason, setReason] = useState("");

  const adjust = useMutation({
    mutationFn: () =>
      apiPost<StockRow>("/stock/adjust", {
        part_number: part,
        delta_qty: Number.parseInt(delta || "0", 10) || 0,
        reason,
      }),
    onSuccess: (row) => {
      toast.success(`${row.part_number} stock adjusted to ${row.qty}`);
      setShowAdjust(false);
      setPart("");
      setDelta("0");
      setReason("");
      void queryClient.invalidateQueries({ queryKey: ["stock"] });
      void queryClient.invalidateQueries({ queryKey: ["dashboard"] });
    },
    onError: (error) => toast.error(apiErrorMessage(error)),
  });

  return (
    <div className="space-y-4">
      <PageHeader
        title="Warehouse Stock"
        subtitle="On-hand, reserved (allocated but not billed) and free stock for every part"
        actions={
          <Button size="sm" onClick={() => setShowAdjust(true)} data-testid="stock-adjust-button">
            <SlidersHorizontal className="h-4 w-4" /> Adjust Stock
          </Button>
        }
      />

      <div className="overflow-hidden rounded-lg border bg-white shadow-xs">
        <Table data-testid="stock-table">
          <TableHeader>
            <TableRow>
              <TableHead>Part No</TableHead>
              <TableHead>Item</TableHead>
              <TableHead className="text-right">On Hand</TableHead>
              <TableHead className="text-right">Reserved</TableHead>
              <TableHead className="text-right">Free</TableHead>
              <TableHead>Unit</TableHead>
              <TableHead className="text-right">MRP</TableHead>
              <TableHead className="text-right">Tag MRP</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {(stock.data ?? []).map((row) => (
              <TableRow key={row.part_number} data-testid={`stock-row-${row.part_number}`}>
                <TableCell className="font-mono text-xs font-medium">{row.part_number}</TableCell>
                <TableCell>{row.item_name || "—"}</TableCell>
                <TableCell className="text-right font-medium tabular-nums">{row.qty}</TableCell>
                <TableCell className="text-right tabular-nums">{row.reserved}</TableCell>
                <TableCell className="text-right tabular-nums">{row.free}</TableCell>
                <TableCell>{row.unit}</TableCell>
                <TableCell className="text-right tabular-nums">{inr(row.mrp)}</TableCell>
                <TableCell className="text-right tabular-nums">{row.tag_mrp == null ? "—" : inr(row.tag_mrp)}</TableCell>
                <TableCell>
                  {row.qty === 0 ? (
                    <span
                      className="rounded border border-transparent bg-rose-100 px-1.5 py-0.5 text-[10px] font-semibold text-rose-700"
                      data-testid={`stock-status-${row.part_number}`}
                    >
                      OUT OF STOCK
                    </span>
                  ) : row.free <= 0 ? (
                    <span
                      className="rounded border border-transparent bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-800"
                      data-testid={`stock-status-${row.part_number}`}
                    >
                      FULLY RESERVED
                    </span>
                  ) : (
                    <span
                      className="rounded border border-transparent bg-emerald-100 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-700"
                      data-testid={`stock-status-${row.part_number}`}
                    >
                      AVAILABLE
                    </span>
                  )}
                </TableCell>
              </TableRow>
            ))}
            {(stock.data ?? []).length === 0 && (
              <TableRow>
                <TableCell colSpan={9} className="py-8 text-center text-sm text-muted-foreground">
                  {stock.isPending
                    ? "Loading stock…"
                    : "No stock records — add items and use Adjust Stock to set opening quantities."}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      <Dialog open={showAdjust} onOpenChange={setShowAdjust}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Adjust Stock</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label>Part</Label>
              <Select value={part} onValueChange={(value: string) => setPart(value)}>
                <SelectTrigger data-testid="stock-adjust-part-select">
                  <SelectValue placeholder="Select part" />
                </SelectTrigger>
                <SelectContent>
                  {(items.data ?? []).map((item) => (
                    <SelectItem key={item.id} value={item.part_number}>
                      {item.part_number} — {item.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="stock-delta">Quantity change (use minus to reduce)</Label>
              <Input
                id="stock-delta"
                type="number"
                value={delta}
                onChange={(e) => setDelta(e.target.value)}
                data-testid="stock-adjust-qty-input"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="stock-reason">Reason</Label>
              <Input
                id="stock-reason"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="e.g. opening stock, physical count"
                data-testid="stock-adjust-reason-input"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowAdjust(false)} data-testid="stock-adjust-cancel-button">
              Cancel
            </Button>
            <Button
              onClick={() => adjust.mutate()}
              disabled={adjust.isPending || !part || !delta}
              data-testid="stock-adjust-save-button"
            >
              {adjust.isPending ? "Saving…" : "Apply"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
