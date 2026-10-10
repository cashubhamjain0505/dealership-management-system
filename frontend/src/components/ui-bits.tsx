import type { ReactNode } from "react";

import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";

export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h2 className="font-heading text-2xl font-semibold tracking-tight">{title}</h2>
        {subtitle && <p className="text-sm text-muted-foreground">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

const STATUS_STYLES: Record<string, string> = {
  open: "bg-slate-100 text-slate-700",
  pending: "bg-slate-100 text-slate-700",
  draft: "bg-amber-100 text-amber-800",
  sent: "bg-sky-100 text-sky-700",
  partial: "bg-sky-100 text-sky-700",
  partially_received: "bg-sky-100 text-sky-700",
  allocated: "bg-sky-100 text-sky-700",
  allocated_not_received: "bg-amber-100 text-amber-800",
  billed: "bg-emerald-100 text-emerald-700",
  received: "bg-emerald-100 text-emerald-700",
  resolved: "bg-emerald-100 text-emerald-700",
  unmapped: "bg-rose-100 text-rose-700",
  short: "bg-rose-100 text-rose-700",
};

export function StatusBadge({ status, testId }: { status: string; testId?: string }) {
  return (
    <Badge
      variant="outline"
      data-testid={testId}
      className={cn("border-transparent capitalize", STATUS_STYLES[status] ?? "bg-slate-100 text-slate-700")}
    >
      {status.replace(/_/g, " ")}
    </Badge>
  );
}

const TONES = {
  default: "border-slate-200",
  sky: "border-sky-300",
  amber: "border-amber-300",
  rose: "border-rose-300",
  emerald: "border-emerald-300",
} as const;

export function StatCard({
  label,
  value,
  hint,
  tone = "default",
  testId,
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: keyof typeof TONES;
  testId?: string;
}) {
  return (
    <div data-testid={testId} className={cn("rounded-lg border-2 bg-white p-4 shadow-xs", TONES[tone])}>
      <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className="mt-1 font-heading text-2xl font-semibold tracking-tight tabular-nums">{value}</p>
      {hint && <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}
