import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { reasonText } from '@/lib/ltp-agent/reason';
import { evaluate } from '@/lib/ltp-agent/signals';
import { parseStrategy } from '@/lib/ltp-agent/strategy';
import { fakeAnalysis, type FakeOpts } from '../support/ltp-analysis';

const v01 = parseStrategy(readFileSync('strategies/ltp_v0.1.yaml', 'utf8'));
const idle = { dayTradeCount: 0, openCount: 0, dayLossInr: 0 };
const textFor = (opts: FakeOpts, ctx = idle) => { const a = fakeAnalysis(opts); const c = evaluate(a, v01, ctx)[0]; return reasonText(c, a); };

describe('reasonText is a deterministic sentence built only from the rule trace', () => {
  it('a taken long, in the shape of the brief', () => {
    expect(textFor({ spot: 24012, spots: [24092, 24012] })).toBe(
      'LONG NIFTY: COA-1 scenario 1 (Strong/Strong; directions neutral/neutral); spot 24,012 touched EOS 24,010 (proxy: test) on hit #1; COA-2 = Stable/Increasing agrees; no opposing SOC; 10:42 inside window. SL 23,900, target 24,200, planned risk 112 pts.',
    );
  });
  it('a taken short names the weak side and its scenario', () => {
    expect(textFor({ support: 'strong', resistance: 'wtt', spot: 24173, spots: [24120, 24173] })).toBe(
      'SHORT NIFTY: COA-1 scenario 3 (Strong/WTT; directions neutral/neutral); spot 24,173 touched WTT-1 24,175 (proxy: test) on hit #1; COA-2 = Stable/Increasing disagrees (logged only); no opposing SOC; 10:42 inside window. SL 24,310, target 24,010, planned risk 137 pts.',
    );
  });
  it('a skip leads with the first failed rule in plain words', () => {
    expect(textFor({ support: 'wtb', resistance: 'wtb', spot: 24012, spots: [24092, 24012] })).toBe(
      'SKIPPED LONG NIFTY: scenario 6 does not allow longs; COA-1 scenario 6 (WTB/WTB; directions neutral/neutral); spot 24,012 touched EOS 24,010 (proxy: test) on hit #1; 10:42.',
    );
    expect(textFor({ hhmm: '09:25', spot: 24012, spots: [24092, 24012] })).toBe(
      'SKIPPED LONG NIFTY: 09:25 is outside the 09:30 to 14:45 window; COA-1 scenario 1 (Strong/Strong; directions neutral/neutral); spot 24,012 touched EOS 24,010 (proxy: test) on hit #1; 09:25.',
    );
  });
  it('names the side directions the scenario was picked from, since they can differ from the statuses', () => {
    expect(textFor({ support: 'strong', resistance: 'wtb', supportDirection: 'bearish', resistanceDirection: 'bearish', spot: 23962, spots: [24092, 23962] })).toContain('COA-1 scenario 2 (Strong/WTB; directions bearish/bearish);');
  });
  it('each skip rule has its own wording', () => {
    const a = fakeAnalysis({ spot: 24012, spots: [24092, 24012] });
    const cases: [string, string][] = [
      ['daily_trade_cap', 'the daily trade cap is reached'], ['max_concurrent', 'a trade is already open on this underlying'], ['daily_loss_cap', 'the daily loss cap is reached'],
    ];
    const ctxs = { daily_trade_cap: { ...idle, dayTradeCount: 3 }, max_concurrent: { ...idle, openCount: 1 }, daily_loss_cap: { ...idle, dayLossInr: 99999 } } as const;
    for (const [rule, words] of cases) expect(reasonText(evaluate(a, v01, ctxs[rule as keyof typeof ctxs])[0], a)).toContain(`SKIPPED LONG NIFTY: ${words};`);
  });
  it('the same candidate always gives the same text, and BANKNIFTY and SENSEX are named', () => {
    const a = fakeAnalysis({ spot: 24012, spots: [24092, 24012], underlying: 'NSE:NIFTYBANK-INDEX' });
    const c = evaluate(a, v01, idle)[0];
    expect(reasonText(c, a)).toBe(reasonText(c, a));
    expect(reasonText(c, a).startsWith('LONG BANKNIFTY:')).toBe(true);
    const s = fakeAnalysis({ spot: 24012, spots: [24092, 24012], underlying: 'BSE:SENSEX-INDEX' });
    expect(reasonText(evaluate(s, v01, idle)[0], s).startsWith('LONG SENSEX:')).toBe(true);
  });
});
