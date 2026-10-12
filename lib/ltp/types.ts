// Shared shapes of the LTP Levels engine. Everything here is plain data: no methods, no clock, no I/O.

export type Side = 'CE' | 'PE';
export type Metric = 'volume' | 'oi';
export type Status = 'strong' | 'wtt' | 'wtb';
export type LevelSide = 'support' | 'resistance';

// One strike on one side. A field the feed did not give is null (never zero) and its name is in `flags`.
export type ChainRow = { strike: number; side: Side; ltp: number | null; oi: number | null; oiChange: number | null; volume: number | null; flags: string[] };

// One option chain at one moment. `ts` is unix seconds (the time we fetched it), `step` the derived strike step.
export type Snapshot = { ts: number; underlying: string; expiry: string; spot: number; step: number; fetchLatencyMs: number | null; rows: ChainRow[] };

export type CellField = Metric | 'ltp' | 'oiChange';

export function valueAt(snapshot: Snapshot, strike: number, side: Side, field: CellField): number | null {
  const row = snapshot.rows.find((r) => r.strike === strike && r.side === side);
  return row ? row[field] : null;
}

export const strikesOf = (snapshot: Snapshot): number[] => [...new Set(snapshot.rows.map((r) => r.strike))].sort((a, b) => a - b);
