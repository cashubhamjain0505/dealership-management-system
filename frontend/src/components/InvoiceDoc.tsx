import { inr, num } from "@/lib/format";
import type { SalesInvoice, SellerInfo } from "@/lib/types";

// Printable GST tax invoice: tag-MRP pricing, discount, HSN-wise CGST/SGST/IGST breakup, IRN + e-way bill box.
export default function InvoiceDoc({ invoice, seller }: { invoice: SalesInvoice; seller: SellerInfo | null }) {
  const t = invoice.totals;
  const intra = invoice.supply_type === "intra";
  return (
    <div className="text-[13px] leading-relaxed text-slate-900" data-testid="invoice-doc">
      <div className="border-2 border-slate-900">
        <div className="border-b-2 border-slate-900 px-4 py-3 text-center">
          <h1 className="font-heading text-xl font-bold uppercase tracking-tight">{seller?.name ?? "Seller"}</h1>
          <p className="text-xs text-slate-600">{seller?.address}</p>
          <p className="text-xs font-medium">GSTIN: {seller?.gstin} · State Code: {seller?.state_code}</p>
          <p className="mt-1 font-heading text-sm font-bold uppercase tracking-widest">Tax Invoice</p>
        </div>

        <div className="grid grid-cols-1 border-b-2 border-slate-900 md:grid-cols-2">
          <div className="border-slate-900 px-4 py-3 md:border-r-2">
            <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Buyer (Bill To)</p>
            <p className="font-semibold">{invoice.customer.name}</p>
            <p className="text-xs text-slate-600">{invoice.customer.address}</p>
            <p className="text-xs">GSTIN: {invoice.customer.gstin || "—"} · State: {invoice.customer.state_code || "—"}</p>
            <p className="text-xs capitalize">Type: {invoice.customer.customer_type} · Discount: {invoice.customer.discount_percent}%</p>
          </div>
          <div className="px-4 py-3">
            <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Invoice Details</p>
            <div className="grid grid-cols-2 gap-x-4 text-xs">
              <span className="text-slate-500">Invoice No</span>
              <span className="text-right font-mono font-semibold" data-testid="invoice-doc-number">{invoice.invoice_no}</span>
              <span className="text-slate-500">Invoice Date</span>
              <span className="text-right font-mono">{invoice.invoice_date}</span>
              <span className="text-slate-500">Order Ref</span>
              <span className="text-right font-mono">{invoice.order_ref}</span>
              <span className="text-slate-500">Supply Type</span>
              <span className="text-right">{intra ? "Intra-state (CGST+SGST)" : "Inter-state (IGST)"}</span>
            </div>
          </div>
        </div>

        <table className="w-full border-b-2 border-slate-900 text-xs">
          <thead>
            <tr className="bg-slate-100 text-left">
              <th className="px-2 py-1.5 font-semibold">Sr</th>
              <th className="px-2 py-1.5 font-semibold">Part No</th>
              <th className="px-2 py-1.5 font-semibold">Description</th>
              <th className="px-2 py-1.5 font-semibold">HSN</th>
              <th className="px-2 py-1.5 text-right font-semibold">Qty</th>
              <th className="px-2 py-1.5 text-right font-semibold">Rate (Tag MRP)</th>
              <th className="px-2 py-1.5 text-right font-semibold">Disc</th>
              <th className="px-2 py-1.5 text-right font-semibold">Taxable</th>
              <th className="px-2 py-1.5 text-right font-semibold">{intra ? "CGST+SGST" : "IGST"}</th>
              <th className="px-2 py-1.5 text-right font-semibold">Amount</th>
            </tr>
          </thead>
          <tbody>
            {invoice.lines.map((line, index) => (
              <tr key={line.id} className="border-t border-slate-200">
                <td className="px-2 py-1.5">{index + 1}</td>
                <td className="px-2 py-1.5 font-mono">{line.part_number}</td>
                <td className="px-2 py-1.5">{line.item_name}</td>
                <td className="px-2 py-1.5 font-mono">{line.hsn || "—"}</td>
                <td className="px-2 py-1.5 text-right tabular-nums">{num(line.qty)} {line.unit}</td>
                <td className="px-2 py-1.5 text-right tabular-nums">{inr(line.rate)}</td>
                <td className="px-2 py-1.5 text-right tabular-nums">{line.discount_percent}%</td>
                <td className="px-2 py-1.5 text-right tabular-nums">{inr(line.taxable)}</td>
                <td className="px-2 py-1.5 text-right tabular-nums">{inr(intra ? line.cgst + line.sgst : line.igst)}</td>
                <td className="px-2 py-1.5 text-right font-medium tabular-nums">{inr(line.amount)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="grid grid-cols-1 border-b-2 border-slate-900 md:grid-cols-2">
          <div className="px-4 py-3 md:border-r-2 md:border-slate-900">
            <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">HSN Summary</p>
            <table className="mt-1 w-full text-xs">
              <thead>
                <tr className="bg-slate-100 text-left">
                  <th className="px-2 py-1 font-semibold">HSN</th>
                  <th className="px-2 py-1 text-right font-semibold">Taxable</th>
                  <th className="px-2 py-1 text-right font-semibold">{intra ? "CGST+SGST" : "IGST"}</th>
                  <th className="px-2 py-1 text-right font-semibold">Total</th>
                </tr>
              </thead>
              <tbody>
                {invoice.hsn_summary.map((row) => (
                  <tr key={`${row.hsn}-${row.gst_rate}`} className="border-t border-slate-200">
                    <td className="px-2 py-1 font-mono">{row.hsn}</td>
                    <td className="px-2 py-1 text-right tabular-nums">{inr(row.taxable)}</td>
                    <td className="px-2 py-1 text-right tabular-nums">{inr(intra ? row.cgst + row.sgst : row.igst)}</td>
                    <td className="px-2 py-1 text-right tabular-nums">{inr(row.total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="px-4 py-3">
            <div className="grid grid-cols-2 gap-x-4 text-xs">
              <span className="text-slate-500">Subtotal</span>
              <span className="text-right tabular-nums">{inr(t.subtotal)}</span>
              <span className="text-slate-500">Discount</span>
              <span className="text-right tabular-nums">− {inr(t.discount_amount)}</span>
              <span className="text-slate-500">Taxable Value</span>
              <span className="text-right tabular-nums">{inr(t.taxable)}</span>
              {intra ? (
                <>
                  <span className="text-slate-500">CGST</span>
                  <span className="text-right tabular-nums">{inr(t.cgst)}</span>
                  <span className="text-slate-500">SGST</span>
                  <span className="text-right tabular-nums">{inr(t.sgst)}</span>
                </>
              ) : (
                <>
                  <span className="text-slate-500">IGST</span>
                  <span className="text-right tabular-nums">{inr(t.igst)}</span>
                </>
              )}
              <span className="mt-1 border-t border-slate-300 pt-1 font-semibold">Total Payable</span>
              <span className="mt-1 border-t border-slate-300 pt-1 text-right font-heading text-base font-bold tabular-nums" data-testid="invoice-doc-total">
                {inr(t.total)}
              </span>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-3 px-4 py-3 md:grid-cols-2">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">E-Invoice (IRN)</p>
            {invoice.irn ? (
              <div className="text-xs">
                <p className="font-mono break-all" data-testid="invoice-doc-irn">{invoice.irn.irn}</p>
                <p className="mt-0.5">Ack No: {invoice.irn.ack_no} · Ack Date: {invoice.irn.ack_date}</p>
                {invoice.ewb && (
                  <p className="mt-1" data-testid="invoice-doc-ewb">
                    E-Way Bill No: <span className="font-mono font-semibold">{invoice.ewb.ewb_no}</span> · Valid till {invoice.ewb.valid_till}
                    {invoice.ewb.vehicle_no ? ` · Vehicle: ${invoice.ewb.vehicle_no}` : ""}
                  </p>
                )}
                {invoice.irn.simulated && (
                  <p className="mt-1 rounded bg-amber-50 px-2 py-1 text-[11px] text-amber-800">
                    Simulated IRN — for internal trial until GSP credentials are configured (GST_MODE=simulated).
                  </p>
                )}
              </div>
            ) : (
              <p className="text-xs text-slate-500">Not generated yet</p>
            )}
          </div>
          <div className="flex items-end justify-end">
            <p className="text-right text-xs text-slate-500">For {seller?.name ?? "Seller"}</p>
          </div>
        </div>
      </div>
    </div>
  );
}
