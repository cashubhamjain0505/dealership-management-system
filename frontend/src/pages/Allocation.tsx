import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Wand2 } from "lucide-react";
import { toast } from "sonner";

import { apiErrorMessage, apiGet, apiPatch, apiPost } from "@/lib/api";
import type { Order, OrderLine, StockRow } from "@/lib/types";
import { cn } from "@/lib/utils";
import { PageHeader, StatusBadge } from "@/components/ui-bits";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export default function Allocation() {
  const queryClient = useQueryClient();
  const orders = useQuery({ queryKey: ["orders"], queryFn: () => apiGet<Order[]>("/orders") });
  const stock = useQuery({ queryKey: ["stock"], queryFn: () => apiGet<StockRow[]>("/stock") });

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [targets, setTargets] = useState<Record<string, number>>({});

  const openOrders = useMemo(
    () => (orders.data ?? []).filter((order) => order.status !== "billed"),
    [orders.data],
  );
  const selected = openOrders.find((order) => order.id === selectedId) ?? null;

  useEffect(() => {
    setTargets({});
  }, [selectedId]);

  const stockByPart = useMemo(() => {
    const map: Record<string, StockRow> = {};
    for (const row of stock.data ?? []) map[row.part_number] = row;
    return map;
  }, [stock.data]);

  // Free stock for a line = on-hand minus all other reservations (this line's own released back).
  function freeForLine(line: OrderLine): number {
    const row = stockByPart[line.part_number];
    if (!row) return 0;
    const ownReserved = Math.max(line.allocated_qty - line.billed_qty, 0);
    return row.qty - (row.reserved - ownReserved);
  }

  function tick(line: OrderLine, checked: boolean) {
    setTargets((prev) => {
      const next = { ...prev };
      if (checked) {
        const max = Math.min(line.ordered_qty - line.billed_qty, Math.max(freeForLine(line), 0));
        if (max <= 0) {
          toast.warning(`${line.part_number}: no free stock in the warehouse right now`);
          next[line.id] = line.allocated_qty;
        } else {
          next[line.id] = max;
        }
      } else {
        next[line.id] = 0;
      }
      return next;
    });
  }

  const save = useMutation({
    mutationFn: () =>
      apiPatch<Order>(`/orders/${selected?.id ?? ""}/allocate`, {
        lines: (selected?.lines ?? []).map((line) => ({
          line_id: line.id,
          allocated_qty: targets[line.id] ?? line.allocated_qty,
        })),
      }),
    onSuccess: () => {
      toast.success("Allocation saved — ticked parts are ready to bill");
      void queryClient.invalidateQueries({ queryKey: ["orders"] });
      void queryClient.invalidateQueries({ queryKey: ["stock"] });
      void queryClient.invalidateQueries({ queryKey: ["dashboard"] });
    },
    onError: (error) => toast.error(apiErrorMessage(error)),
  });

  const autoAllocate = useMutation({
    mutationFn: () => apiPost<Order>(`/orders/${selected?.id ?? ""}/auto-allocate`),
    onSuccess: () => {
      toast.success("Auto-allocated up to available stock");
      void queryClient.invalidateQueries({ queryKey: ["orders"] });
      void queryClient.invalidateQueries({ queryKey: ["stock"] });
    },
    onError: (error) => toast.error(apiErrorMessage(error)),
  });

  return (
    <div className="space-y-4">
      <PageHeader
        title="Stock Allocation"
        subtitle="Check the warehouse stock and tick the parts to allocate to each party — ticked parts go to billing"
      />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[320px_1fr]">
        <div className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Orders awaiting allocation
          </p>
          {openOrders.map((order) => {
            const pending = order.lines.reduce((sum, line) => sum + (line.ordered_qty - line.billed_qty), 0);
            const ready = order.lines.reduce(
              (sum, line) => sum + Math.max((targets[line.id] ?? line.allocated_qty) - line.billed_qty, 0),
              0,
            );
            return (
              <button
                key={order.id}
                onClick={() => setSelectedId(order.id)}
                data-testid={`allocation-order-${order.order_ref}`}
                className={cn(
                  "w-full rounded-lg border-2 p-3 text-left transition-colors duration-150",
                  order.id === selectedId ? "border-sky-500 bg-sky-50" : "border-slate-200 bg-white hover:border-sky-300",
                )}
              >
                <p className="font-mono text-xs font-semibold">{order.order_ref}</p>
                <p className="truncate text-sm">{order.customer.name}</p>
                <p className="text-xs text-muted-foreground">
                  {pending} pending · {ready} ticked to allocate
                </p>
              </button>
            );
          })}
          {openOrders.length === 0 && (
            <p className="rounded-lg border bg-white p-4 text-sm text-muted-foreground">
              No open orders — upload or create a customer order first.
            </p>
          )}
        </div>

        <div className="space-y-3">
          {selected ? (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <div className="mr-auto">
                  <p className="font-heading text-lg font-semibold tracking-tight">{selected.order_ref}</p>
                  <p className="text-sm text-muted-foreground">
                    {selected.customer.name} · {selected.order_date} · discount {selected.customer.discount_percent}%
                  </p>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => autoAllocate.mutate()}
                  disabled={autoAllocate.isPending}
                  data-testid="auto-allocate-button"
                >
                  <Wand2 className="h-4 w-4" /> Auto Allocate
                </Button>
                <Button
                  size="sm"
                  onClick={() => save.mutate()}
                  disabled={save.isPending}
                  data-testid="save-allocation-button"
                >
                  {save.isPending ? "Saving…" : "Save Allocation"}
                </Button>
              </div>

              <div className="overflow-hidden rounded-lg border bg-white shadow-xs">
                <Table data-testid="allocation-table">
                  <TableHeader>
                    <TableRow>
                      <TableHead>Tick</TableHead>
                      <TableHead>Part No</TableHead>
                      <TableHead>Item</TableHead>
                      <TableHead className="text-right">Ordered</TableHead>
                      <TableHead className="text-right">Billed</TableHead>
                      <TableHead className="text-right">Warehouse On-Hand</TableHead>
                      <TableHead className="text-right">Free Here</TableHead>
                      <TableHead className="text-right">Allocate Qty</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {selected.lines.map((line) => {
                      const value = targets[line.id] ?? line.allocated_qty;
                      const ticked = value > 0;
                      const free = Math.max(freeForLine(line), 0);
                      return (
                        <TableRow
                          key={line.id}
                          data-testid={`allocation-row-${line.part_number}`}
                          className={cn("transition-colors duration-150", ticked && "bg-sky-50")}
                        >
                          <TableCell>
                            <input
                              type="checkbox"
                              checked={ticked}
                              onChange={(e) => tick(line, e.target.checked)}
                              data-testid={`allocate-checkbox-${line.part_number}`}
                              className="h-4 w-4 accent-sky-600"
                            />
                          </TableCell>
                          <TableCell className="font-mono text-xs font-medium">{line.part_number}</TableCell>
                          <TableCell>{line.item_name || "—"}</TableCell>
                          <TableCell className="text-right tabular-nums">{line.ordered_qty}</TableCell>
                          <TableCell className="text-right tabular-nums">{line.billed_qty}</TableCell>
                          <TableCell className="text-right tabular-nums">
                            {stockByPart[line.part_number]?.qty ?? 0}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">{free}</TableCell>
                          <TableCell className="text-right">
                            <Input
                              type="number"
                              value={value}
                              min={0}
                              max={line.ordered_qty - line.billed_qty}
                              onChange={(e) =>
                                setTargets((prev) => ({
                                  ...prev,
                                  [line.id]: Math.max(Number.parseInt(e.target.value || "0", 10) || 0, 0),
                                }))
                              }
                              className="w-20 text-right"
                              data-testid={`allocate-qty-${line.part_number}`}
                            />
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
              <p className="text-xs text-muted-foreground">
                Ticked quantity is reserved from warehouse stock; billing deducts it on invoice creation. Unmapped
                parts must be fixed in the order (or given an alternate part number) before allocation.
              </p>
            </>
          ) : (
            <div className="flex h-64 items-center justify-center rounded-lg border bg-white text-sm text-muted-foreground">
              Select an order on the left to tick parts for allocation.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
