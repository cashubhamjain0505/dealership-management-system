import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  AlertTriangle,
  Boxes,
  Calculator,
  CheckSquare,
  Database,
  FileSpreadsheet,
  LayoutDashboard,
  LogOut,
  Receipt,
  ShoppingCart,
  Truck,
} from "lucide-react";
import { toast } from "sonner";

import { apiGet } from "@/lib/api";
import { endSession } from "@/lib/session";
import type { AppConfig, Me } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

const TABS = [
  { to: "/dashboard", label: "Command Center", icon: LayoutDashboard },
  { to: "/masters", label: "Masters", icon: Database },
  { to: "/price-list", label: "Price List", icon: Calculator },
  { to: "/orders", label: "Customer Orders", icon: FileSpreadsheet },
  { to: "/allocation", label: "Stock Allocation", icon: CheckSquare },
  { to: "/billing", label: "Billing & E-Invoice", icon: Receipt },
  { to: "/purchase", label: "Balance & PO", icon: ShoppingCart },
  { to: "/vendor-invoices", label: "Vendor Invoices", icon: Truck },
  { to: "/short-items", label: "Short Received", icon: AlertTriangle },
  { to: "/stock", label: "Warehouse Stock", icon: Boxes },
];

export default function AppShell() {
  const navigate = useNavigate();
  const me = useQuery({ queryKey: ["me"], queryFn: () => apiGet<Me>("/auth/me"), retry: false });
  const config = useQuery({ queryKey: ["config"], queryFn: () => apiGet<AppConfig>("/config") });

  async function handleLogout() {
    await endSession();
    toast.info("Signed out");
    navigate("/login", { replace: true });
  }

  return (
    <div className="min-h-svh bg-background">
      <header className="no-print sticky top-0 z-40 border-b bg-white/90 shadow-sm backdrop-blur-md">
        <div className="mx-auto flex max-w-[1400px] items-center gap-3 px-4 py-2.5 md:px-6">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-red-600 font-heading text-lg font-bold text-white">
            S
          </div>
          <div className="min-w-0">
            <h1 className="font-heading text-lg font-semibold tracking-tight">PartsDesk</h1>
            <p className="truncate text-xs text-muted-foreground">Suzuki 2-Wheeler Spare Parts ERP</p>
          </div>
          <div className="ml-auto flex items-center gap-3">
            {config.data && (
              <Badge
                variant="outline"
                data-testid="gst-mode-badge"
                className={
                  config.data.gst_mode === "live"
                    ? "border-emerald-300 bg-emerald-50 text-emerald-700"
                    : "border-amber-300 bg-amber-50 text-amber-800"
                }
              >
                E-Invoice: {config.data.gst_mode === "live" ? "LIVE" : "SIMULATED"}
              </Badge>
            )}
            <span className="hidden text-sm text-muted-foreground md:inline" data-testid="staff-name">
              {me.data?.staff_name ?? "Staff"}
            </span>
            <Button variant="ghost" size="sm" onClick={handleLogout} data-testid="logout-button">
              <LogOut className="h-4 w-4" />
              Logout
            </Button>
          </div>
        </div>
        <nav className="mx-auto max-w-[1400px] overflow-x-auto px-4 scrollbar-none md:px-6">
          <div className="flex gap-1">
            {TABS.map(({ to, label, icon: Icon }) => (
              <NavLink
                key={to}
                to={to}
                data-testid={`tab-${to.slice(1)}`}
                className={({ isActive }) =>
                  cn(
                    "flex shrink-0 items-center gap-1.5 border-b-2 px-3 py-2 text-sm font-medium transition-colors duration-150",
                    isActive
                      ? "border-sky-600 bg-sky-50/60 text-sky-700"
                      : "border-transparent text-slate-500 hover:text-slate-900",
                  )
                }
              >
                <Icon className="h-4 w-4" />
                {label}
              </NavLink>
            ))}
          </div>
        </nav>
      </header>
      <main className="mx-auto max-w-[1400px] p-4 md:p-6 lg:p-8">
        <Outlet />
      </main>
    </div>
  );
}
