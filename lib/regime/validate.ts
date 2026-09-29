import { REGIME_CONFIG } from './config';
import { RegimeInputError, type Candle } from './types';

const DAY_MS = 86_400_000;

export function validateCandles(input: Candle[]): Candle[] {
  const seen = new Set<string>();
  for (const candle of input) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(candle.date)) throw new RegimeInputError(`Invalid date "${candle.date}".`);
    if (!Number.isFinite(candle.close) || candle.close <= 0) throw new RegimeInputError(`Invalid close for ${candle.date}.`);
    if (seen.has(candle.date)) throw new RegimeInputError(`Duplicate date ${candle.date}.`);
    seen.add(candle.date);
  }
  return [...input].sort((a, b) => a.date.localeCompare(b.date));
}

export function truncateAsOf(candles: Candle[], asOf: string): Candle[] {
  return candles.filter((candle) => candle.date <= asOf);
}

function daysBetween(from: string, to: string) {
  return Math.round((new Date(`${to}T00:00:00Z`).getTime() - new Date(`${from}T00:00:00Z`).getTime()) / DAY_MS);
}

export function findGaps(candles: Candle[], maxCalendarDays: number = REGIME_CONFIG.gapCalendarDays) {
  const gaps: { from: string; to: string; days: number }[] = [];
  for (let i = 1; i < candles.length; i += 1) {
    const days = daysBetween(candles[i - 1].date, candles[i].date);
    if (days > maxCalendarDays) gaps.push({ from: candles[i - 1].date, to: candles[i].date, days });
  }
  return gaps;
}

export function flagPossibleCorporateActions(candles: Candle[], threshold: number = REGIME_CONFIG.corporateActionLogMove) {
  const flags: { date: string; previousClose: number; close: number; logReturn: number }[] = [];
  for (let i = 1; i < candles.length; i += 1) {
    const logReturn = Math.log(candles[i].close / candles[i - 1].close);
    if (Math.abs(logReturn) > threshold) flags.push({ date: candles[i].date, previousClose: candles[i - 1].close, close: candles[i].close, logReturn });
  }
  return flags;
}
