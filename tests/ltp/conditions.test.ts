import { describe, expect, it } from 'vitest';

import { HISTORY_CONDITIONS, eventsOf } from '@/lib/ltp/coa-histories';
import { LTP_CONFIG } from '@/lib/ltp/config';
import { classifyCondition } from '@/lib/ltp/conditions';
import { pressureOf } from '@/lib/ltp/pressure';
import type { Status } from '@/lib/ltp/types';

const NOW = 100 * 1800; // long after the last canonical event

describe('classifyCondition: a side\'s live log becomes one of the practice tool\'s numbered conditions', () => {
  for (const status of ['strong', 'wtb', 'wtt'] as Status[]) {
    HISTORY_CONDITIONS[status].forEach((c, i) => {
      it(`${status} condition ${i + 1} (${c.log.join(', ')}) is recognised as itself, with the pressure the log gives`, () => {
        const events = eventsOf(c.log);
        const r = classifyCondition(events, status, NOW);
        expect(r).toMatchObject({ number: i + 1, exact: true, wording: c.wording });
        expect(r.pressure).toBe(pressureOf(events, status));
      });
    });
  }

  it('a side with no events yet is "strong since morning"', () => {
    expect(classifyCondition([], 'strong', NOW)).toMatchObject({ number: 1, exact: true, phases: 0 });
  });

  it('a log that matches none of the listed shapes falls back to the condition of the same pressure, and says it is approximate', () => {
    // Shifted down with no earlier WTB, now WTB: the tool lists no such shape; the pressure is plain bearish, like "weak towards bottom".
    const events = eventsOf(['init', 'down', 'wtb']);
    const r = classifyCondition(events, 'wtb', NOW);
    expect(r).toMatchObject({ number: 1, exact: false, pressure: 'B' });
  });

  it('counts the phases and measures the current one', () => {
    const events = eventsOf(['init', 'down', 'wtt']); // phases start at 0, 1800, 3600
    const r = classifyCondition(events, 'wtt', 3600 + 150 * 60);
    expect(r.phases).toBe(3);
    expect(r.currentPhaseMinutes).toBe(150);
    expect(r.continuation).toBe(true); // 2 hours or more in one phase
    expect(classifyCondition(events, 'wtt', 3600 + 90 * 60).continuation).toBe(false);
  });

  it('ignores a blink: a weak spell shorter than the minimum phase does not change the condition or the phase count', () => {
    const blink = LTP_CONFIG.phases.minPhaseMinutes - 1;
    const base = eventsOf(['init']);
    const at = (ts: number, text: string, status: 'strong' | 'wtt') => ({ ...base[0], ts, text, status });
    // Strong, a two-minute WTT blink, back to strong, then an hour later a shift up and strong for hours.
    const events = [base[0], at(1800, 'WEAK TOWARDS TOP', 'wtt'), at(1800 + blink * 60, 'WTT TO STRONG', 'strong'), at(5400, 'Shifted from Bottom to Top', 'strong')];
    expect(classifyCondition(events, 'strong', 5400 + 4 * 3600)).toMatchObject({ number: 3, exact: true, phases: 2 });
  });

  it('a blink that changes the pressure the log gives makes the condition approximate rather than being hidden', () => {
    const blink = LTP_CONFIG.phases.minPhaseMinutes - 1;
    const base = eventsOf(['init', 'up']);
    const at = (ts: number, text: string, status: 'strong' | 'wtt') => ({ ...base[0], ts, text, status });
    const events = [...base, at(3 * 3600, 'WEAK TOWARDS TOP', 'wtt'), at(3 * 3600 + blink * 60, 'WTT TO STRONG', 'strong')];
    expect(classifyCondition(events, 'strong', 7 * 3600)).toMatchObject({ exact: false, pressure: 'B' });
  });

  it('a shift is never ignored, however short the phase that follows it', () => {
    const base = eventsOf(['init']);
    const events = [...base, { ...base[0], ts: 1000, text: 'Shifted from Top to Bottom' }, { ...base[0], ts: 1030, text: 'Shifted from Top to Bottom' }];
    expect(classifyCondition(events, 'strong', 5000)).toMatchObject({ number: 6 }); // double shifting down
  });

  it('a shift that arrives already weak (as the live tool logs it) counts as a shift followed by that weakness', () => {
    // "Shifted from Top to Bottom" with status wtt = shifted down, then weak toward top at once: shifted down and in that continuation WTT.
    const base = eventsOf(['init']);
    const events = [...base, { ...base[0], ts: 1800, text: 'Shifted from Top to Bottom', status: 'wtt' as const, second: 73000 }];
    expect(classifyCondition(events, 'wtt', 20000)).toMatchObject({ number: 3, exact: true, pressure: 'B' });
  });
});
