import { describe, expect, it } from 'vitest';

import { DEFAULT_PARAMS } from '../../lib/screener/config';
import { describeCondition, DEFAULT_RULES, evaluateSide, FIELDS, fieldValue, referenceRules, validateRules, type Condition, type RuleSet } from '../../lib/screener/rules';
import type { IndRow } from '../../lib/screener/types';

const row = (over: Partial<IndRow> = {}): IndRow => ({
  date: '2026-10-01', open: 99, high: 103, low: 98, close: 100, volume: 2000,
  sma20: 101, sma50: 95, sma200: 90, rsi: 40, rs63: 0.05, volRatio: 1.5, hv20: 0.3, hvPct: 0.4, prevHigh: 99, prevLow: 97,
  ...over,
});
const c = (left: Condition['left'], op: Condition['op'], right: Condition['right'], role: Condition['role'] = 'filter'): Condition => ({ left, op, right, role });
const value = (v: number) => ({ kind: 'value' as const, value: v });

describe('fieldValue', () => {
  it('reads raw fields and presents percentages in the units the user types', () => {
    const r = row();
    expect(fieldValue(r, 'close')).toBe(100);
    expect(fieldValue(r, 'sma200')).toBe(90);
    expect(fieldValue(r, 'prevHigh')).toBe(99);
    expect(fieldValue(r, 'rsi')).toBe(40);
    expect(fieldValue(r, 'rsVsNifty')).toBeCloseTo(5, 12); // 0.05 as a percent
    expect(fieldValue(r, 'hv20')).toBeCloseTo(30, 12); // annualised percent
    expect(fieldValue(r, 'hvPctile')).toBe(0.4);
    expect(fieldValue(r, 'volRatio')).toBe(1.5);
  });

  it('lists every field it can read', () => {
    for (const f of FIELDS) expect(Number.isFinite(fieldValue(row(), f)), f).toBe(true);
  });
});

describe('evaluateSide', () => {
  it('compares a field with a number using each operator', () => {
    expect(evaluateSide(row(), [c('rsi', '>', value(39))])).toBe('SIGNAL');
    expect(evaluateSide(row(), [c('rsi', '>', value(40))])).toBeNull();
    expect(evaluateSide(row(), [c('rsi', '>=', value(40))])).toBe('SIGNAL');
    expect(evaluateSide(row(), [c('rsi', '<', value(41))])).toBe('SIGNAL');
    expect(evaluateSide(row(), [c('rsi', '<', value(40))])).toBeNull();
    expect(evaluateSide(row(), [c('rsi', '<=', value(40))])).toBe('SIGNAL');
  });

  it('between is inclusive at both ends', () => {
    const between = (low: number, high: number) => c('rsi', 'between', { kind: 'between', low, high });
    expect(evaluateSide(row(), [between(35, 48)])).toBe('SIGNAL');
    expect(evaluateSide(row({ rsi: 35 }), [between(35, 48)])).toBe('SIGNAL');
    expect(evaluateSide(row({ rsi: 48 }), [between(35, 48)])).toBe('SIGNAL');
    expect(evaluateSide(row({ rsi: 48.01 }), [between(35, 48)])).toBeNull();
    expect(evaluateSide(row({ rsi: 34.99 }), [between(35, 48)])).toBeNull();
  });

  it('compares one field with another, with a multiplier', () => {
    expect(evaluateSide(row(), [c('close', '>', { kind: 'field', field: 'sma200', multiplier: 1 })])).toBe('SIGNAL');
    expect(evaluateSide(row(), [c('close', '<=', { kind: 'field', field: 'sma20', multiplier: 1.01 })])).toBe('SIGNAL'); // 100 <= 102.01
    expect(evaluateSide(row(), [c('close', '<=', { kind: 'field', field: 'sma20', multiplier: 0.98 })])).toBeNull(); // 100 <= 98.98 is false
    expect(evaluateSide(row(), [c('sma50', '>', { kind: 'field', field: 'sma200', multiplier: 1 })])).toBe('SIGNAL');
  });

  it('every filter must pass; a trigger that fails turns SIGNAL into WATCH; a failing filter is nothing', () => {
    const filter = c('close', '>', { kind: 'field', field: 'sma200', multiplier: 1 });
    const trigger = c('close', '>', { kind: 'field', field: 'prevHigh', multiplier: 1 }, 'trigger');
    expect(evaluateSide(row(), [filter, trigger])).toBe('SIGNAL');
    expect(evaluateSide(row({ prevHigh: 105 }), [filter, trigger])).toBe('WATCH');
    expect(evaluateSide(row({ close: 80, prevHigh: 70 }), [filter, trigger])).toBeNull();
  });

  it('with only triggers there is no WATCH state: all pass is a signal, otherwise nothing is shown for them as filters', () => {
    const trigger = c('close', '>', { kind: 'field', field: 'prevHigh', multiplier: 1 }, 'trigger');
    expect(evaluateSide(row(), [trigger])).toBe('SIGNAL');
    expect(evaluateSide(row({ prevHigh: 105 }), [trigger])).toBe('WATCH');
  });

  it('no rules means no candidates', () => {
    expect(evaluateSide(row(), [])).toBeNull();
  });

  it('a missing value (NaN) in any field makes that rule fail, like the reference', () => {
    expect(evaluateSide(row({ sma200: Number.NaN }), [c('close', '>', { kind: 'field', field: 'sma200', multiplier: 1 })])).toBeNull();
    expect(evaluateSide(row({ rsi: Number.NaN }), [c('rsi', 'between', { kind: 'between', low: 0, high: 100 })])).toBeNull();
    expect(evaluateSide(row({ hvPct: Number.NaN }), [c('hvPctile', '<=', value(0.6))])).toBeNull();
    expect(evaluateSide(row({ rsi: Number.NaN }), [c('rsi', '>', value(10)), c('close', '>', value(1), 'trigger')])).toBeNull();
  });
});

