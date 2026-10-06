import { describe, expect, it } from 'vitest';

import { DEFAULT_PARAMS } from '../../lib/screener/config';
import type { VariantView } from '../../lib/screener/service';
import type { ScanRow } from '../../lib/screener/types';
import { DEFAULT_FILTERS, filterRows, halvesVerdict, jobPhase, loadSettings, paramsEqual, saveSettings, sectorsOf, SETTINGS_KEY, variantNotes } from '../../lib/screener/view';

const row = (symbol: string, sector: string, side: ScanRow['side'], status: ScanRow['status']): ScanRow => ({
  symbol, sector, side, status, close: 100, rsi: 40, rs63Pct: 5, volX: 1, hvPctile: 0.4, longStrikeApprox: 100, shortStrikeApprox: 110, expiry: '2026-10-27', lotSize: 100,
});
const rows = [row('A', 'Banks', 'BULL CALL', 'SIGNAL'), row('B', 'IT', 'BEAR PUT', 'WATCH'), row('C', 'Banks', 'BEAR PUT', 'SIGNAL'), row('D', 'IT', 'BULL CALL', 'WATCH')];

describe('filterRows', () => {
  it('returns everything for the default filters, in the same order', () => {
    expect(filterRows(rows, DEFAULT_FILTERS).map((r) => r.symbol)).toEqual(['A', 'B', 'C', 'D']);
  });

  it('filters by side, sector and status, alone and together, keeping the order', () => {
    expect(filterRows(rows, { ...DEFAULT_FILTERS, side: 'BEAR PUT' }).map((r) => r.symbol)).toEqual(['B', 'C']);
    expect(filterRows(rows, { ...DEFAULT_FILTERS, sector: 'IT' }).map((r) => r.symbol)).toEqual(['B', 'D']);
    expect(filterRows(rows, { ...DEFAULT_FILTERS, status: 'SIGNAL' }).map((r) => r.symbol)).toEqual(['A', 'C']);
    expect(filterRows(rows, { side: 'BEAR PUT', sector: 'Banks', status: 'SIGNAL' }).map((r) => r.symbol)).toEqual(['C']);
    expect(filterRows(rows, { side: 'BULL CALL', sector: 'IT', status: 'SIGNAL' })).toEqual([]);
  });
});

describe('sectorsOf', () => {
  it('lists the distinct sectors present, sorted', () => {
    expect(sectorsOf(rows)).toEqual(['Banks', 'IT']);
    expect(sectorsOf([])).toEqual([]);
  });
});

describe('paramsEqual', () => {
  it('compares settings by value', () => {
    expect(paramsEqual(DEFAULT_PARAMS, { ...DEFAULT_PARAMS, rsiBull: [35, 48] })).toBe(true);
    expect(paramsEqual(DEFAULT_PARAMS, { ...DEFAULT_PARAMS, holdDays: 25 })).toBe(false);
    expect(paramsEqual(DEFAULT_PARAMS, { ...DEFAULT_PARAMS, rsiBear: [52, 66] })).toBe(false);
  });
});

describe('settings storage', () => {
  const fake = (value: string | null) => ({ getItem: (key: string) => (key === SETTINGS_KEY ? value : null) });

  it('falls back to the defaults without storage, with nothing saved, with bad JSON or with invalid values', () => {
    expect(loadSettings(null)).toEqual(DEFAULT_PARAMS);
    expect(loadSettings(fake(null))).toEqual(DEFAULT_PARAMS);
    expect(loadSettings(fake('{not json'))).toEqual(DEFAULT_PARAMS);
    expect(loadSettings(fake(JSON.stringify({ holdDays: 3 })))).toEqual(DEFAULT_PARAMS);
    expect(loadSettings({ getItem: () => { throw new Error('blocked'); } })).toEqual(DEFAULT_PARAMS);
  });

  it('restores valid saved settings, filling anything missing from the defaults', () => {
    expect(loadSettings(fake(JSON.stringify({ holdDays: 25, stopLoss: 0.4 })))).toEqual({ ...DEFAULT_PARAMS, holdDays: 25, stopLoss: 0.4 });
  });

  it('saves JSON under the key and reports failure instead of throwing', () => {
    const written: Record<string, string> = {};
    expect(saveSettings({ setItem: (k, v) => { written[k] = v; } }, DEFAULT_PARAMS)).toBe(true);
    expect(JSON.parse(written[SETTINGS_KEY])).toEqual(DEFAULT_PARAMS);
    expect(saveSettings({ setItem: () => { throw new Error('quota'); } }, DEFAULT_PARAMS)).toBe(false);
    expect(saveSettings(null, DEFAULT_PARAMS)).toBe(false);
  });
});

describe('jobPhase', () => {
  it('maps a job (or none) to the state the tab shows', () => {
    expect(jobPhase(null)).toBe('idle');
    expect(jobPhase({ status: 'running' })).toBe('running');
    expect(jobPhase({ status: 'done' })).toBe('done');
    expect(jobPhase({ status: 'login_required' })).toBe('login');
    expect(jobPhase({ status: 'failed' })).toBe('failed');
  });
});

const variant = (over: Partial<VariantView> = {}): VariantView => ({
  name: 'bull_full', side: 1, stats: { n: 150, winRate: 40, avgWinR: 0.9, avgLossR: -0.5, expectancyR: 0.08, profitFactor: 1.3 }, firstHalf: { n: 75, expectancyR: 0.05 }, secondHalf: { n: 75, expectancyR: 0.11 }, tradeCount: 150, lowSample: false, ...over,
});

describe('halvesVerdict', () => {
  it('is positive when both halves have positive expectancy', () => {
    expect(halvesVerdict(variant())).toBe('positive in both halves');
  });

  it('is not positive when either half is zero or negative', () => {
    expect(halvesVerdict(variant({ firstHalf: { n: 75, expectancyR: -0.01 } }))).toBe('not positive in both halves');
    expect(halvesVerdict(variant({ secondHalf: { n: 75, expectancyR: 0 } }))).toBe('not positive in both halves');
  });

  it('says there is nothing to split when a half is missing or empty', () => {
    expect(halvesVerdict(variant({ firstHalf: undefined, secondHalf: undefined, tradeCount: 0, stats: { n: 0 } }))).toBe('too few trades to split');
    expect(halvesVerdict(variant({ firstHalf: { n: 0 } }))).toBe('too few trades to split');
  });
});

describe('variantNotes', () => {
  it('flags fewer than 100 trades', () => {
    expect(variantNotes(variant({ lowSample: true, tradeCount: 42 }), 100).join(' ')).toMatch(/fewer than 100 trades \(42\)/i);
    expect(variantNotes(variant(), 100)).toEqual([]);
  });

  it('flags a non-positive expectancy', () => {
    expect(variantNotes(variant({ stats: { n: 150, expectancyR: -0.02 } }), 100).join(' ')).toMatch(/no positive edge/i);
  });
});
