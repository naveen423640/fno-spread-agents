import { describe, expect, it } from 'vitest';

import { applyAuthority } from './clamp';
import type { Verdict } from './schemas';

const base = { reasons: [{ claim: 'c', type: 'interpretation' as const, source_ids: [] }], missing_evidence: [], confidence_note: 'n' };
const verdict = (v: Partial<Verdict> & Pick<Verdict, 'verdict'>): Verdict => ({ ...base, ...v });

describe('applyAuthority', () => {
  it('APPROVE keeps the calculated lots', () => {
    expect(applyAuthority(verdict({ verdict: 'APPROVE' }), 4)).toEqual({ lots: 4, delayTo: null, vetoed: false });
  });

  it('REDUCE can shrink but never reach or exceed the calculated lots', () => {
    expect(applyAuthority(verdict({ verdict: 'REDUCE', reduce_to_lots: 9 }), 4).lots).toBe(3);
    expect(applyAuthority(verdict({ verdict: 'REDUCE', reduce_to_lots: 2 }), 4).lots).toBe(2);
    expect(applyAuthority(verdict({ verdict: 'REDUCE', reduce_to_lots: 1 }), 4).lots).toBe(1);
  });

  it('REDUCE with a single calculated lot leaves it unchanged', () => {
    expect(applyAuthority(verdict({ verdict: 'REDUCE', reduce_to_lots: 1 }), 1)).toEqual({ lots: 1, delayTo: null, vetoed: false });
  });

  it('DELAY keeps lots and moves to 11:00', () => {
    expect(applyAuthority(verdict({ verdict: 'DELAY', delay_to: '11:00' }), 3)).toEqual({ lots: 3, delayTo: '11:00', vetoed: false });
  });

  it('VETO means zero lots', () => {
    expect(applyAuthority(verdict({ verdict: 'VETO' }), 3)).toEqual({ lots: 0, delayTo: null, vetoed: true });
  });

  it('never returns more lots than calculated, for any verdict and any size', () => {
    for (let calculated = 1; calculated <= 20; calculated += 1) {
      for (const reduceTo of [1, 2, 5, 50]) {
        for (const v of [verdict({ verdict: 'APPROVE' }), verdict({ verdict: 'REDUCE', reduce_to_lots: reduceTo }), verdict({ verdict: 'DELAY', delay_to: '11:00' }), verdict({ verdict: 'VETO' })]) {
          const applied = applyAuthority(v, calculated);
          expect(applied.lots).toBeLessThanOrEqual(calculated);
          expect(applied.lots).toBeGreaterThanOrEqual(0);
        }
      }
    }
  });
});
