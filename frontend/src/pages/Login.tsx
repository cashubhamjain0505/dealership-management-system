import { useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { KeyRound } from "lucide-react";
import { toast } from "sonner";

import { apiErrorMessage, apiGet, apiPost } from "@/lib/api";
import { beginSession } from "@/lib/session";
import type { Me } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const WORKSHOP_IMAGE =
  "https://images.unsplash.com/photo-1771402629441-95e637743f93?crop=entropy&cs=srgb&fm=jpg&ixid=M3w4NjA1NzV8MHwxfHNlYXJjaHwyfHxtb3RvcmN5Y2xlJTIwcGFydHMlMjB3b3Jrc2hvcHxlbnwwfHx8fDE3OTE2NTA4OTF8MA&ixlib=rb-4.1.0&q=85";

export default function Login() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const me = useQuery({ queryKey: ["me"], queryFn: () => apiGet<Me>("/auth/me"), retry: false });
  const [staffName, setStaffName] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  if (me.isSuccess) return <Navigate to="/dashboard" replace />;

  async function submit() {
    setBusy(true);
    setError("");
    try {
      const result = await apiPost<Me>("/auth/login", { password, staff_name: staffName || "Staff" });
      queryClient.setQueryData(["me"], result);
      beginSession();
      toast.success(`Welcome, ${result.staff_name}`);
      navigate("/dashboard", { replace: true });
    } catch (err) {
      setError(apiErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid min-h-svh bg-background lg:grid-cols-2">
      <div className="relative hidden lg:block">
        <img src={WORKSHOP_IMAGE} alt="Two-wheeler spare parts workshop" className="absolute inset-0 h-full w-full object-cover" />
        <div className="absolute inset-0 bg-gradient-to-t from-slate-950/90 via-slate-950/40 to-transparent" />
        <div className="absolute bottom-10 left-10 max-w-md text-white">
          <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-lg bg-red-600 font-heading text-2xl font-bold">
            S
          </div>
          <h1 className="font-heading text-3xl font-bold tracking-tight">PartsDesk</h1>
          <p className="mt-2 text-sm text-slate-200">
            Suzuki two-wheeler spare parts — orders, allocation, GST billing, DMS purchase orders and
            e-invoice / e-way bill, all in one desk.
          </p>
        </div>
      </div>
      <div className="flex items-center justify-center p-6">
        <div className="w-full max-w-sm space-y-6">
          <div className="space-y-1">
            <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-md bg-red-600 font-heading text-lg font-bold text-white lg:hidden">
              S
            </div>
            <h2 className="font-heading text-2xl font-semibold tracking-tight">Staff Sign In</h2>
            <p className="text-sm text-muted-foreground">Shared staff password — enter your name so bills can show who billed.</p>
          </div>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label htmlFor="login-staff">Your Name</Label>
              <Input
                id="login-staff"
                value={staffName}
                onChange={(e) => setStaffName(e.target.value)}
                placeholder="e.g. Ramesh"
                data-testid="login-staff-name-input"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="login-password">Password</Label>
              <Input
                id="login-password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && void submit()}
                placeholder="Shared staff password"
                data-testid="login-password-input"
              />
            </div>
            {error && (
              <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700" data-testid="login-error">
                {error}
              </p>
            )}
            <Button className="w-full" onClick={() => void submit()} disabled={busy || !password} data-testid="login-submit-button">
              <KeyRound className="h-4 w-4" />
              {busy ? "Signing in…" : "Sign In"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
