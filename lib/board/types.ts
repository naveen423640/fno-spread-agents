export type Direction = 'bull' | 'bear';

// One stored reading of a symbol at one minute. Index rows (sector indices) carry no volume or OI.
export type SnapshotRow = {
  symbol: string;
  ts: number; // unix seconds, floored to the minute
  ltp: number;
  volume: number | null;
  oi: number | null; // futures open interest; set on the stock's row, copied from its futures quote
  prevOi: number | null;
  open: number | null;
  high: number | null;
  low: number | null;
  prevClose: number | null;
  vwap: number | null; // FYERS average traded price for the day
};

export type Baseline = { symbol: string; asOf: string; atrPct: number; avgVolume: number; prevClose: number };

export type ScoreComponents = { move: number; volume: number; oi: number; sector: number }; // each -1..+1

export type OiInterpretation = 'long buildup' | 'short buildup' | 'short covering' | 'long unwinding' | 'n/a';

export type ScoreInput = {
  price: number;
  prevClose: number;
  atrPct: number; // daily ATR as a percent of price
  volume: number | null;
  expectedVolume: number | null; // normal cumulative volume by this time of day
  oiChangePct: number | null; // futures OI change vs previous day, percent
  sectorChangePct: number | null;
  minutesElapsed: number; // minutes since 09:15 (0..375)
  dayHigh: number | null;
  dayLow: number | null;
  vwapCrossings: number;
  openCrossings: number;
};

export type ScoreResult = {
  score: number; // signed, -100..+100; positive is bullish
  direction: Direction | null;
  components: ScoreComponents;
  oi: OiInterpretation;
  changePct: number;
  moveAtr: number; // the move in daily ATRs
  volumeRatio: number | null;
  filtered: string | null; // why the stock was zeroed, or null
};

export type BoardEntry = {
  symbol: string;
  ticker: string;
  sector: string;
  price: number;
  changePct: number;
  score: number;
  direction: Direction;
  components: ScoreComponents;
  oi: OiInterpretation;
  oiChangePct: number | null;
  volumeRatio: number | null;
  moveAtr: number;
};

export type BoardPayload = {
  asOf: string | null; // ISO time of the snapshot the board is built from
  sessionDate: string | null;
  live: boolean;
  bullish: BoardEntry[];
  bearish: BoardEntry[];
  coverage: { symbols: number; scored: number; withBaseline: number; withOi: number; skipped: number };
  notes: string[];
};

export type ZonesPayload = {
  symbol: string;
  ticker: string;
  price: number;
  direction: Direction;
  source: 'history' | 'snapshots' | 'none';
  candles: { t: number; o: number; h: number; l: number; c: number; v: number }[];
  zones: {
    supports: { price: number; weight: number; low: number; high: number }[];
    resistances: { price: number; weight: number; low: number; high: number }[];
    liquidity: { kind: string; price: number; label: string }[];
    orderBlocks: { side: 'bull' | 'bear'; top: number; bottom: number; t: number; mitigated: boolean; impulseAtr: number }[];
  };
  summary: string;
  stats: { intradayCandles: number; firstTs: number | null; lastTs: number | null; dailyCandles: number };
  diagnostics: Record<string, unknown>;
};
