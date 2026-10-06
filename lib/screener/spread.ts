import type { ScreenerParams } from './config';
import type { IndRow, Quote, Side } from './types';

// Live-check maths from live_check in screener/fo_spread_screener.py, plus the action plan and chart levels
// derived from screener/trade-rules.md. Read-only analysis; nothing here places or changes an order.

export type SpreadInput = { side: Side; kLong: number; kShort: number; long: Quote; short: Quote; lot: number };
export type SpreadCheck =
  | { ok: false; reason: string }
  | {
      ok: true;
      debit: number;
      width: number;
      debitPctOfWidth: number;
      breakeven: number;
      maxLossRs: number;
      maxProfitRs: number;
      rewardToRisk: number;
      warnings: string[];
      notes: string[];
      long: Quote;
      short: Quote;
      lot: number;
    };

export function spreadCheck(input: SpreadInput): SpreadCheck {
  const { side, kLong, kShort, long, short, lot } = input;
  if (side > 0 ? kShort <= kLong : kShort >= kLong) return { ok: false, reason: side > 0 ? 'A bull call spread sells a higher strike than it buys.' : 'A bear put spread sells a lower strike than it buys.' };
  if (long.ask === null) return { ok: false, reason: 'There is no ask on the long leg, so the debit cannot be priced.' };
  if (short.bid === null) return { ok: false, reason: 'There is no bid on the short leg, so the debit cannot be priced.' };

  const debit = long.ask - short.bid;
  const width = Math.abs(kShort - kLong);
  if (!(debit > 0 && debit < width)) return { ok: false, reason: 'The debit is not between zero and the spread width; the quotes look stale or wrong.' };

  const warnings: string[] = [];
  for (const [name, leg] of [['long', long], ['short', short]] as const) {
    if (leg.bid === null || leg.ask === null) continue;
    const mid = (leg.bid + leg.ask) / 2;
    if (mid && (leg.ask - leg.bid) / mid > 0.02) warnings.push(`${name} leg bid/ask is ${(((leg.ask - leg.bid) / mid) * 100).toFixed(1)}% of premium (>2%): wide, use limit orders`);
  }
  const ratio = debit / width;
  const notes = ratio >= 0.3 && ratio <= 0.45 ? [] : ['debit is outside the 30-45% of width guideline'];
  return {
    ok: true,
    debit,
    width,
    debitPctOfWidth: ratio * 100,
    breakeven: side > 0 ? kLong + debit : kLong - debit,
    maxLossRs: debit * lot,
    maxProfitRs: (width - debit) * lot,
    rewardToRisk: (width - debit) / debit,
    warnings,
    notes,
    long,
    short,
    lot,
  };
}

// The date that is n trading days before the expiry (weekends and listed holidays skipped).
export function tradingDaysBefore(expiryIso: string, n: number, holidays: ReadonlySet<string>): string {
  const d = new Date(`${expiryIso}T00:00:00Z`);
  let counted = 0;
  while (counted < n) {
    d.setUTCDate(d.getUTCDate() - 1);
    const day = d.getUTCDay();
    if (day !== 0 && day !== 6 && !holidays.has(d.toISOString().slice(0, 10))) counted += 1;
  }
  return d.toISOString().slice(0, 10);
}

export type ActionPlanInput = {
  side: Side;
  debit: number; // the debit actually expected (live check, or the modelled debit)
  kLong: number;
  kShort: number;
  lot: number | null; // null when the broker lot size is unknown: no rupee amounts are produced
  expiry: string;
  params: ScreenerParams;
  lastClose: number;
  sma20: number;
  swing: number; // recent swing low (bull) or swing high (bear)
  holidays: ReadonlySet<string>;
  today: string; // ISO date of the data, used to flag a time stop that has already passed
};

export type ActionPlan = {
  lot: number | null;
  profitTarget: { spreadValue: number; profitRsPerLot: number | null; pctOfMaxProfit: number };
  premiumStop: { spreadValue: number; lossRsPerLot: number | null };
  priceStop: { direction: 'below' | 'above'; levels: { label: string; value: number }[]; note: string };
  timeStop: { date: string; tradingDaysBeforeExpiry: number; passed: boolean; note: string };
  trail: string;
  gapRules: string[];
  exitOrder: string[];
  manualChecks: string[];
};

