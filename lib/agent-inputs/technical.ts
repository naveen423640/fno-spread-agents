import type { AnalystInput } from '../agents/orchestrator';
import { lastCompletedSession } from '../market-session';
import { buildRegimeResponse } from '../regime/build-response';
import { RegimeInputError } from '../regime/types';
import { safeReason, unavailable, type GatherArgs, type GatherDeps } from './common';

const HISTORY_DAYS = 800;

export async function gatherTechnical(args: GatherArgs, deps: GatherDeps): Promise<AnalystInput> {
  const { symbol, asOf, now, credentials } = args;
  if (!credentials) return unavailable('technical', asOf, 'FYERS is not connected, so daily prices are unavailable');
  try {
    const latest = lastCompletedSession(now);
    const to = asOf < latest ? asOf : latest;
    const from = new Date(new Date(`${to}T00:00:00Z`).getTime() - HISTORY_DAYS * 86_400_000).toISOString().slice(0, 10);
    const history = await deps.fetchDaily(credentials, symbol, from, to);
    if (!history.ok) return unavailable('technical', asOf, history.message);
    const response = buildRegimeResponse({ candles: history.candles, params: { symbol, window: 20, method: 'vol', horizon: 5, asOf }, now });
    if ('error' in response) return unavailable('technical', asOf, response.error);
    const analysis = response.analysis;
    return {
      role: 'technical',
      asOf,
      available: true,
      sources: [{ id: 'regime-1', kind: 'regime', title: `Markov regime (${analysis.method}, ${analysis.window}-day window)`, url: null, retrieved_at: now.toISOString() }],
      payload: {
        regimeAsOf: analysis.asOf,
        current: analysis.current,
        runLength: analysis.runLength,
        windowMove: analysis.windowMove,
        metricNow: analysis.metricNow,
        matrix: analysis.matrix,
        stationary: analysis.stationary,
        forecast: analysis.forecast,
        score: analysis.score,
        sessions: analysis.sessions,
        definedLabels: analysis.definedLabels,
        insufficientHistory: analysis.insufficientHistory,
        lastClose: analysis.closes[analysis.closes.length - 1] ?? null,
        stale: response.dataSource.stale,
        adjustmentNote: response.dataSource.adjustmentNote,
        notes: ['RSI and MACD are not computed by the app yet.', 'The regime score uses a placeholder threshold and is exploratory.'],
      },
    };
  } catch (error) {
    if (error instanceof RegimeInputError) return unavailable('technical', asOf, error.message);
    return unavailable('technical', asOf, safeReason(error, credentials));
  }
}
