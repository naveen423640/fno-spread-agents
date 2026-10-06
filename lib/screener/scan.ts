import type { ScreenerParams } from './config';
import { UNIVERSE } from './config';
import { addIndicators } from './indicators';
import { pyRound } from './numeric';
import { partsBear, partsBull } from './signals';
import { niceStep } from './symbols';
import type { Candle, ScanRow, ScanStatus } from './types';

// Port of run_scan in screener/fo_spread_screener.py.
// Two deliberate differences, both reported to the user: SIGNAL rows are ordered before WATCH rows (the reference sorted the
// status strings descending, which put "WATCH: needs trigger" first), and the caller passes completed sessions only.

export type ScanOptions = {
  expiry: string; // ISO date of the monthly expiry the strikes are for
  lotSizes?: Record<string, number | null>;
  top?: number; // limit after ordering and the sector cap; omit for all rows
  universe?: Record<string, string>;
};

export function orderAndCap(rows: ScanRow[]): ScanRow[] {
  const rank = (status: ScanStatus) => (status === 'SIGNAL' ? 0 : 1);
  const ordered = [...rows].sort((a, b) => rank(a.status) - rank(b.status) || Math.abs(b.rs63Pct) - Math.abs(a.rs63Pct));
  const count = new Map<string, number>();
  const picked: ScanRow[] = [];
  for (const row of ordered) {
    const key = `${row.sector}|${row.side}`;
    if ((count.get(key) ?? 0) >= 2) continue;
    count.set(key, (count.get(key) ?? 0) + 1);
    picked.push(row);
  }
  return picked;
}

export function runScan(data: Record<string, Candle[]>, bench: Candle[], p: ScreenerParams, options: ScanOptions): ScanRow[] {
  const universe = options.universe ?? UNIVERSE;
  const rows: ScanRow[] = [];
  for (const [symbol, candles] of Object.entries(data)) {
    if (symbol === '^NSEI' || candles.length < 260) continue;
    const indicators = addIndicators(candles, bench);
    const last = indicators[indicators.length - 1];
    for (const side of [1, -1] as const) {
      const [trend, relativeStrength, pullback, trigger, volatilityOk] = (side > 0 ? partsBull : partsBear)(last, p);
      if (!(trend && relativeStrength)) continue;
      const status: ScanStatus | null = pullback && trigger && volatilityOk ? 'SIGNAL' : pullback && volatilityOk ? 'WATCH' : null;
      if (!status) continue;
      const expectedMove = Math.min(Math.max(last.hv20 * 1.1, 0.15), 0.9) * Math.sqrt(25 / 252);
      const step = niceStep(last.close);
      rows.push({
        symbol,
        sector: universe[symbol] ?? '',
        side: side > 0 ? 'BULL CALL' : 'BEAR PUT',
        status,
        close: pyRound(last.close, 1),
        rsi: pyRound(last.rsi, 1),
        rs63Pct: pyRound(last.rs63 * 100, 1),
        volX: pyRound(last.volRatio, 2),
        hvPctile: pyRound(last.hvPct, 2),
        longStrikeApprox: pyRound(last.close / step) * step,
        shortStrikeApprox: pyRound((last.close * (1 + side * expectedMove)) / step) * step,
        expiry: options.expiry,
        lotSize: options.lotSizes?.[symbol] ?? null,
      });
    }
  }
  const capped = orderAndCap(rows);
  return options.top === undefined ? capped : capped.slice(0, options.top);
}
