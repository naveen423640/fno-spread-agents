import type { Verdict } from './schemas';

export type AppliedVerdict = { lots: number; delayTo: '11:00' | null; vetoed: boolean };

// The agents can only veto, shrink or delay; this never returns more than the code-calculated lots.
export function applyAuthority(verdict: Verdict, calculatedLots: number): AppliedVerdict {
  switch (verdict.verdict) {
    case 'VETO':
      return { lots: 0, delayTo: null, vetoed: true };
    case 'DELAY':
      return { lots: calculatedLots, delayTo: '11:00', vetoed: false };
    case 'REDUCE': {
      if (calculatedLots <= 1) return { lots: calculatedLots, delayTo: null, vetoed: false };
      const requested = verdict.reduce_to_lots ?? calculatedLots - 1;
      return { lots: Math.max(1, Math.min(requested, calculatedLots - 1)), delayTo: null, vetoed: false };
    }
    default:
      return { lots: calculatedLots, delayTo: null, vetoed: false };
  }
}
