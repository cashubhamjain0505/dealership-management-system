import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";

import { apiErrorMessage, apiGet, apiPatch } from "@/lib/api";
import { inr, pct } from "@/lib/format";
import type { Item } from "@/lib/types";
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

export default function PriceList() {
  const queryClient = useQueryClient();
  const items = useQuery({ queryKey: ["items"], queryFn: () => apiGet<Item[]>("/items") });
  const [editing, setEditing] = useState<Item | null>(null);
  const [ndp, setNdp] = useState("");

  const saveNdp = useMutation({
    mutationFn: () =>
      apiPatch<Item>(`/items/${editing?.id ?? ""}`, { ndp: Number.parseFloat(ndp || "0") || 0 }),
    onSuccess: () => {
      toast.success("NDP updated — MRP recalculated (NDP × 1.18 ÷ 0.78)");
      void queryClient.invalidateQueries({ queryKey: ["items"] });
      setEditing(null);
    },
    onError: (error: unknown) => toast.error(apiErrorMessage(error)),
  });

  return (
    <div className="space-y-4">
      <PageHeader
        title="Price List & NDP Formula"
        subtitle="Upload an updated price list to change MRP; the system MRP is derived from NDP"
      />

      <div className="flex flex-wrap items-center gap-4 rounded-lg border-2 border-sky-200 bg-sky-50 p-4">
        <div className="font-mono text-lg font-semibold text-sky-900" data-testid="mrp-formula">
          MRP = NDP × 1.18 ÷ 0.78
        </div>
        <p className="max-w-lg text-xs text-slate-600">
          NDP is the Net Dealer Price from the company. The formula adds 18% GST and the dealer margin factor.
          When the physical tag MRP differs from the system MRP by more than 1%, the item is flagged for
          correction or vendor claim.
        </p>
      </div>

      <ExcelUpload
        endpoint="/price-list/upload"
        templateKind="price-list"
        label="Upload price list Excel (part number, NDP, optional MRP / tag MRP)"
        onUploaded={() => void queryClient.invalidateQueries({ queryKey: ["items"] })}
        testId="price-list-upload"
      />

      <div className="overflow-hidden rounded-lg border bg-white shadow-xs">
        <Table data-testid="price-list-table">
          <TableHeader>
            <TableRow>
              <TableHead>Part No</TableHead>
              <TableHead>Name</TableHead>
              <TableHead className="text-right">NDP</TableHead>
              <TableHead className="text-right">System MRP</TableHead>
              <TableHead className="text-right">Tag MRP</TableHead>
              <TableHead>Variance Check</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {(items.data ?? []).map((item) => {
              const variance =
                item.tag_mrp && item.tag_mrp > 0 && item.mrp > 0
                  ? Math.abs(item.mrp - item.tag_mrp) / item.tag_mrp
                  : null;
              return (
                <TableRow key={item.id} data-testid={`price-row-${item.part_number}`}>
                  <TableCell className="font-mono text-xs font-medium">{item.part_number}</TableCell>
                  <TableCell>{item.name}</TableCell>
                  <TableCell className="text-right tabular-nums">{inr(item.ndp)}</TableCell>
                  <TableCell className="text-right font-medium tabular-nums">{inr(item.mrp)}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {item.tag_mrp == null ? "—" : inr(item.tag_mrp)}
                  </TableCell>
                  <TableCell>
                    {variance == null ? (
                      <span className="text-xs text-muted-foreground">Tag MRP not set</span>
                    ) : variance > 0.01 ? (
                      <StatusBadge status="short" testId={`price-variance-${item.part_number}`} />
                    ) : (
                      <span className="text-xs font-medium text-emerald-700">Within 1%</span>
                    )}
                    {variance != null && (
                      <span className="ml-2 text-xs text-muted-foreground">{pct(variance)}</span>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    <Button
                      variant="outline"
                      size="xs"
                      onClick={() => {
                        setEditing(item);
                        setNdp(String(item.ndp || ""));
                      }}
                      data-testid={`price-edit-${item.part_number}`}
                    >
                      Edit NDP
                    </Button>
                  </TableCell>
                </TableRow>
              );
            })}
            {(items.data ?? []).length === 0 && (
              <TableRow>
                <TableCell colSpan={7} className="py-8 text-center text-sm text-muted-foreground">
                  {items.isPending ? "Loading price list…" : "No items yet — add items under Masters first."}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      <Dialog open={!!editing} onOpenChange={(next) => !next && setEditing(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Edit NDP — {editing?.part_number}</DialogTitle>
          </DialogHeader>
          <div className="space-y-1">
            <Label htmlFor="price-ndp">NDP</Label>
            <Input
              id="price-ndp"
              type="number"
              value={ndp}
              onChange={(e) => setNdp(e.target.value)}
              data-testid="price-ndp-input"
            />
            <p className="text-xs text-muted-foreground">
              New MRP: <span className="font-mono font-semibold" data-testid="price-mrp-preview">
                {inr(((Number.parseFloat(ndp || "0") || 0) * 1.18) / 0.78)}
              </span>
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(null)} data-testid="price-cancel-button">
              Cancel
            </Button>
            <Button onClick={() => saveNdp.mutate()} disabled={saveNdp.isPending} data-testid="price-save-button">
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
