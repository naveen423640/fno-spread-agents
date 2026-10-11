import type { CrossType } from '../core';

export type ExitRule = {
  name: string;
  opposite?: boolean; // exit at the next open after an opposite-direction cross
  squareoffAt?: string; // 'HH:MM': exit at the open of the first candle at or after this time (IST)
  stopPct?: number; // fixed stop-loss, percent of the entry price
  targetR?: number; // target as a multiple of the initial risk (needs stopPct)
  trailPct?: number; // trailing stop, percent below the best price since entry
};

export type SignalFilters = {
  types: CrossType[];
  directions: ('up' | 'down')[];
  firstCrossOnly: boolean; // only the first cross event of the day (any direction) can open a trade
  skipBorderline: boolean;
  entryFrom: string; // 'HH:MM': earliest entry candle start
  entryTo: string; // latest entry candle start
  minDistancePct: number; // |close - VWAP| / VWAP at the signal, percent
  minAvgCandleVolume: number; // average volume per candle so far today, as a liquidity floor
};

export const DEFAULT_FILTERS: SignalFilters = {
  types: ['close-cross', 'body-cross', 'gap-cross'], directions: ['up', 'down'], firstCrossOnly: false, skipBorderline: false,
  entryFrom: '09:15', entryTo: '15:00', minDistancePct: 0, minAvgCandleVolume: 0,
};

export type ExitReason = 'opposite-cross' | 'square-off' | 'stop' | 'stop-gap' | 'target' | 'target-gap' | 'trail' | 'trail-gap' | 'end-of-day';

// One round trip on the underlying's price, before slippage, costs or instrument pricing.
export type RawTrade = {
  strategy: string;
  symbol: string;
  sector: string;
  day: string;
  month: string;
  direction: 1 | -1; // +1 long (up cross), -1 short (down cross)
  signalType: CrossType | 'random' | 'baseline';
  borderline: boolean;
  signalT: number | null;
  signalDistancePct: number | null;
  entryT: number;
  entryPrice: number;
  exitT: number;
  exitPrice: number;
  exitReason: ExitReason;
  maePct: number; // worst move against the position, percent of entry (<= 0)
  mfePct: number; // best move in favour, percent of entry (>= 0)
  holdMinutes: number;
  dayOfMonth: number;
  sessionOfMonth: number; // 1 for the first trading session of the month
};

export type ForcedEntry = { index: number; direction: 1 | -1 };
