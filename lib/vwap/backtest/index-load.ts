// Fetches the index (Nifty 50) and its current-month future into the month cache and reports what came back, so the index filter can be used
// and so it is clear whether the index candles carry volume (a VWAP needs it).
import { futuresSymbol } from '../../board/universe';
import { expectedFirstSession, loadHistory, monthsBetween } from './history';
import type { DataProvider } from '../provider';

export const NIFTY_INDEX = 'NSE:NIFTY50-INDEX';

export type IndexReport = {
  symbol: string;
  ok: boolean;
  error?: string;
  candles: number;
  sessions: number;
  firstDay: string | null;
  lastDay: string | null;
  sessionsWithVolume: number; // sessions in which at least one candle traded volume
  zeroVolumeCandles: number;
  sampleCandle: { time: string; o: number; h: number; l: number; c: number; v: number } | null;
  monthsUsable: string[]; // months whose first session is present, so the monthly VWAP anchor is right
  vwapUsable: boolean; // enough volume to compute a VWAP
  note: string;
  skipped: { month: string; reason: string }[];
};

const istTime = (t: number) => new Date((t + 19_800) * 1000).toISOString().slice(0, 16).replace('T', ' ');

export const indexSymbolsFor = (todayIso: string) => [NIFTY_INDEX, `NSE:${futuresSymbol('NIFTY', todayIso).replace(/^NSE:/, '')}`];

export async function loadIndexHistory(deps: { provider: DataProvider; symbols: string[]; from: string; to: string }): Promise<{ reports: IndexReport[]; loginRequired: boolean }> {
  const reports: IndexReport[] = [];
  for (const symbol of deps.symbols) {
    const out = await loadHistory({ provider: deps.provider, entries: [{ ticker: symbol.replace(/^NSE:/, ''), symbol, name: symbol, sector: 'Index' }], from: deps.from, to: deps.to, concurrency: 1 });
    if (out.loginRequired) return { reports, loginRequired: true };
    const days = out.data.flatMap((m) => [...m.days.entries()]);
    const candles = days.flatMap(([, list]) => list);
    const volDays = days.filter(([, list]) => list.some((c) => c.v > 0)).length;
    const zero = candles.filter((c) => c.v === 0).length;
    const sorted = days.map(([d]) => d).sort();
    const sample = candles.find((c) => c.v > 0) ?? candles[0] ?? null;
    const usable = out.data.map((m) => m.month).filter((m) => monthsBetween(deps.from, deps.to).includes(m));
    const vwapUsable = candles.length > 0 && volDays >= Math.max(1, Math.floor(days.length * 0.9));
    reports.push({
      symbol, ok: candles.length > 0, error: out.errors[0], candles: candles.length, sessions: days.length, firstDay: sorted[0] ?? null, lastDay: sorted[sorted.length - 1] ?? null,
      sessionsWithVolume: volDays, zeroVolumeCandles: zero,
      sampleCandle: sample ? { time: istTime(sample.t), o: sample.o, h: sample.h, l: sample.l, c: sample.c, v: sample.v } : null,
      monthsUsable: usable, vwapUsable,
      note: !candles.length ? 'FYERS returned no usable candles for this symbol and range.' : !vwapUsable ? 'Most candles carry no volume, so a volume-weighted average price cannot be computed from this symbol. Use the day-change mode, or the index future.' : symbol.includes('FUT') ? 'Continuous future (cont_flag=1): prices can step at each monthly expiry where contracts are joined, which nudges the VWAP.' : 'Index candles carry volume; what that volume measures (for example the sum of the constituents) is FYERS-defined.',
      skipped: out.skipped.map((s) => ({ month: s.month, reason: s.reason })),
    });
  }
  return { reports, loginRequired: false };
}

export { expectedFirstSession };
