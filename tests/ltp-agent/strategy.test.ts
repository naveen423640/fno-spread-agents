import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { applyDiff, parseStrategy, TUNABLE_FIELDS, validateDiff } from '@/lib/ltp-agent/strategy';
import { listStrategyVersions, readStrategyFile } from '@/lib/ltp-agent/strategy-files';

const v01 = () => readFileSync('strategies/ltp_v0.1.yaml', 'utf8');

describe('ltp_v0.1.yaml is the pure course rules with the defaults of the brief', () => {
  const s = parseStrategy(v01());
  it('entry, filters and caps', () => {
    expect(s.version).toBe('0.1');
    expect(s.entry_profile).toBe('risky');
    expect(s.touch_tolerance_pts).toBe(5);
    expect(s.window).toEqual({ start: '09:30', end: '14:45', nine_twenty_start: '09:21' });
    expect(s.max_hit_number).toBe(2);
    expect(s.require_coa2_agree).toBe(false);
    expect(s.block_on_opposing_soc).toBe(true);
    expect(s.block_scenarios).toEqual([8, 9]);
    expect(s.time_exit).toBe('15:15');
    expect(s.exit_on_level_shift).toBe(false);
    expect(s.risk).toMatchObject({ max_trades_per_day: 3, max_concurrent: 1 });
  });
  it('setups: COA 1.0 reversal, 9:20 and SOC on; end of diversion off', () => {
    expect(s.setups_enabled).toEqual({ coa1_reversal: true, nine_twenty: true, soc: true, end_of_diversion: false });
  });
  it('scenarios traded follow the course table: both sides in 1 to 5, shorts only in 6 (Blood Bath), longs only in 7 (Bull Run), nothing in 8 and 9', () => {
    for (const n of ['1', '2', '3', '4', '5']) expect(s.scenarios_traded[n as '1']).toEqual({ long: true, short: true });
    expect(s.scenarios_traded['6']).toEqual({ long: false, short: true });
    expect(s.scenarios_traded['7']).toEqual({ long: true, short: false });
    expect(s.scenarios_traded['8']).toEqual({ long: false, short: false });
    expect(s.scenarios_traded['9']).toEqual({ long: false, short: false });
  });
  it('books and fills', () => {
    expect(s.books).toEqual({ buy: { strike: 'atm' }, sell: { hedge_width: 4 } });
    expect(s.fills).toEqual({ slippage_ticks: 1, tick: 0.05, fallback_slippage_pct: 2 });
    expect(s.stop_rule).toBe('nine_twenty');
    expect(s.stop_buffer_pts).toBe(10);
  });
});

describe('parseStrategy rejects a bad file and names the field', () => {
  const broken = (edit: (text: string) => string) => () => parseStrategy(edit(v01()));
  it('an unknown key', () => { expect(broken((t) => `${t}\nsurprise: 1\n`)).toThrow(/surprise/); });
  it('a time that is not HH:MM', () => { expect(broken((t) => t.replace('start: "09:30"', 'start: "9.30"'))).toThrow(/window\.start/); });
  it('a negative tolerance', () => { expect(broken((t) => t.replace('touch_tolerance_pts: 5', 'touch_tolerance_pts: -1'))).toThrow(/touch_tolerance_pts/); });
  it('a missing scenario', () => { expect(broken((t) => t.replace(/\n  "9": \{[^}]*\}/, ''))).toThrow(/scenarios_traded/); });
});

describe('only the tunable fields can change, inside their bounds', () => {
  it('lists the tunable fields and every one has a bound', () => {
    expect(Object.keys(TUNABLE_FIELDS).sort()).toEqual(['books.sell.hedge_width', 'entry_profile', 'exit_on_level_shift', 'max_hit_number', 'require_coa2_agree', 'risk.max_trades_per_day', 'stop_buffer_pts', 'touch_tolerance_pts', 'window.end', 'window.start']);
  });
  it('accepts a value inside the bounds', () => {
    expect(validateDiff({ touch_tolerance_pts: 8 })).toEqual({ ok: true });
    expect(validateDiff({ 'window.start': '09:45', require_coa2_agree: true })).toEqual({ ok: true });
  });
  it('rejects a field that is not tunable, even a real one', () => {
    const r = validateDiff({ 'risk.daily_loss_cap_inr': 1 });
    expect(r).toMatchObject({ ok: false });
    expect(validateDiff({ 'books.buy.strike': 'otm1' })).toMatchObject({ ok: false });
  });
  it('rejects out-of-bounds values, a fraction for an integer field, the wrong type and an empty diff', () => {
    expect(validateDiff({ max_hit_number: 9 })).toMatchObject({ ok: false });
    expect(validateDiff({ max_hit_number: 1.5 })).toMatchObject({ ok: false });
    expect(validateDiff({ touch_tolerance_pts: '8' })).toMatchObject({ ok: false });
    expect(validateDiff({ entry_profile: 'wild' })).toMatchObject({ ok: false });
    expect(validateDiff({})).toMatchObject({ ok: false });
  });
  it('one bad field makes the whole diff invalid', () => {
    expect(validateDiff({ touch_tolerance_pts: 8, max_hit_number: 9 })).toMatchObject({ ok: false });
  });
  it('applyDiff does not change its input, and the result is a valid strategy with the change in it', () => {
    const base = parseStrategy(v01());
    const before = JSON.stringify(base);
    const next = applyDiff(base, { touch_tolerance_pts: 8, 'window.start': '09:45', 'books.sell.hedge_width': 3 });
    expect(JSON.stringify(base)).toBe(before);
    expect(next.touch_tolerance_pts).toBe(8);
    expect(next.window.start).toBe('09:45');
    expect(next.books.sell.hedge_width).toBe(3);
    expect(next.window.end).toBe('14:45');
  });
  it('applyDiff throws on an invalid diff instead of applying part of it', () => {
    expect(() => applyDiff(parseStrategy(v01()), { max_hit_number: 9 })).toThrow();
  });
});

describe('strategy files', () => {
  it('lists the versions on disk and reads one by version', () => {
    expect(listStrategyVersions()).toContain('0.1');
    expect(readStrategyFile('0.1').version).toBe('0.1');
  });
  it('a version that is not on disk throws a clear error', () => {
    expect(() => readStrategyFile('9.9')).toThrow(/9\.9/);
  });
});
