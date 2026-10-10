import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { CheckSquare, Receipt, ShoppingCart, Truck } from "lucide-react";

import { apiGet } from "@/lib/api";
import { inr, num, pct } from "@/lib/format";
import type { DashboardData } from "@/lib/types";
import { PageHeader, StatCard } from "@/components/ui-bits";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export default function Dashboard() {
  const dash = useQuery({
    queryKey: ["dashboard"],
    queryFn: () => apiGet<DashboardData>("/dashboard"),
    refetchInterval: 30_000,
  });
  const d = dash.data;
  // While the first fetch is in flight show an em dash, never a misleading zero.
  const v = (value: number | undefined, fmt: (n: number) => string): string =>
    dash.isPending || value === undefined ? "—" : fmt(value);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Command Center"
        subtitle="Everything waiting on the shop floor — orders, allocation, billing, purchases and alerts"
      />

      {dash.isError && (
        <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800" data-testid="dashboard-error">
          Live data unavailable right now — the workspace below is waiting for the backend.
        </p>
      )}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard label="Pending Orders" value={v(d?.pending_orders, num)} hint="orders not fully billed" testId="stat-pending-orders" />
        <StatCard label="Ready to Bill" value={v(d?.ready_to_bill_orders, num)} hint={`${v(d?.ready_to_bill_qty, num)} units ticked`} tone="sky" testId="stat-ready-to-bill" />
        <StatCard label="Open Purchase Orders" value={v(d?.open_purchase_orders, num)} testId="stat-open-pos" />
        <StatCard label="Allocated Not Received" value={v(d?.allocated_not_received, num)} hint="vendor invoices in transit" tone="amber" testId="stat-allocated-not-received" />
        <StatCard label="Short Received" value={v(d?.short_pending, num)} hint="awaiting vendor resupply" tone="rose" testId="stat-short-pending" />
        <StatCard label="MRP Discrepancies" value={v(d?.mrp_discrepancies, num)} hint="tag vs system > 1%" tone="rose" testId="stat-discrepancies" />
        <StatCard label="Stock Value" value={v(d?.stock_value, inr)} hint="on hand at MRP" tone="emerald" testId="stat-stock-value" />
        <StatCard label="Low Stock Alerts" value={v(d?.low_stock.length, num)} hint="parts with unmet demand" testId="stat-low-stock" />
      </div>

      <div className="flex flex-wrap gap-2">
        <Link to="/allocation" data-testid="quick-link-allocation">
          <Button variant="outline" size="sm">
            <CheckSquare className="h-4 w-4" /> Allocate Stock
          </Button>
        </Link>
        <Link to="/billing" data-testid="quick-link-billing">
          <Button variant="outline" size="sm">
            <Receipt className="h-4 w-4" /> Create GST Invoice
          </Button>
        </Link>
        <Link to="/purchase" data-testid="quick-link-purchase">
          <Button variant="outline" size="sm">
            <ShoppingCart className="h-4 w-4" /> Generate Purchase Order
          </Button>
        </Link>
        <Link to="/vendor-invoices" data-testid="quick-link-vendor-invoices">
          <Button variant="outline" size="sm">
            <Truck className="h-4 w-4" /> Receive Vendor Invoice
          </Button>
        </Link>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <div className="overflow-hidden rounded-lg border bg-white shadow-xs">
          <div className="flex items-center justify-between border-b px-4 py-2.5">
            <h3 className="font-heading text-sm font-semibold uppercase tracking-wider">Low Stock vs Pending Demand</h3>
            <Link to="/purchase" className="text-xs font-medium text-sky-700 hover:underline">
              Open Balance & PO →
            </Link>
          </div>
          <Table data-testid="dashboard-low-stock-table">
            <TableHeader>
              <TableRow>
                <TableHead>Part No</TableHead>
                <TableHead>Item</TableHead>
                <TableHead className="text-right">Free Stock</TableHead>
                <TableHead className="text-right">Pending Demand</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(d?.low_stock ?? []).map((row) => (
                <TableRow key={row.part_number} data-testid={`low-stock-row-${row.part_number}`}>
                  <TableCell className="font-mono text-xs">{row.part_number}</TableCell>
                  <TableCell>{row.item_name}</TableCell>
                  <TableCell className="text-right tabular-nums">{row.free_qty}</TableCell>
                  <TableCell className="text-right font-medium tabular-nums">{row.demand_qty}</TableCell>
                </TableRow>
              ))}
              {(d?.low_stock ?? []).length === 0 && (
                <TableRow>
                  <TableCell colSpan={4} className="py-6 text-center text-sm text-muted-foreground">
                    {dash.isPending ? "Loading…" : "No stock shortfalls — every pending unit is covered."}
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>

        <div className="overflow-hidden rounded-lg border bg-white shadow-xs">
          <div className="flex items-center justify-between border-b px-4 py-2.5">
            <h3 className="font-heading text-sm font-semibold uppercase tracking-wider">Tag MRP Discrepancies &gt; 1%</h3>
            <Link to="/vendor-invoices" className="text-xs font-medium text-sky-700 hover:underline">
              Open Vendor Invoices →
            </Link>
          </div>
          <Table data-testid="dashboard-discrepancy-table">
            <TableHeader>
              <TableRow>
                <TableHead>Vendor Inv</TableHead>
                <TableHead>Part No</TableHead>
                <TableHead className="text-right">System MRP</TableHead>
                <TableHead className="text-right">Tag MRP</TableHead>
                <TableHead className="text-right">Diff</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(d?.discrepancies ?? []).map((row) => (
                <TableRow key={`${row.vendor_invoice_no}-${row.part_number}`} data-testid={`discrepancy-row-${row.part_number}`}>
                  <TableCell className="font-mono text-xs">{row.vendor_invoice_no}</TableCell>
                  <TableCell className="font-mono text-xs">{row.part_number}</TableCell>
                  <TableCell className="text-right tabular-nums">{inr(row.system_mrp)}</TableCell>
                  <TableCell className="text-right tabular-nums">{inr(row.tag_mrp)}</TableCell>
                  <TableCell className="text-right font-semibold text-rose-700 tabular-nums">{pct(row.variance_percent)}</TableCell>
                </TableRow>
              ))}
              {(d?.discrepancies ?? []).length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} className="py-6 text-center text-sm text-muted-foreground">
                    {dash.isPending ? "Loading…" : "No tag-MRP discrepancies flagged."}
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      </div>
    </div>
  );
}
