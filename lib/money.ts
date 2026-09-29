export function money(value: number, showSign = false) {
  const formatted = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 }).format(Math.abs(value));
  return `${showSign ? value >= 0 ? '+' : '−' : value < 0 ? '−' : ''}₹${formatted}`;
}

// A null capital figure means the loss is unbounded; never show it as zero.
export function capitalAtRiskText(value: number | null) {
  return value === null ? 'Unlimited' : money(value);
}
