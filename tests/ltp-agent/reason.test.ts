import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { reasonText } from '@/lib/ltp-agent/reason';
import { evaluate } from '@/lib/ltp-agent/signals';
import { parseStrategy } from '@/lib/ltp-agent/strategy';
import { fakeAnalysis, type FakeOpts } from '../support/ltp-analysis';

const v01 = parseStrategy(readFileSync('strategies/ltp_v0.1.yaml', 'utf8'));
const idle = { dayTradeCount: 0, openCount: 0, dayLossInr: 0 };
const textFor = (opts: FakeOpts, ctx = idle) => { const a = fakeAnalysis(opts); const c = evaluate(a, v01, ctx)[0]; return reasonText(c, a); };

describe('reasonText is a short, deterministic line built only from the rule trace', () => {
  it('a taken long: direction, index, the signal tag, the level and hit, stop, target, risk, COA 2.0', () => {
    expect(textFor({ spot: 24012, spots: [24092, 24012] })).toBe('LONG NIFTY 1(S1/R1) S-Stable R-Stable · EOS 24,010 #1 · SL 23,900 · T 24,200 · risk 112 · COA2 #4');
  });
  it('a taken short names the weak side through the tag', () => {
    expect(textFor({ support: 'strong', resistance: 'wtt', spot: 24173, spots: [24120, 24173] })).toMatch(/^SHORT NIFTY 3\(S1\/R1\) S-Stable R-Bullish · WTT-1 24,175 #1 · SL 24,310 · T 24,010 · risk \d+/);
  });
  it('a taken trade under a State of Confusion says so in a few words', () => {
    const soc = { type: '1h' as const, side: 'support' as const, bias: 'bearish' as const, from: 'EOR' as const, startedAt: 0, minutes: 70, spread: 3, targetStrike: 23900, zone: { low: 23900, high: 24000 }, target: 24090 };
    expect(textFor({ spot: 24198, spots: [24120, 24198], soc })).toContain(' · SOC 1h bearish');
  });
  it('a skip leads with the first failed rule in a few words, then the level', () => {
    expect(textFor({ support: 'wtb', resistance: 'wtb', spot: 24012, spots: [24092, 24012] })).toBe('SKIPPED LONG NIFTY 6(S1/R1) S-Bearish R-Bearish · no bottom (Blood Bath) · EOS 24,010 #1');
    expect(textFor({ hhmm: '09:25', spot: 24012, spots: [24092, 24012] })).toBe('SKIPPED LONG NIFTY 1(S1/R1) S-Stable R-Stable · 09:25 outside 09:30-14:45 · EOS 24,010 #1');
  });
  it('a short with no top says so too', () => {
    const a = fakeAnalysis({ pressure: { support: 'U', resistance: 'U' }, spot: 24198, spots: [24120, 24198] });
    expect(reasonText(evaluate(a, v01, idle).find((x) => x.direction === 'short')!, a)).toContain(' · no top (Bull Run) · ');
  });
  it('a disagreement between the live scenario and the graph is named as such', () => {
    const v20 = parseStrategy(readFileSync('strategies/ltp_v2.0.yaml', 'utf8'));
    const a = fakeAnalysis({ spot: 24012, spots: [24092, 24012] });
    a.coa1.scenario = { ...a.coa1.scenario, top: 'EOR+1' };
    expect(reasonText(evaluate(a, v20, idle)[0], a)).toContain(' · graph mismatch · ');
  });
  it('the sides\' direction tags show the pressure, with (H) when high', () => {
    const a = fakeAnalysis({ pressure: { support: 'HB', resistance: 'S' }, spot: 24012, spots: [24092, 24012] });
    expect(reasonText(evaluate(a, v01, idle)[0], a)).toContain('S-Bearish(H) R-Stable');
  });
  it('each skip rule has its own few words', () => {
    const a = fakeAnalysis({ spot: 24012, spots: [24092, 24012] });
    const cases: [string, string][] = [['daily_trade_cap', 'daily trade cap'], ['max_concurrent', 'trade already open'], ['daily_loss_cap', 'daily loss cap']];
    const ctxs = { daily_trade_cap: { ...idle, dayTradeCount: 3 }, max_concurrent: { ...idle, openCount: 1 }, daily_loss_cap: { ...idle, dayLossInr: 99999 } } as const;
    for (const [rule, words] of cases) expect(reasonText(evaluate(a, v01, ctxs[rule as keyof typeof ctxs])[0], a)).toContain(` · ${words} · `);
  });
  it('the same candidate always gives the same text, and BANKNIFTY and SENSEX are named', () => {
    const a = fakeAnalysis({ spot: 24012, spots: [24092, 24012], underlying: 'NSE:NIFTYBANK-INDEX' });
    const c = evaluate(a, v01, idle)[0];
    expect(reasonText(c, a)).toBe(reasonText(c, a));
    expect(reasonText(c, a).startsWith('LONG BANKNIFTY ')).toBe(true);
    const s = fakeAnalysis({ spot: 24012, spots: [24092, 24012], underlying: 'BSE:SENSEX-INDEX' });
    expect(reasonText(evaluate(s, v01, idle)[0], s).startsWith('LONG SENSEX ')).toBe(true);
  });
});
