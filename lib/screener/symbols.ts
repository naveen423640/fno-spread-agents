// Ports of nice_step, monthly_expiry, fy_sym and fy_opt in screener/fo_spread_screener.py, plus the Kite formats from
// screener/trade-rules.md section 7.

export const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'] as const;

// The usual strike spacing for a price level (approximate).
export function niceStep(price: number): number {
  return price < 200 ? 5 : price < 1000 ? 10 : price < 2000 ? 20 : price < 5000 ? 50 : 100;
}

const iso = (d: Date) => d.toISOString().slice(0, 10);

// Stock F&O monthly expiry: the last Tuesday of the month, or of next month if this month's has passed. The broker's
// calendar is the authority (a holiday moves the expiry), so the UI always tells the user to confirm it.
export function monthlyExpiry(todayIso: string): string {
  const [ty, tm] = todayIso.split('-').map(Number);
  let candidate = '';
  for (const add of [0, 1]) {
    const index = tm - 1 + add;
    const year = ty + Math.floor(index / 12);
    const month = (index % 12) + 1;
    const d = new Date(Date.UTC(year, month, 0)); // day 0 of the next month = last day of this month
    while (d.getUTCDay() !== 2) d.setUTCDate(d.getUTCDate() - 1);
    candidate = iso(d);
    if (candidate >= todayIso) return candidate;
  }
  return candidate;
}

export function expiryParts(expiryIso: string): { yy: number; mon: (typeof MONTHS)[number] } {
  return { yy: Number(expiryIso.slice(2, 4)), mon: MONTHS[Number(expiryIso.slice(5, 7)) - 1] };
}

// Python's format spec :g (six significant digits, no trailing zeros) for strikes.
export const fmtStrike = (strike: number) => String(Number(strike.toPrecision(6)));

const yy2 = (yy: number) => String(Math.trunc(yy)).padStart(2, '0');

export const fyersEquity = (symbol: string) => `NSE:${symbol}-EQ`;
export const fyersIndex = () => 'NSE:NIFTY50-INDEX';
export const fyersOption = (symbol: string, yy: number, mon: string, strike: number, cp: string) => `NSE:${symbol}${yy2(yy)}${mon.toUpperCase()}${fmtStrike(strike)}${cp.toUpperCase()}`;

export const kiteEquity = (symbol: string) => `NSE:${symbol}`;
export const kiteIndex = () => 'NSE:NIFTY 50';
export const kiteOption = (symbol: string, yy: number, mon: string, strike: number, cp: string) => `NFO:${symbol}${yy2(yy)}${mon.toUpperCase()}${fmtStrike(strike)}${cp.toUpperCase()}`;

// Fyers symbol master NSE_FO.csv: the ticker is column 9 and the lot size column 3 (as read by fy_lot_size in the reference).
// The column layout comes from the reference script and has not been checked against a live file.
export function parseSymbolMasterLots(csv: string): Map<string, number> {
  const lots = new Map<string, number>();
  for (const line of csv.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const cols = line.split(',');
    if (cols.length < 10) continue;
    const lot = Number(cols[3]);
    if (Number.isInteger(lot) && lot > 0) lots.set(cols[9].trim(), lot);
  }
  return lots;
}
