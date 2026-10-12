import { describe, expect, it } from 'vitest';

import { extensionLevels, timeValueOnly, weakStrike, writerBreakeven, type ExtensionMethod } from '@/lib/ltp/extensions';
import { computeLevels } from '@/lib/ltp/levels';
import { statusOf } from '@/lib/ltp/strength';
import { makeChain } from '../support/ltp-chain';

const SPOT = 24037; // line 24000 / 24050

describe('writer_breakeven (C4)', () => {
  it('put-side reversal at 24000 with PE LTP 85.5 is 23914.5', () => {
    const s = makeChain({ spot: SPOT, step: 50, pe: { 24000: { ltp: 85.5 } } });
    expect(writerBreakeven.reversal(s, 24000, 'PE')).toBe(23914.5);
  });
  it('call-side reversal is the strike plus the call LTP', () => {
    const s = makeChain({ spot: SPOT, step: 50, ce: { 24100: { ltp: 62.25 } } });
    expect(writerBreakeven.reversal(s, 24100, 'CE')).toBe(24162.25);
  });
  it('is null when the LTP is missing or the strike is not in the chain', () => {
    const s = makeChain({ spot: SPOT, step: 50, pe: { 24000: { ltp: null } } });
    expect(writerBreakeven.reversal(s, 24000, 'PE')).toBeNull();
    expect(writerBreakeven.reversal(s, 99999, 'PE')).toBeNull();
  });
});

describe('time_value_only', () => {
  it('uses only the extrinsic part of the premium: a call 100 in the money with LTP 130 contributes 30', () => {
    const s = makeChain({ spot: 24100, step: 50, ce: { 24000: { ltp: 130 } } });
    expect(timeValueOnly.reversal(s, 24000, 'CE')).toBe(24030);
  });
  it('for a put in the money by 60 with LTP 95, the extrinsic part is 35', () => {
    const s = makeChain({ spot: 23940, step: 50, strikes: [23900, 24000, 24050], pe: { 24000: { ltp: 95 } } });
    expect(timeValueOnly.reversal(s, 24000, 'PE')).toBe(23965);
  });
  it('an out-of-the-money option is all time value, so it equals writer_breakeven there', () => {
    const s = makeChain({ spot: SPOT, step: 50, pe: { 23900: { ltp: 20 } } });
    expect(timeValueOnly.reversal(s, 23900, 'PE')).toBe(writerBreakeven.reversal(s, 23900, 'PE'));
  });
});

describe('pluggable interface', () => {
  it('any method with the same signature can be passed in, and its id and label travel with every level', () => {
    const fixed: ExtensionMethod = { id: 'fixed', label: 'fixed test method', reversal: (_s, strike, side) => (side === 'PE' ? strike - 1 : strike + 1) };
    const s = makeChain({ spot: SPOT, step: 50 });
    const l = computeLevels(s)!;
    const ext = extensionLevels(s, l, statusOf('support', l.support, l.line), statusOf('resistance', l.resistance, l.line), fixed);
    expect(ext.eos).toMatchObject({ strike: l.support.strike, value: l.support.strike - 1, method: 'fixed', isProxy: true });
    expect(ext.eos.label).toBe('EOS (proxy: fixed test method)');
    expect(ext.eor.label).toBe('EOR (proxy: fixed test method)');
  });
});

