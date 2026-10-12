import type { ChainRow, Side, Snapshot } from '@/lib/ltp/types';

type Cell = { ltp?: number | null; oi?: number | null; volume?: number | null; oiChange?: number | null };
export type MakeChainOptions = {
  spot: number; step: number; strikes?: number[]; ts?: number; underlying?: string; expiry?: string;
  ce?: Record<number, Cell>; pe?: Record<number, Cell>;
  defaults?: { ltp: number; oi: number; volume: number; oiChange: number };
};

// A synthetic option chain for tests. Every strike gets the same defaults (1000 volume, 1000 OI, LTP 100), so a test overrides only the
// cells it is about. `null` in an override means "the feed did not give this value".
export function makeChain(opts: MakeChainOptions): Snapshot {
  const d = opts.defaults ?? { ltp: 100, oi: 1000, volume: 1000, oiChange: 0 };
  const base = Math.floor(opts.spot / opts.step) * opts.step;
  const strikes = opts.strikes ?? Array.from({ length: 22 }, (_, i) => base + (i - 10) * opts.step);
  const rows: ChainRow[] = [];
  for (const strike of strikes) {
    for (const side of ['CE', 'PE'] as Side[]) {
      const o = (side === 'CE' ? opts.ce : opts.pe)?.[strike] ?? {};
      const pick = (k: keyof Cell) => (o[k] === undefined ? d[k] : o[k]);
      const row = { strike, side, ltp: pick('ltp') as number | null, oi: pick('oi') as number | null, volume: pick('volume') as number | null, oiChange: pick('oiChange') as number | null };
      rows.push({ ...row, flags: (['ltp', 'oi', 'volume', 'oiChange'] as const).filter((k) => row[k] === null) });
    }
  }
  return { ts: opts.ts ?? 0, underlying: opts.underlying ?? 'NSE:NIFTY50-INDEX', expiry: opts.expiry ?? '2026-10-27', spot: opts.spot, step: opts.step, fetchLatencyMs: null, rows };
}
