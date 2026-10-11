import type { Candle } from '@/lib/screener/types';

import { BOARD_CONFIG, type BoardConfig } from './config';
import type { OiInterpretation, ScoreComponents, ScoreInput, ScoreResult } from './types';

const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value));
const finite = (value: number | null | undefined): value is number => typeof value === 'number' && Number.isFinite(value);

const ZERO: ScoreComponents = { move: 0, volume: 0, oi: 0, sector: 0 };

function zeroed(input: ScoreInput, reason: string, changePct = 0, moveAtr = 0): ScoreResult {
  return { score: 0, direction: null, components: { ...ZERO }, oi: 'n/a', changePct, moveAtr, volumeRatio: null, filtered: reason };
}

export function oiInterpretation(changePct: number, oiChangePct: number | null): OiInterpretation {
  if (!finite(oiChangePct) || oiChangePct === 0 || changePct === 0) return 'n/a';
  if (changePct > 0) return oiChangePct > 0 ? 'long buildup' : 'short covering';
  return oiChangePct > 0 ? 'short buildup' : 'long unwinding';
}

// Scores one stock from -100 (strongest bearish) to +100 (strongest bullish). Pure: no clock, no I/O.
// Components (each -1..+1, weights in BOARD_CONFIG.weights):
//   move    - % change vs previous close in units of the stock's daily ATR%, capped
//   volume  - cumulative volume vs the normal amount by this time, signed by the direction of the move
//   oi      - futures OI change, signed by what price is doing (build-ups full, covering/unwinding reduced)
//   sector  - bonus when the sector index moves the same way as the stock
export function scoreStock(input: ScoreInput, config: BoardConfig = BOARD_CONFIG): ScoreResult {
  const { price, prevClose, atrPct } = input;
  if (!finite(price) || !finite(prevClose) || prevClose <= 0 || !finite(atrPct) || atrPct <= 0) return zeroed(input, 'missing price, previous close or ATR');

  const changePct = ((price - prevClose) / prevClose) * 100;
  const moveAtr = changePct / atrPct;

  const chop = config.chop;
  if (input.minutesElapsed >= chop.minMinutesElapsed) {
    if (input.vwapCrossings >= chop.maxVwapCrossings) return zeroed(input, `choppy: crossed its VWAP ${input.vwapCrossings} times`, changePct, moveAtr);
    if (input.openCrossings >= chop.maxOpenCrossings) return zeroed(input, `choppy: crossed the open price ${input.openCrossings} times`, changePct, moveAtr);
    if (finite(input.dayHigh) && finite(input.dayLow)) {
      const rangePct = ((input.dayHigh - input.dayLow) / prevClose) * 100;
      if (rangePct < atrPct * chop.minRangeAtrFraction) return zeroed(input, `range ${rangePct.toFixed(2)}% is under ${chop.minRangeAtrFraction} of the ${atrPct.toFixed(2)}% ATR`, changePct, moveAtr);
    }
  }

  if (Math.abs(moveAtr) < config.move.minAtrToRank) return zeroed(input, `move of ${moveAtr.toFixed(2)} ATR is under ${config.move.minAtrToRank}`, changePct, moveAtr);

  const sign = changePct > 0 ? 1 : changePct < 0 ? -1 : 0;
  const move = clamp(moveAtr / config.move.capAtrMultiple, -1, 1);

  let volumeRatio: number | null = null;
  let volume = 0;
  if (finite(input.volume) && finite(input.expectedVolume) && input.expectedVolume > 0) {
    volumeRatio = input.volume / input.expectedVolume;
    const full = config.volume.fullScoreRatio;
    volume = sign * clamp((volumeRatio - 1) / (full - 1), 0, 1);
  }

  const oiKind = oiInterpretation(changePct, input.oiChangePct);
  let oi = 0;
  if (oiKind !== 'n/a' && finite(input.oiChangePct)) {
    const size = clamp(Math.abs(input.oiChangePct) / config.oi.fullScoreChangePct, 0, 1);
    const weak = oiKind === 'short covering' || oiKind === 'long unwinding' ? config.oi.coverUnwindFactor : 1;
    oi = sign * size * weak;
  }

  let sector = 0;
  if (finite(input.sectorChangePct) && sign !== 0 && Math.sign(input.sectorChangePct) === sign) {
    sector = sign * clamp(Math.abs(input.sectorChangePct) / config.sector.fullScoreMovePct, 0, 1);
  }

  const w = config.weights;
  const score = clamp(100 * (w.move * move + w.volume * volume + w.oi * oi + w.sector * sector), -100, 100);
  return {
    score,
    direction: score > 0 ? 'bull' : score < 0 ? 'bear' : null,
    components: { move, volume, oi, sector },
    oi: oiKind,
    changePct,
    moveAtr,
    volumeRatio,
    filtered: null,
  };
}

