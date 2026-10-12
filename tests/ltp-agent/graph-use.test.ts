import { describe, expect, it } from 'vitest';

import { graphTrace, rulebookText } from '@/lib/ltp-agent/graph-use';
import { fakeAnalysis } from '../support/ltp-analysis';

describe('graphTrace: which part of the knowledge graph a decision rests on', () => {
  it('names the pressure pair, the top and bottom the graph gives, and that the live scenario agrees', () => {
    const t = graphTrace(fakeAnalysis());
    expect(t).toMatchObject({ pair: 'S|S', supportPressure: 'S', resistancePressure: 'S', top: 'EOR', bottom: 'EOS', outcome: null, consistent: true });
    expect(t.rules).toContain('top-bottom-from-pairs');
  });
  it('a weak side with matching pressure gives the variant, and the trace still agrees with the live scenario', () => {
    const t = graphTrace(fakeAnalysis({ support: 'wtb', resistance: 'wtt' })); // B|U, both weak now
    expect(t).toMatchObject({ pair: 'B|U', top: 'WTT-1', bottom: 'WTB+1', consistent: true });
    expect(t.rules).toContain('wtt1-wtb1-substitution');
  });
  it('highly bearish pressure leads to Blood Bath and brings in the owner\'s risky rule, as information only', () => {
    const a = fakeAnalysis();
    a.coa1.pressure = { support: 'HB', resistance: 'S' };
    a.coa1.scenario = { ...a.coa1.scenario, bottom: null };
    const t = graphTrace(a);
    expect(t).toMatchObject({ pair: 'HB|S', top: 'EOR', bottom: null, outcome: 'blood_bath', consistent: true });
    expect(t.rules).toContain('risky-high-pressure');
    expect(t.ownerRuleNotUsedForTrading).toBe(true);
  });
  it('the rare scenario is named and the do-not-trade rule listed', () => {
    const a = fakeAnalysis();
    a.coa1.pressure = { support: 'HB', resistance: 'HU' };
    a.coa1.scenario = { ...a.coa1.scenario, top: null, bottom: null, tradable: false };
    const t = graphTrace(a);
    expect(t).toMatchObject({ pair: 'HB|HU', outcome: 'rare', consistent: true });
    expect(t.rules).toContain('rare-do-not-trade');
  });
  it('flags a disagreement when the live scenario and the graph differ', () => {
    const a = fakeAnalysis();
    a.coa1.scenario = { ...a.coa1.scenario, top: 'EOR+1' };
    expect(graphTrace(a).consistent).toBe(false);
  });
});

describe('rulebookText: the graph as plain text for the reviewing and proposing model', () => {
  const text = rulebookText();
  it('lists the pressure classes, the outcomes of every pair, the rules with their sources, and the open questions', () => {
    expect(text).toContain('Highly bearish');
    expect(text).toContain('Blood Bath');
    expect(text).toContain('S|HB');
    expect(text).toMatch(/\[user\].*risky/i);
    expect(text).toMatch(/\[course\]/);
    expect(text).toMatch(/Open questions/);
  });
  it('tells the model not to invent tiers or rules beyond it, and stays short enough for a prompt', () => {
    expect(text).toMatch(/do not invent/i);
    expect(text.length).toBeLessThan(7000);
  });
});
