import { lastCompletedSession } from '@/lib/market-session';

import { analyzeRegime } from './analyze';
import type { RegimeErrorResponse, RegimeResponse } from './api-types';
import type { RegimeParams } from './params';
import type { Candle } from './types';
import { validateCandles } from './validate';

// Set to 'adjusted' / 'unadjusted' only after Task 8 records evidence.
export const ADJUSTMENT_STATUS: RegimeResponse['dataSource']['adjustment'] = 'unverified';
export const ADJUSTMENT_NOTE = 'Split/bonus adjustment of FYERS daily history is unverified. Large one-day moves are flagged as possible corporate actions.';

export function buildRegimeResponse(input: { candles: Candle[]; params: RegimeParams; now: Date }): RegimeResponse | RegimeErrorResponse {
  const expected = lastCompletedSession(input.now);
  // A candle is only used once its session is complete; today's forming candle is never labelled.
  const completed = validateCandles(input.candles).filter((candle) => candle.date <= expected);
  if (!completed.length) return { error: 'FYERS returned no completed daily candles for this stock.', code: 'NO_DATA' };
  const asOf = input.params.asOf ?? expected;
  const analysis = analyzeRegime({ candles: completed, asOf, window: input.params.window, method: input.params.method, horizon: input.params.horizon });
  const lastCandleDate = analysis.asOf;
  // Staleness only means something for "now"; a historical as-of date is expected to be older than today's session.
  const stale = lastCandleDate !== null && asOf >= expected && lastCandleDate < expected;
  return {
    symbol: input.params.symbol,
    analysis,
    dataSource: {
      provider: 'FYERS',
      resolution: 'daily',
      fetchedAt: input.now.toISOString(),
      lastCandleDate,
      expectedLastSession: expected,
      stale,
      staleNote: stale ? `Newest candle is ${lastCandleDate}; expected ${expected}. Data is possibly stale (no exchange-holiday list is bundled yet).` : null,
      adjustment: ADJUSTMENT_STATUS,
      adjustmentNote: ADJUSTMENT_NOTE,
    },
  };
}
