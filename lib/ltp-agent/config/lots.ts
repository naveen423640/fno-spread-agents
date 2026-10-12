// Lot sizes by date. Never hardcoded in the agent: the agent asks for the lot size in force on the trading day.
// Only the sizes in force when this table was written (2026-10-12, read from the real tool) are here. Add earlier rows before replaying older days;
// a date before the first row throws instead of guessing.
type LotRow = { underlying: string; effectiveFrom: string; lot: number };
export const LOT_SIZES: LotRow[] = [
  { underlying: 'NSE:NIFTY50-INDEX', effectiveFrom: '2026-10-01', lot: 65 },
  { underlying: 'NSE:NIFTYBANK-INDEX', effectiveFrom: '2026-10-01', lot: 30 },
  { underlying: 'BSE:SENSEX-INDEX', effectiveFrom: '2026-10-01', lot: 20 },
];

export function lotSizeOn(underlying: string, date: string): number {
  const rows = LOT_SIZES.filter((r) => r.underlying === underlying);
  if (!rows.length) throw new Error(`No lot size known for ${underlying}.`);
  const row = rows.filter((r) => r.effectiveFrom <= date).sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom))[0];
  if (!row) throw new Error(`No lot size for ${underlying} on ${date}: the table starts at ${rows[0].effectiveFrom}.`);
  return row.lot;
}