// Two decimals at most, without trailing zeros, so floating-point noise never reaches the screen.
const fmt = (n: number) => String(Number(n.toFixed(2)));

export function buildActionPlan(input: ActionPlanInput): ActionPlan {
  const { side, debit, kLong, kShort, lot, expiry, params, sma20, swing, holidays, today } = input;
  const width = Math.abs(kShort - kLong);
  const target = debit + params.takeProfit * (width - debit);
  const premiumStop = (1 - params.stopLoss) * debit;
  const direction = side > 0 ? 'below' : 'above';
  const timeStopDate = tradingDaysBefore(expiry, params.timeExitLeft, holidays);
  const passed = timeStopDate <= today;
  const levelText = `${fmt(swing)} (recent swing ${side > 0 ? 'low' : 'high'}) or ${fmt(sma20)} (20-DMA)`;
  return {
    lot,
    profitTarget: { spreadValue: target, profitRsPerLot: lot === null ? null : params.takeProfit * (width - debit) * lot, pctOfMaxProfit: params.takeProfit * 100 },
    premiumStop: { spreadValue: premiumStop, lossRsPerLot: lot === null ? null : params.stopLoss * debit * lot },
    priceStop: {
      direction,
      levels: [{ label: '20-DMA', value: sma20 }, { label: side > 0 ? 'Recent swing low' : 'Recent swing high', value: swing }],
      note: `Exit if the underlying closes ${direction} the level the thesis relied on: the swing level or the 20-DMA.`,
    },
    timeStop: {
      date: timeStopDate,
      tradingDaysBeforeExpiry: params.timeExitLeft,
      passed,
      note: passed
        ? `The time stop date ${timeStopDate} (${params.timeExitLeft} trading days before expiry) has already passed: this expiry is too close for the ${params.holdDays}-session hold the screen assumes. Consider the next expiry.`
        : `Close on or before ${timeStopDate} (${params.timeExitLeft} trading days before expiry) if it has not worked; decay accelerates.`,
    },
    trail: `Once the spread is worth about ${fmt(params.takeProfit * 100)}% of its maximum profit, move the stop to breakeven (the debit paid).`,
    gapRules: [
      `If the underlying opens ${direction} ${levelText}, exit at the open; do not wait for the close.`,
      `If the spread is quoted at or below ${fmt(premiumStop)} at the open (${fmt(params.stopLoss * 100)}% of the debit lost), exit at the open.`,
      `If it gaps up to the profit target (${fmt(target)}) or beyond, take the profit at the open rather than waiting for it again.`,
      'A gap against you that stays inside the stops: wait for the trend to confirm, and never average down.',
    ],
    exitOrder: ['Buy back the short leg first.', 'Then sell the long leg.', 'Close before expiry day: stock options are physically settled.'],
    manualChecks: ['Check earnings/news dates manually before trading.'],
  };
}

// Display aid for the chart: the nearest swing pivots (three bars either side) in the last 120 sessions.
// This is not an entry rule.
export function supportResistance(rows: IndRow[], lookback = 120, window = 3): { support: number[]; resistance: number[] } {
  const recent = rows.slice(-lookback);
  if (recent.length < 2 * window + 1) return { support: [], resistance: [] };
  const last = recent[recent.length - 1].close;
  const highs: number[] = [];
  const lows: number[] = [];
  for (let i = window; i < recent.length - window; i += 1) {
    const around = recent.slice(i - window, i + window + 1);
    if (recent[i].high === Math.max(...around.map((r) => r.high))) highs.push(recent[i].high);
    if (recent[i].low === Math.min(...around.map((r) => r.low))) lows.push(recent[i].low);
  }
  const distinct = (levels: number[]) => levels.reduce<number[]>((kept, level) => (kept.some((k) => Math.abs(k - level) / level < 0.005) ? kept : [...kept, level]), []);
  return {
    support: distinct(lows.filter((l) => l < last).sort((a, b) => b - a)).slice(0, 3),
    resistance: distinct(highs.filter((h) => h > last).sort((a, b) => a - b)).slice(0, 3),
  };
}
