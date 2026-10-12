import { describe, expect, it } from 'vitest';

import type { SideEvent } from '@/lib/ltp/direction';
import { pressureOf } from '@/lib/ltp/pressure';
import type { Status } from '@/lib/ltp/types';

// Event texts exactly as sideEvents() writes them.
const T = {
  init: 'STABLE STRONG', up: 'Shifted from Bottom to Top', down: 'Shifted from Top to Bottom',
  wtt: 'WEAK TOWARDS TOP', wtb: 'WEAK TOWARDS BOTTOM', fromWtt: 'WTT TO STRONG', fromWtb: 'WTB TO STRONG',
} as const;
const log = (...kinds: (keyof typeof T)[]): SideEvent[] => kinds.map((k, i) => ({ ts: i, strike: 0, status: 'strong', second: null, label: '', text: T[k], direction: 'neutral' }));
const p = (now: Status, ...kinds: (keyof typeof T)[]) => pressureOf(log(...kinds), now);

// The "Detailed Chart of Accuracy" history conditions (docs/ltp-rules-reference.md, part 7.1).
describe('pressure class of one side from its history today', () => {
  it('strong since morning is S', () => { expect(p('strong', 'init')).toBe('S'); expect(pressureOf([], 'strong')).toBe('S'); });
  it('strong after a single shift: down is B, up is U', () => { expect(p('strong', 'init', 'down')).toBe('B'); expect(p('strong', 'init', 'up')).toBe('U'); });
  it('initially WTB then strong is U; initially WTT then strong is B', () => { expect(p('strong', 'wtb', 'fromWtb')).toBe('U'); expect(p('strong', 'wtt', 'fromWtt')).toBe('B'); });
  it('double shifting the same way is highly bearish or highly bullish', () => { expect(p('strong', 'init', 'down', 'down')).toBe('HB'); expect(p('strong', 'init', 'up', 'up')).toBe('HU'); });
  it('shifted one way, became strong, then shifted back: the latest shift decides', () => {
    expect(p('strong', 'init', 'down', 'wtb', 'fromWtb', 'up')).toBe('U');
    expect(p('strong', 'init', 'up', 'wtt', 'fromWtt', 'down')).toBe('B');
  });
  it('shifted down, WTT at the new place, then strong again (not shifted): B; shifted up, WTB, strong: U', () => {
    expect(p('strong', 'init', 'down', 'wtt', 'fromWtt')).toBe('B');
    expect(p('strong', 'init', 'up', 'wtb', 'fromWtb')).toBe('U');
  });
  it('currently WTB is B and currently WTT is U', () => { expect(p('wtb', 'wtb')).toBe('B'); expect(p('wtt', 'wtt')).toBe('U'); });
  it('shifted down and now WTB again is HB; shifted up and now WTT again is HU', () => {
    expect(p('wtb', 'wtb', 'down', 'wtb')).toBe('HB');
    expect(p('wtt', 'wtt', 'up', 'wtt')).toBe('HU');
  });
  it('shifted up and in that continuation WTB is U; shifted down and in that continuation WTT is B', () => {
    expect(p('wtb', 'init', 'up', 'wtb')).toBe('U');
    expect(p('wtt', 'init', 'down', 'wtt')).toBe('B');
    expect(pressureOf(log('init', 'up'), 'wtb')).toBe('U'); // the weakness appeared with the shift itself
  });
  it('shifted up, then WTB at a new place (the weak strike moved) is B; shifted down then WTT at a new place is U', () => {
    expect(p('wtb', 'init', 'up', 'wtb', 'wtb')).toBe('B');
    expect(p('wtt', 'init', 'down', 'wtt', 'wtt')).toBe('U');
  });
  it('shifted up, became strong, and WTB again somewhere is B; the mirror is U', () => {
    expect(p('wtb', 'init', 'up', 'wtt', 'fromWtt', 'wtb')).toBe('B');
    expect(p('wtt', 'init', 'down', 'wtb', 'fromWtb', 'wtt')).toBe('U');
  });
});
