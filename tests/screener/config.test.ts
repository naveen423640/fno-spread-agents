import { describe, expect, it } from 'vitest';

import { DEFAULT_PARAMS, UNIVERSE, validateParams } from '../../lib/screener/config';
import { loadGolden } from '../support/screener-golden';

describe('screener config mirrors the reference', () => {
  it('DEFAULT_PARAMS equals dict P in the Python reference', () => {
    const p = loadGolden().params;
    expect(DEFAULT_PARAMS).toEqual({
      rsiBull: p.rsi_bull, rsiBear: p.rsi_bear, nearMaUp: p.near_ma_up, nearMaLo: p.near_ma_lo, hvPctMax: p.hv_pct_max,
      holdDays: p.hold_days, timeExitLeft: p.time_exit_left, takeProfit: p.take_profit, stopLoss: p.stop_loss, slippage: p.slippage,
    });
  });

  it('UNIVERSE equals the reference universe, symbol for symbol', () => {
    expect(UNIVERSE).toEqual(loadGolden().universe);
  });
});

describe('validateParams', () => {
  it('accepts the defaults and returns them unchanged', () => {
    expect(validateParams(DEFAULT_PARAMS)).toEqual({ ok: true, value: DEFAULT_PARAMS });
  });

  it('fills missing fields from the defaults', () => {
    expect(validateParams({ holdDays: 25 })).toEqual({ ok: true, value: { ...DEFAULT_PARAMS, holdDays: 25 } });
  });

  it.each([
    ['inverted RSI band', { rsiBull: [48, 35] }],
    ['RSI band out of range', { rsiBear: [52, 120] }],
    ['hold days not an integer', { holdDays: 20.5 }],
    ['time exit not before the hold period', { holdDays: 10, timeExitLeft: 10 }],
    ['take profit above 100%', { takeProfit: 1.5 }],
    ['stop loss of zero', { stopLoss: 0 }],
    ['negative slippage', { slippage: -0.01 }],
    ['volatility percentile above 1', { hvPctMax: 1.2 }],
    ['unknown key', { rsiBul: [30, 40] }],
    ['a string where a number is expected', { holdDays: '20' }],
    ['not an object', 'defaults'],
  ])('rejects %s', (_label, input) => {
    expect(validateParams(input).ok).toBe(false);
  });
});
