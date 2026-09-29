import { REGIME_CONFIG } from './config';
import { decide, type Decision } from './decision';
import { forecastPath, forecastRow, signalScore } from './forecast';
import { labelSeries } from './labels';
import { countTransitions, matrixPower, normalizeRows, timeShare } from './matrix';
import { stationaryDistribution } from './stationary';
import type { Candle, Horizon, Label, LabelWindow, Matrix, Method, State } from './types';
import { findGaps, flagPossibleCorporateActions, truncateAsOf, validateCandles } from './validate';

export type RegimeAnalysis = {
  asOf: string | null;
  sessions: number;
  window: LabelWindow;
  method: Method;
  horizon: Horizon;
  theta: number;
  dates: string[];
  closes: number[];
  labels: Label[];
  metric: (number | null)[];
  definedLabels: number;
  insufficientHistory: boolean;
  current: State | null;
  runLength: number;
  windowMove: number | null;
  metricNow: number | null;
  counts: number[][] | null;
  matrix: Matrix | null;
  emptyRows: number[];
  stationary: number[] | null;
  timeShare: number[] | null;
  forecast: Record<'1' | '5' | '10', number[] | null> | null;
  score: Record<'1' | '5' | '10', number | null> | null;
  forecastPath: { step: number; probs: number[] }[] | null;
  nStepMatrix: Matrix | null;
  decision: Decision | null;
  decisionNote: string | null;
  recentChanges: { date: string; from: State; to: State }[];
  corporateActionFlags: ReturnType<typeof flagPossibleCorporateActions>;
  gaps: ReturnType<typeof findGaps>;
};

export function analyzeRegime(input: { candles: Candle[]; asOf: string; window: LabelWindow; method: Method; horizon: Horizon; theta?: number }): RegimeAnalysis {
  const theta = input.theta ?? REGIME_CONFIG.theta;
  const candles = truncateAsOf(validateCandles(input.candles), input.asOf);
  const dates = candles.map((c) => c.date);
  const closes = candles.map((c) => c.close);
  const { labels, metric } = labelSeries(closes, input.window, input.method);
  const definedLabels = labels.filter((l) => l !== null).length;
  const insufficientHistory = definedLabels < REGIME_CONFIG.minLabels;
  const lastIndex = closes.length - 1;
  const current = lastIndex >= 0 ? labels[lastIndex] : null;

  let runLength = 0;
  if (current) for (let t = lastIndex; t >= 0 && labels[t] === current; t -= 1) runLength += 1;

  const recentChanges: RegimeAnalysis['recentChanges'] = [];
  for (let t = lastIndex; t >= 1 && recentChanges.length < REGIME_CONFIG.recentChanges; t -= 1) {
    const from = labels[t - 1];
    const to = labels[t];
    if (from && to && from !== to) recentChanges.push({ date: dates[t], from, to });
  }

  const base = {
    asOf: lastIndex >= 0 ? dates[lastIndex] : null,
    sessions: closes.length,
    window: input.window,
    method: input.method,
    horizon: input.horizon,
    theta,
    dates,
    closes,
    labels,
    metric,
    definedLabels,
    insufficientHistory,
    current,
    runLength,
    windowMove: lastIndex >= input.window ? closes[lastIndex] / closes[lastIndex - input.window] - 1 : null,
    metricNow: lastIndex >= 0 ? metric[lastIndex] : null,
    recentChanges,
    corporateActionFlags: flagPossibleCorporateActions(candles),
    gaps: findGaps(candles),
  };

  if (insufficientHistory) {
    return { ...base, counts: null, matrix: null, emptyRows: [], stationary: null, timeShare: null, forecast: null, score: null, forecastPath: null, nStepMatrix: null, decision: null, decisionNote: 'Not enough history' };
  }

  const counts = countTransitions(labels);
  const { matrix, emptyRows } = normalizeRows(counts);
  const shared = { ...base, counts, matrix, emptyRows, stationary: stationaryDistribution(matrix), timeShare: timeShare(labels), nStepMatrix: matrixPower(matrix, input.horizon) };

  if (!current) return { ...shared, forecast: null, score: null, forecastPath: null, decision: null, decisionNote: 'Current label is undefined' };

  const forecast = {} as Record<'1' | '5' | '10', number[] | null>;
  const score = {} as Record<'1' | '5' | '10', number | null>;
  for (const n of [1, 5, 10] as const) {
    const row = forecastRow(matrix, current, n);
    forecast[String(n) as '1' | '5' | '10'] = row;
    score[String(n) as '1' | '5' | '10'] = row ? signalScore(row) : null;
  }
  const chosen = score[String(input.horizon) as '1' | '5' | '10'];
  return {
    ...shared,
    forecast,
    score,
    forecastPath: chosen === null ? null : forecastPath(matrix, current),
    decision: chosen === null ? 'No trade' : decide(chosen, theta),
    decisionNote: chosen === null ? `No transitions observed from ${current}; forecast unavailable.` : null,
  };
}
