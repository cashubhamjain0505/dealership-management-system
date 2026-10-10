// Indian-locale formatters for the dense data tables (₹, en-IN grouping, tabular nums).

const inrFormatter = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 2,
});

const numFormatter = new Intl.NumberFormat("en-IN");

export const inr = (value: number | null | undefined): string =>
  value == null ? "—" : inrFormatter.format(value);

export const num = (value: number | null | undefined): string =>
  value == null ? "—" : numFormatter.format(value);

export const pct = (fraction: number | null | undefined): string =>
  fraction == null ? "—" : `${(fraction * 100).toFixed(2)}%`;
