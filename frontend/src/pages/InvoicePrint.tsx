import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft, Printer } from "lucide-react";

import { apiGet } from "@/lib/api";
import type { AppConfig, SalesInvoice } from "@/lib/types";
import InvoiceDoc from "@/components/InvoiceDoc";
import { Button } from "@/components/ui/button";

export default function InvoicePrint() {
  const { invoiceId } = useParams<{ invoiceId: string }>();
  const invoice = useQuery({
    queryKey: ["invoice", invoiceId],
    queryFn: () => apiGet<SalesInvoice>(`/invoices/${invoiceId}`),
    enabled: !!invoiceId,
  });
  const config = useQuery({ queryKey: ["config"], queryFn: () => apiGet<AppConfig>("/config") });

  return (
    <div className="mx-auto max-w-4xl p-6">
      <div className="no-print mb-4 flex items-center justify-between">
        <Link
          to="/billing"
          className="flex items-center gap-1 text-sm font-medium text-sky-700 hover:underline"
          data-testid="print-back-link"
        >
          <ArrowLeft className="h-4 w-4" /> Back to Billing
        </Link>
        <Button onClick={() => window.print()} data-testid="print-invoice-button">
          <Printer className="h-4 w-4" /> Print / Save PDF
        </Button>
      </div>
      {invoice.data && <InvoiceDoc invoice={invoice.data} seller={config.data?.seller ?? null} />}
      {invoice.isError && (
        <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          Invoice could not be loaded — return to Billing and try again.
        </p>
      )}
    </div>
  );
}