describe('EOS / EOR and their extensions', () => {
  // Support is the highest PE at or below 24000, resistance the highest CE at or above 24050.
  const s = makeChain({ spot: SPOT, step: 50, pe: { 23900: { volume: 9000, oi: 9000, ltp: 40 }, 23850: { ltp: 30 }, 23800: { ltp: 25 } }, ce: { 24200: { volume: 9000, oi: 9000, ltp: 55 }, 24250: { ltp: 45 }, 24300: { ltp: 35 } } });
  const l = computeLevels(s)!;
  const sup = statusOf('support', l.support, l.line);
  const res = statusOf('resistance', l.resistance, l.line);
  const ext = extensionLevels(s, l, sup, res, writerBreakeven);

  it('EOS is the put-side reversal at the support strike and EOR the call-side reversal at the resistance strike', () => {
    expect(l.support.strike).toBe(23900);
    expect(l.resistance.strike).toBe(24200);
    expect(ext.eos.value).toBe(23900 - 40);
    expect(ext.eor.value).toBe(24200 + 55);
  });
  it('EOS-n steps down and EOR+n steps up by n strike steps', () => {
    expect(ext.eosMinus[0]).toMatchObject({ strike: 23850, value: 23850 - 30, label: 'EOS-1 (proxy: writer breakeven)' });
    expect(ext.eosMinus[1]).toMatchObject({ strike: 23800, value: 23800 - 25 });
    expect(ext.eorPlus[0]).toMatchObject({ strike: 24250, value: 24250 + 45, label: 'EOR+1 (proxy: writer breakeven)' });
    expect(ext.eorPlus[1]).toMatchObject({ strike: 24300, value: 24300 + 35 });
  });
  it('WTB+1 and WTT-1 exist only when the status is WTB / WTT, taken at the weak strike plus or minus one step', () => {
    expect(ext.wtbPlus1).toBeNull(); // support is Strong here
    expect(ext.wttMinus1).toBeNull();
    // Support level 23900 with its second-highest 23850 at 90% (below: WTB): WTB strike 23850, plus one step is 23900.
    const w = makeChain({ spot: SPOT, step: 50, pe: { 23900: { volume: 10000, oi: 10000, ltp: 40 }, 23850: { volume: 9000, oi: 9000, ltp: 30 } }, ce: { 24200: { volume: 10000, oi: 10000, ltp: 55 }, 24250: { volume: 9000, oi: 9000, ltp: 45 } } });
    const wl = computeLevels(w)!;
    const e = extensionLevels(w, wl, statusOf('support', wl.support, wl.line), statusOf('resistance', wl.resistance, wl.line), writerBreakeven);
    expect(e.wtbPlus1).toMatchObject({ strike: 23900, value: 23900 - 40, label: 'WTB+1 (proxy: writer breakeven)' });
    // Resistance 24200 with its second-highest 24250 at 90% (above: WTT): WTT strike 24250, minus one step is 24200.
    expect(e.wttMinus1).toMatchObject({ strike: 24200, value: 24200 + 55, label: 'WTT-1 (proxy: writer breakeven)' });
  });
  it('a missing LTP gives a null value, never a number', () => {
    const missing = makeChain({ spot: SPOT, step: 50, pe: { 23900: { volume: 9000, oi: 9000, ltp: null } }, ce: { 24200: { volume: 9000, oi: 9000 } } });
    const ml = computeLevels(missing)!;
    const e = extensionLevels(missing, ml, statusOf('support', ml.support, ml.line), statusOf('resistance', ml.resistance, ml.line), writerBreakeven);
    expect(e.eos.value).toBeNull();
    expect(e.eos.isProxy).toBe(true);
  });
});

describe('weakStrike for a level based on one metric (real tool: "72500 - WTT - 73000", never the level itself)', () => {
  it('names the second-highest strike of the deciding metric, not of the other metric that peaks elsewhere', () => {
    // Volume peaks at 24200 (closer to the line) with its second at 24150: WTB-24150. OI peaks at 24300 with its second at 24200 at 95% (WTB, a higher pct): not the label.
    const s = makeChain({ spot: SPOT, step: 50, ce: { 24200: { volume: 100000, oi: 95000 }, 24150: { volume: 90000, oi: 1000 }, 24300: { volume: 1000, oi: 100000 } } });
    const l = computeLevels(s)!;
    const st = statusOf('resistance', l.resistance, l.line);
    expect(l.resistance.decidedBy).toBe('volume');
    expect(st.status).toBe('wtb');
    expect(weakStrike(st, l.resistance)).toBe(24150);
  });
  it('names the crossing metric\'s strike when the deciding metric is strong and the other crosses the level', () => {
    const s = makeChain({ spot: SPOT, step: 50, pe: { 23900: { volume: 100000, oi: 1000 }, 23700: { volume: 1000, oi: 100000 }, 24000: { volume: 1000, oi: 90000 } } });
    const l = computeLevels(s)!;
    const st = statusOf('support', l.support, l.line);
    expect(st.status).toBe('wtt');
    expect(weakStrike(st, l.support)).toBe(24000);
  });
});
