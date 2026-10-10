import type { ReactElement } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";

import { apiGet } from "@/lib/api";
import type { Me } from "@/lib/types";
import AppShell from "@/components/AppShell";
import Allocation from "@/pages/Allocation";
import Billing from "@/pages/Billing";
import Dashboard from "@/pages/Dashboard";
import InvoicePrint from "@/pages/InvoicePrint";
import Login from "@/pages/Login";
import Masters from "@/pages/Masters";
import Orders from "@/pages/Orders";
import PriceList from "@/pages/PriceList";
import Purchase from "@/pages/Purchase";
import ShortItems from "@/pages/ShortItems";
import Stock from "@/pages/Stock";
import VendorInvoices from "@/pages/VendorInvoices";

// Gates every tab on the shared staff session. While the check is in flight a branded
// splash renders (never blank), and a failed check lands on /login.
function RequireAuth({ children }: { children: ReactElement }) {
  const { isPending, isError } = useQuery({
    queryKey: ["me"],
    queryFn: () => apiGet<Me>("/auth/me"),
    retry: false,
    staleTime: 60_000,
  });
  if (isPending) {
    return (
      <div className="flex min-h-svh items-center justify-center bg-background">
        <p className="font-heading text-lg font-semibold tracking-tight text-slate-400">PartsDesk…</p>
      </div>
    );
  }
  if (isError) return <Navigate to="/login" replace />;
  return children;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route
        path="/invoices/:invoiceId/print"
        element={
          <RequireAuth>
            <InvoicePrint />
          </RequireAuth>
        }
      />
      <Route
        element={
          <RequireAuth>
            <AppShell />
          </RequireAuth>
        }
      >
        <Route path="/" element={<Navigate to="/dashboard" replace />} />
        <Route path="/dashboard" element={<Dashboard />} />
        <Route path="/masters" element={<Masters />} />
        <Route path="/price-list" element={<PriceList />} />
        <Route path="/orders" element={<Orders />} />
        <Route path="/allocation" element={<Allocation />} />
        <Route path="/billing" element={<Billing />} />
        <Route path="/purchase" element={<Purchase />} />
        <Route path="/vendor-invoices" element={<VendorInvoices />} />
        <Route path="/short-items" element={<ShortItems />} />
        <Route path="/stock" element={<Stock />} />
      </Route>
      <Route path="*" element={<Navigate to="/dashboard" replace />} />
    </Routes>
  );
}