describe('validateRules', () => {
  const ok = (rules: unknown) => validateRules(rules);

  it('treats nothing as the disabled default and accepts the default as is', () => {
    expect(ok(undefined)).toEqual({ ok: true, value: DEFAULT_RULES });
    expect(DEFAULT_RULES).toEqual({ enabled: false, bull: [], bear: [] });
    expect(ok(DEFAULT_RULES)).toEqual({ ok: true, value: DEFAULT_RULES });
  });

  it('accepts well-formed rules', () => {
    const rules: RuleSet = { enabled: true, bull: [c('rsi', 'between', { kind: 'between', low: 35, high: 48 }), c('close', '>', { kind: 'field', field: 'sma200', multiplier: 1 }, 'trigger')], bear: [c('rsi', '>', value(60))] };
    expect(ok(rules)).toEqual({ ok: true, value: rules });
  });

  it.each([
    ['not an object', 'rules'],
    ['unknown top-level key', { enabled: true, bull: [], bear: [], extra: 1 }],
    ['enabled is not a boolean', { enabled: 'yes', bull: [], bear: [] }],
    ['bull is not a list', { enabled: true, bull: {}, bear: [] }],
    ['unknown field', { enabled: true, bull: [c('macd' as never, '>', value(0))], bear: [] }],
    ['unknown operator', { enabled: true, bull: [c('rsi', '=>' as never, value(0))], bear: [] }],
    ['unknown role', { enabled: true, bull: [{ left: 'rsi', op: '>', right: value(1), role: 'maybe' }], bear: [] }],
    ['non-finite number', { enabled: true, bull: [c('rsi', '>', value(Number.POSITIVE_INFINITY))], bear: [] }],
    ['between with the ends reversed', { enabled: true, bull: [c('rsi', 'between', { kind: 'between', low: 60, high: 40 })], bear: [] }],
    ['between without a range', { enabled: true, bull: [c('rsi', 'between', value(50))], bear: [] }],
    ['a range with a non-between operator', { enabled: true, bull: [c('rsi', '>', { kind: 'between', low: 1, high: 2 })], bear: [] }],
    ['unknown right-hand field', { enabled: true, bull: [c('close', '>', { kind: 'field', field: 'ema9' as never, multiplier: 1 })], bear: [] }],
    ['zero or negative multiplier', { enabled: true, bull: [c('close', '>', { kind: 'field', field: 'sma20', multiplier: 0 })], bear: [] }],
    ['more than 20 rules on a side', { enabled: true, bull: Array.from({ length: 21 }, () => c('rsi', '>', value(1))), bear: [] }],
    ['extra keys on a condition', { enabled: true, bull: [{ ...c('rsi', '>', value(1)), note: 'x' }], bear: [] }],
  ])('rejects %s', (_label, rules) => {
    expect(ok(rules).ok).toBe(false);
  });

  it('enabled rules need at least one rule on at least one side', () => {
    expect(ok({ enabled: true, bull: [], bear: [] }).ok).toBe(false);
    expect(ok({ enabled: true, bull: [c('rsi', '>', value(1))], bear: [] }).ok).toBe(true);
    expect(ok({ enabled: false, bull: [], bear: [] }).ok).toBe(true);
  });
});

describe('describeCondition', () => {
  it('writes a rule the way a person would read it', () => {
    expect(describeCondition(c('rsi', 'between', { kind: 'between', low: 35, high: 48 }))).toBe('RSI(14) is between 35 and 48 (inclusive)');
    expect(describeCondition(c('close', '<=', { kind: 'field', field: 'sma20', multiplier: 1.01 }))).toBe('Close is at most 1.01 × 20-day SMA');
    expect(describeCondition(c('close', '>', { kind: 'field', field: 'sma200', multiplier: 1 }))).toBe('Close is above 200-day SMA');
    expect(describeCondition(c('rsVsNifty', '<', value(0)))).toBe('Relative strength vs Nifty, 63-day (%) is below 0');
    expect(describeCondition(c('close', '>', { kind: 'field', field: 'prevHigh', multiplier: 1 }, 'trigger'))).toBe('Close is above previous day high (trigger)');
  });
});

describe('referenceRules (the built-in rules written as custom rules)', () => {
  const { bull, bear } = referenceRules(DEFAULT_PARAMS);

  it('bull: eight rules, seven filters and the previous-high trigger', () => {
    expect(bull).toHaveLength(8);
    expect(bull.filter((r) => r.role === 'trigger')).toEqual([c('close', '>', { kind: 'field', field: 'prevHigh', multiplier: 1 }, 'trigger')]);
  });

  it('bear mirrors it: below the averages, negative strength, a bounce, a close below the previous low', () => {
    expect(bear).toHaveLength(8);
    expect(bear.filter((r) => r.role === 'trigger')).toEqual([c('close', '<', { kind: 'field', field: 'prevLow', multiplier: 1 }, 'trigger')]);
  });

  it('takes the band and tolerance numbers from the settings it is given', () => {
    const custom = referenceRules({ ...DEFAULT_PARAMS, rsiBull: [30, 50], hvPctMax: 0.8 });
    expect(custom.bull).toContainEqual(c('rsi', 'between', { kind: 'between', low: 30, high: 50 }));
    expect(custom.bull).toContainEqual(c('hvPctile', '<=', value(0.8)));
  });

  it('passes validation', () => {
    expect(validateRules({ enabled: true, bull, bear }).ok).toBe(true);
  });
});
