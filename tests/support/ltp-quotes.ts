import type { Side, Snapshot } from '@/lib/ltp/types';

type Quote = { bid?: number; ask?: number; ltp?: number | null };

// Returns a copy of the snapshot with quotes (and optionally an LTP) set on chosen contracts. A key left out of the quote stays absent.
export function withQuotes(snapshot: Snapshot, quotes: Record<string, Quote>, extra: Partial<Snapshot> = {}): Snapshot {
  const rows = snapshot.rows.map((r) => {
    const q = quotes[`${r.side}${r.strike}` as `${Side}${number}`];
    if (!q) return r;
    const { bid: _b, ask: _a, ...rest } = r;
    return { ...rest, ...(q.ltp !== undefined ? { ltp: q.ltp } : {}), ...(q.bid !== undefined ? { bid: q.bid } : {}), ...(q.ask !== undefined ? { ask: q.ask } : {}) };
  });
  return { ...snapshot, ...extra, rows };
}
