// Monthly anchored VWAP crossover detection. Pure: no clock, no I/O. The live scanner and the backtest both call scanSymbol, so a
// signal means the same thing in both. Candle times are unix seconds of the candle START (FYERS convention), shown as IST HH:MM.

export type C5 = { t: number; o: number; h: number; l: number; c: number; v: number };

// Running totals of the month so far, through the end of the previous trading session. All zero/null on the first day of a month.
export type PriorTotals = { sumPv: number; sumV: number; lastClose: number | null; lastVwap: number | null };
export const EMPTY_PRIOR: PriorTotals = { sumPv: 0, sumV: 0, lastClose: null, lastVwap: null };

export type CrossType = 'close-cross' | 'body-cross' | 'gap-cross';
export type CrossEvent = {
  t: number; time: string; direction: 'up' | 'down'; type: CrossType;
  open: number; close: number; vwap: number; prevClose: number; prevVwap: number;
  distancePct: number; borderline: boolean;
};
export type WickTouch = { t: number; time: string; vwap: number; high: number; low: number };

export type ScanResult = {
  vwap: number | null;
  lastClose: number | null;
  lastCandleT: number | null;
  side: 'above' | 'below' | 'on' | null;
  distancePct: number | null;
  borderlineNow: boolean;
  events: CrossEvent[];
  crossesToday: number;
  wickTouches: WickTouch[];
  candlesUsed: number;
  formingExcluded: boolean; // a candle that had not closed yet was left out
  firstGapPct: number | null; // first candle's open against the previous session's close, for split/bonus detection
  flags: string[];
  totals: PriorTotals; // the month totals including today's closed candles
};

export type ScanOptions = {
  now?: number; // unix seconds; candles that have not closed by then are excluded. Leave out to treat every candle as closed.
  borderlinePct?: number; // |close - VWAP| / VWAP below this percent is "borderline"
  candleSeconds?: number;
};

export const DEFAULT_BORDERLINE_PCT = 0.05;
const IST_OFFSET_SECONDS = 19_800;

export const istTime = (t: number) => new Date((t + IST_OFFSET_SECONDS) * 1000).toISOString().slice(11, 16);
export const istDayOf = (t: number) => new Date((t + IST_OFFSET_SECONDS) * 1000).toISOString().slice(0, 10);

export function scanSymbol(prior: PriorTotals, todayCandles: C5[], options: ScanOptions = {}): ScanResult {
  const span = options.candleSeconds ?? 300;
  const borderlinePct = options.borderlinePct ?? DEFAULT_BORDERLINE_PCT;
  const sorted = [...todayCandles].sort((a, b) => a.t - b.t).filter((c, i, all) => i === 0 || c.t !== all[i - 1].t);
  const closed = options.now === undefined ? sorted : sorted.filter((c) => c.t + span <= options.now!);
  const flags: string[] = [];
  const events: CrossEvent[] = [];
  const wickTouches: WickTouch[] = [];

  let sumPv = prior.sumPv;
  let sumV = prior.sumV;
  const vwaps: (number | null)[] = [];
  const hasPrior = prior.lastClose !== null && prior.lastVwap !== null;

  closed.forEach((c, i) => {
    sumPv += ((c.h + c.l + c.c) / 3) * c.v;
    sumV += c.v;
    const vwap = sumV > 0 ? sumPv / sumV : null;
    vwaps.push(vwap);
    // The previous candle's close and VWAP: for the day's first candle, the previous session's. Without both, nothing to compare.
    const prevClose = i === 0 ? prior.lastClose : closed[i - 1].c;
    const prevVwap = i === 0 ? prior.lastVwap : vwaps[i - 1];
    if (vwap === null || prevClose === null || prevVwap === null || (i === 0 && !hasPrior)) return;

    const above = c.c > vwap && (prevClose < prevVwap || c.o < vwap);
    const below = c.c < vwap && (prevClose > prevVwap || c.o > vwap);
    if (above || below) {
      const direction = above ? 'up' : 'down';
      const wasOnOtherSide = above ? prevClose < prevVwap : prevClose > prevVwap;
      const openAlreadyCrossed = above ? c.o > vwap : c.o < vwap;
      const type: CrossType = i === 0 && wasOnOtherSide && openAlreadyCrossed ? 'gap-cross' : wasOnOtherSide ? 'close-cross' : 'body-cross';
      const distancePct = ((c.c - vwap) / vwap) * 100;
      events.push({ t: c.t, time: istTime(c.t), direction, type, open: c.o, close: c.c, vwap, prevClose, prevVwap, distancePct, borderline: Math.abs(distancePct) < borderlinePct });
    } else if (vwap >= c.l && vwap <= c.h) {
      wickTouches.push({ t: c.t, time: istTime(c.t), vwap, high: c.h, low: c.l });
    }
  });

  const last = closed[closed.length - 1];
  const lastVwap = vwaps.length ? vwaps[vwaps.length - 1] : null;
  const distancePct = last && lastVwap !== null ? ((last.c - lastVwap) / lastVwap) * 100 : null;
  if (!hasPrior && closed.length) flags.push('first session of the month: the first candle has no previous VWAP, so no cross is reported for it');
  if (closed.length && sumV === 0) flags.push('no volume yet: VWAP is undefined');
  return {
    vwap: lastVwap,
    lastClose: last?.c ?? null,
    lastCandleT: last?.t ?? null,
    side: distancePct === null ? null : distancePct > 0 ? 'above' : distancePct < 0 ? 'below' : 'on',
    distancePct,
    borderlineNow: distancePct !== null && Math.abs(distancePct) < borderlinePct,
    events,
    crossesToday: events.length,
    wickTouches,
    candlesUsed: closed.length,
    formingExcluded: closed.length < sorted.length,
    firstGapPct: closed.length && prior.lastClose ? (closed[0].o / prior.lastClose - 1) * 100 : null,
    flags,
    totals: { sumPv, sumV, lastClose: last?.c ?? prior.lastClose, lastVwap: lastVwap ?? prior.lastVwap },
  };
}

// Totals of a finished day, to carry into the next day's scan. Uses the same arithmetic as scanSymbol.
export function foldDay(prior: PriorTotals, candles: C5[]): PriorTotals {
  return scanSymbol(prior, candles).totals;
}