// Daily ATR as a percent of the last close: the simple mean of the last `period` true ranges.
export function atrPercent(candles: Candle[], period = BOARD_CONFIG.baseline.atrPeriod): number | null {
  if (candles.length < period + 1) return null;
  const ranges: number[] = [];
  for (let i = candles.length - period; i < candles.length; i += 1) {
    const c = candles[i];
    const previous = candles[i - 1].close;
    ranges.push(Math.max(c.high - c.low, Math.abs(c.high - previous), Math.abs(c.low - previous)));
  }
  const last = candles[candles.length - 1].close;
  if (!(last > 0)) return null;
  return (ranges.reduce((sum, value) => sum + value, 0) / ranges.length / last) * 100;
}

// Mean daily volume over the last `days` sessions. Pass dropPartialLast when the final candle is a session still in progress.
export function avgVolume(candles: Candle[], days = BOARD_CONFIG.baseline.volumeDays, dropPartialLast = false): number | null {
  const usable = dropPartialLast ? candles.slice(0, -1) : candles;
  const recent = usable.slice(-days).map((c) => c.volume).filter((v) => finite(v) && v > 0);
  if (recent.length < 5) return null;
  return recent.reduce((sum, value) => sum + value, 0) / recent.length;
}

function profileFraction(minutes: number, profile: readonly (readonly [number, number])[]): number {
  if (minutes <= profile[0][0]) return profile[0][1];
  for (let i = 1; i < profile.length; i += 1) {
    const [m1, f1] = profile[i];
    if (minutes <= m1) {
      const [m0, f0] = profile[i - 1];
      return f0 + ((f1 - f0) * (minutes - m0)) / (m1 - m0);
    }
  }
  return profile[profile.length - 1][1];
}

// Normal cumulative volume by this time of day. Uses recorded same-time volumes from past sessions once there are enough of
// them (median, so one wild day does not skew it); until then it pro-rates the 20-day average along the volume profile.
export function expectedVolume(args: {
  avgDailyVolume: number | null;
  minutesElapsed: number;
  profile: readonly (readonly [number, number])[];
  history: number[];
  minSessions?: number;
}): number | null {
  const min = args.minSessions ?? BOARD_CONFIG.sameTimeHistory.minSessions;
  const recorded = args.history.filter((v) => finite(v) && v > 0);
  if (recorded.length >= min) {
    const sorted = [...recorded].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  }
  if (!finite(args.avgDailyVolume) || args.avgDailyVolume <= 0) return null;
  return args.avgDailyVolume * profileFraction(args.minutesElapsed, args.profile);
}

// How many times a price series crossed a reference line (VWAP or the open). Points exactly on the line are skipped.
export function countCrossings(prices: (number | null)[], reference: (number | null)[]): number {
  let crossings = 0;
  let previous = 0;
  for (let i = 0; i < prices.length; i += 1) {
    const p = prices[i];
    const r = reference[i];
    if (!finite(p) || !finite(r)) continue;
    const side = Math.sign(p - r);
    if (side === 0) continue;
    if (previous !== 0 && side !== previous) crossings += 1;
    previous = side;
  }
  return crossings;
}
