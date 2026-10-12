import { describe, expect, it } from 'vitest';

import { pctTrend } from '@/lib/ltp/pct-trend';
import { istTs } from '@/lib/ltp/time';

const now = istTs('2026-10-12', '11:00');
const pts = (...pcts: (number | null)[]) => pcts.map((pct, i) => ({ ts: now - (pcts.length - 1 - i) * 600, pct }));

// Course ch12 and ch13: rising WTB% is bearish, falling WTB% bullish; rising WTT% bullish, falling WTT% bearish.
describe('weak-percentage trend as a pressure signal', () => {
  it('WTB: rising is bearish, falling is bullish', () => {
    expect(pctTrend(pts(80, 85, 92), 'wtb', now)).toEqual({ trend: 'rising', bias: 'bearish', from: 80, to: 92 });
    expect(pctTrend(pts(92, 85, 80), 'wtb', now)).toMatchObject({ trend: 'falling', bias: 'bullish' });
  });
  it('WTT: rising is bullish, falling is bearish', () => {
    expect(pctTrend(pts(80, 85, 92), 'wtt', now)).toMatchObject({ trend: 'rising', bias: 'bullish' });
    expect(pctTrend(pts(92, 85, 80), 'wtt', now)).toMatchObject({ trend: 'falling', bias: 'bearish' });
  });
  it('a change under 2 points over the window is flat and neutral', () => {
    expect(pctTrend(pts(80, 80.5, 81), 'wtb', now)).toMatchObject({ trend: 'flat', bias: 'neutral' });
  });
  it('a strong side has no weak percentage to trend', () => { expect(pctTrend(pts(40, 50, 60), 'strong', now)).toBeNull(); });
  it('needs two readings inside the 30-minute window; older ones and gaps are ignored', () => {
    expect(pctTrend(pts(90), 'wtb', now)).toBeNull();
    expect(pctTrend([{ ts: now - 7200, pct: 70 }, { ts: now, pct: 90 }], 'wtb', now)).toBeNull();
    expect(pctTrend(pts(null, null, 90), 'wtb', now)).toBeNull();
  });
});
