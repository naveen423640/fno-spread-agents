export type Candle = { date: string; open: number; high: number; low: number; close: number; volume: number };

// A candle plus the indicators the rules use. Warm-up and undefined values are NaN, as in the pandas reference,
// so comparisons with them are false. JSON.stringify turns NaN into null.
export type IndRow = Candle & {
  sma20: number;
  sma50: number;
  sma200: number;
  rsi: number;
  rs63: number;
  volRatio: number;
  hv20: number;
  hvPct: number;
  prevHigh: number;
  prevLow: number;
};

export type Side = 1 | -1;

export type Trade = {
  sym: string;
  variant: string;
  entry: string;
  days: number;
  why: 'TP' | 'SL' | 'TIME';
  R: number;
  riskPctSpot: number;
};

export type TradeStats = { n: number; winRate?: number; avgWinR?: number; avgLossR?: number; expectancyR?: number; profitFactor?: number | null };

export type ScanStatus = 'SIGNAL' | 'WATCH';
export type ScanRow = {
  symbol: string;
  sector: string;
  side: 'BULL CALL' | 'BEAR PUT';
  status: ScanStatus;
  close: number;
  rsi: number;
  rs63Pct: number;
  volX: number;
  hvPctile: number;
  longStrikeApprox: number;
  shortStrikeApprox: number;
  expiry: string;
  lotSize: number | null;
};

export type Quote = { bid: number | null; ask: number | null; ltp: number | null; oi: number | null };

export type BrokerErrorCode = 'LOGIN_REQUIRED' | 'UPSTREAM' | 'NOT_FOUND' | 'NOT_CONFIGURED';
export type BrokerResult<T> = { ok: true; value: T } | { ok: false; code: BrokerErrorCode; message: string };
