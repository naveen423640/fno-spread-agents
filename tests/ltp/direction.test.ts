import { describe, expect, it } from 'vitest';

import { banner, currentDirection, sideEvents, type SideState } from '@/lib/ltp/direction';

// Real rows from the LTP Calculator's own support and resistance logs for NIFTY on 2026-10-12, oldest first, as the states they describe.
const T = (hms: string) => Date.parse(`2026-10-12T${hms}+05:30`) / 1000;
const st = (hms: string, strike: number, status: SideState['status'], second: number | null = null): SideState => ({ ts: T(hms), strike, status, second });
const summary = (events: ReturnType<typeof sideEvents>) => events.map((e) => [e.text, e.direction]);

describe('sideEvents: support side, 09:15 to 09:52', () => {
  const states = [
    st('09:15:25', 22600, 'wtb', 22500), st('09:15:29', 22500, 'wtt', 22600), st('09:15:37', 22600, 'wtb', 22500), st('09:20:17', 22600, 'strong'),
    st('09:21:49', 22600, 'wtb', 22500), st('09:21:50', 22600, 'strong'), st('09:23:55', 22600, 'wtb', 22500), st('09:29:29', 22500, 'wtt', 22600),
    st('09:29:30', 22600, 'wtb', 22500), st('09:29:32', 22500, 'wtt', 22600), st('09:52:01', 22500, 'strong'), st('09:52:02', 22500, 'wtt', 22600), st('09:52:03', 22500, 'strong'),
  ];
  it('names every change and its direction exactly as the tool logged it', () => {
    expect(summary(sideEvents(states))).toEqual([
      ['WEAK TOWARDS BOTTOM', 'bearish'], ['Shifted from Top to Bottom', 'bearish'], ['Shifted from Bottom to Top', 'bullish'], ['WTB TO STRONG', 'bullish'],
      ['WEAK TOWARDS BOTTOM', 'bearish'], ['WTB TO STRONG', 'bullish'], ['WEAK TOWARDS BOTTOM', 'bearish'], ['Shifted from Top to Bottom', 'bearish'],
      ['Shifted from Bottom to Top', 'bullish'], ['Shifted from Top to Bottom', 'bearish'], ['WTT TO STRONG', 'bearish'], ['WEAK TOWARDS TOP', 'bullish'], ['WTT TO STRONG', 'bearish'],
    ]);
  });
  it('writes the level label the way the tool does: strike - status - weak strike', () => {
    const e = sideEvents(states);
    expect(e[0].label).toBe('22600 - WTB - 22500');
    expect(e[1].label).toBe('22500 - WTT - 22600');
    expect(e[3].label).toBe('22600 - STRONG');
  });
  it('the current direction is the direction of the latest event', () => {
    expect(currentDirection(sideEvents(states))).toBe('bearish');
  });
});

describe('sideEvents: resistance side', () => {
  it('a first strong reading is "STABLE STRONG" and neutral; a second-strike change while weak is a new event; strong after WTT is bearish', () => {
    const states = [
      st('09:15:25', 22600, 'strong'), st('09:15:29', 22600, 'wtt', 22650), st('09:15:30', 22600, 'wtt', 22650), st('09:15:53', 22600, 'wtt', 22700), st('09:15:54', 22600, 'wtt', 22650),
      st('09:16:14', 22650, 'wtb', 22600), st('09:16:16', 22600, 'wtt', 22650), st('10:00:38', 22600, 'strong'), st('10:33:27', 22600, 'wtb', 22500),
    ];
    expect(summary(sideEvents(states))).toEqual([
      ['STABLE STRONG', 'neutral'], ['WEAK TOWARDS TOP', 'bullish'], ['WEAK TOWARDS TOP', 'bullish'], ['WEAK TOWARDS TOP', 'bullish'],
      ['Shifted from Bottom to Top', 'bullish'], ['Shifted from Top to Bottom', 'bearish'], ['WTT TO STRONG', 'bearish'], ['WEAK TOWARDS BOTTOM', 'bearish'],
    ]); // 09:15:30 repeats the 09:15:29 state and is not an event
  });
  it('no states gives no events and a neutral direction', () => {
    expect(sideEvents([])).toEqual([]);
    expect(currentDirection([])).toBe('neutral');
  });
});

describe('banner', () => {
  it('both sides bearish is Blood Bath, both bullish is Bull Run (seen on NIFTY, BANKNIFTY and SENSEX on 2026-10-12, and the December NIFTY screenshot)', () => {
    expect(banner('bearish', 'bearish')).toEqual({ kind: 'blood_bath', text: 'Blood Bath' });
    expect(banner('bullish', 'bullish')).toEqual({ kind: 'bull_run', text: 'Bull Run' });
  });
  it('anything else is mixed, never guessed', () => {
    expect(banner('bullish', 'bearish').kind).toBe('mixed');
    expect(banner('neutral', 'bearish').kind).toBe('mixed');
    expect(banner('neutral', 'neutral').kind).toBe('mixed');
  });
});
