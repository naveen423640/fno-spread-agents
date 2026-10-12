import type { UsableAnalysis } from '@/lib/ltp/analyze';
import { scenarioLevels } from '@/lib/ltp/coa1';
import { selectDetailed, type Pressure } from '@/lib/ltp/coa1-detailed';
import type { ExtLevel, Extensions } from '@/lib/ltp/extensions';
import type { Lines0920, TradeLines } from '@/lib/ltp/lines0920';
import type { Status } from '@/lib/ltp/types';
import { istTs } from '@/lib/ltp/time';

// A hand-made engine state for rule tests. Extension values are fixed so every expectation can be read off this file:
// EOR-1 24150, EOR 24200, EOR+1 24250, EOR+2 24300 | EOS+1 24060, EOS 24010, EOS-1 23960, EOS-2 23910 | WTB+1 23985, WTT-1 24175.
export const EXT = { eorMinus1: 24150, eor: 24200, eorPlus1: 24250, eorPlus2: 24300, eosPlus1: 24060, eos: 24010, eosMinus1: 23960, eosMinus2: 23910, wtbPlus1: 23985, wttMinus1: 24175 };

const ext = (label: string, value: number | null, strike = 0): ExtLevel => ({ label: `${label} (proxy: test)`, strike, value, method: 'test', isProxy: true });
export type FakeOpts = {
  date?: string; hhmm?: string; underlying?: string; spot?: number; spots?: number[];
  support?: Status; resistance?: Status; pressure?: { support: Pressure; resistance: Pressure }; soc?: UsableAnalysis['soc']; coa2?: Partial<UsableAnalysis['coa2']>;
  lines?: Lines0920 | null; missing?: (keyof typeof EXT)[]; supportDirection?: 'bullish' | 'bearish' | 'neutral'; resistanceDirection?: 'bullish' | 'bearish' | 'neutral';
};

export function fakeAnalysis(o: FakeOpts = {}): UsableAnalysis {
  const date = o.date ?? '2026-10-12';
  const spot = o.spot ?? 24012;
  const v = (k: keyof typeof EXT) => (o.missing?.includes(k) ? null : EXT[k]);
  const e: Extensions = {
    eos: ext('EOS', v('eos')), eor: ext('EOR', v('eor')), eosPlus1: ext('EOS+1', v('eosPlus1')), eorMinus1: ext('EOR-1', v('eorMinus1')),
    riskyShort: ext('EOR-1', v('eorMinus1')), riskyLong: ext('EOS+1', v('eosPlus1')),
    eosMinus: [ext('EOS-1', v('eosMinus1')), ext('EOS-2', v('eosMinus2'))], eorPlus: [ext('EOR+1', v('eorPlus1')), ext('EOR+2', v('eorPlus2'))],
    wtbPlus1: ext('WTB+1', v('wtbPlus1')), wttMinus1: ext('WTT-1', v('wttMinus1')),
  };
  // A side that is weak now is B (WTB) or U (WTT); Strong is S. The Detailed Chart of Accuracy then gives the levels.
  const pressure = (st: Status): Pressure => (st === 'wtb' ? 'B' : st === 'wtt' ? 'U' : 'S');
  const pr = o.pressure ?? { support: pressure(o.support ?? 'strong'), resistance: pressure(o.resistance ?? 'strong') };
  const scenario = selectDetailed(pr.support, pr.resistance, o.support ?? 'strong', o.resistance ?? 'strong');
  const { top, bottom } = scenarioLevels(scenario, e);
  const dir = (d?: 'bullish' | 'bearish' | 'neutral') => ({ events: [], current: d ?? 'neutral' });
  const spots = o.spots ?? [spot + 80, spot];
  return {
    empty: false, usable: true, asOf: istTs(date, o.hhmm ?? '10:42'), date, underlying: o.underlying ?? 'NSE:NIFTY50-INDEX', expiry: '2026-10-13', spot, step: 50,
    levels: { line: { low: 24000, high: 24050, exact: false }, support: { strike: 24000, decidedBy: 'volume+oi', byVolume: null, byOi: null }, resistance: { strike: 24250, decidedBy: 'volume+oi', byVolume: null, byOi: null } },
    strength: { support: { strike: 24000, status: o.support ?? 'strong', pct: { volume: 50, oi: 50 }, byMetric: {} as never }, resistance: { strike: 24250, status: o.resistance ?? 'strong', pct: { volume: 50, oi: 50 }, byMetric: {} as never } },
    method: { id: 'test', label: 'test' }, extensions: e,
    coa1: { label: `${scenario.number}(S1/R1)`, conditions: { support: { number: 1, exact: true, wording: 'STRONG SINCE MORNING', pressure: pressure(o.support ?? 'strong'), phases: 1, currentPhaseMinutes: 0, continuation: false }, resistance: { number: 1, exact: true, wording: 'STRONG SINCE MORNING', pressure: pressure(o.resistance ?? 'strong'), phases: 1, currentPhaseMinutes: 0, continuation: false } }, scenario, pressure: pr, top, bottom, hits: { top: { level: top?.value ?? null, count: 0, label: null }, bottom: { level: bottom?.value ?? null, count: 0, label: null } } },
    coa2: { atmStrike: 24050, callTrend: 'stable', putTrend: 'increasing', result: { status: 'ok', number: 4, outcome: 'Reversal at support; resistance may break out' }, firstHitOfExtension: false, ...o.coa2 },
    diversions: { count: 5, bullish: [], bearish: [] }, pctTrend: { support: null, resistance: null }, soc: o.soc ?? null,
    direction: { support: dir(o.supportDirection), resistance: dir(o.resistanceDirection), banner: { kind: 'mixed', text: 'Mixed' } },
    lines0920: o.lines ?? null, events: [], flags: [],
    series: { spot: spots.map((s, i) => ({ ts: istTs(date, '10:00') + i * 60, spot: s })), pct: [], ceOiAtResistance: [], peOiAtSupport: [] },
  } as unknown as UsableAnalysis;
}

export const tradeLines = (over: Partial<Record<'risky' | 'moderate' | 'maxPain' | 'maxGain', number>> = {}, side: 'short' | 'long' = 'short'): TradeLines => {
  const base = side === 'short' ? { risky: 24150, moderate: 24200, maxPain: 24300, maxGain: 24010 } : { risky: 24060, moderate: 24010, maxPain: 23910, maxGain: 24200 };
  const lvl = (value: number): ExtLevel => ext('x', value);
  const val = { ...base, ...over };
  return { risky: lvl(val.risky), moderate: lvl(val.moderate), maxPain: lvl(val.maxPain), maxGain: lvl(val.maxGain), riskPoints: { risky: Math.abs(val.maxPain - val.risky), moderate: Math.abs(val.maxPain - val.moderate) }, available: true };
};
export const fakeLines = (): Lines0920 => ({ date: '2026-10-12', snapshotTs: istTs('2026-10-12', '09:20'), delaySeconds: 0, method: 'test', eorMinus1: ext('EOR-1', 24150), eor: ext('EOR', 24200), eorPlus1: ext('EOR+1', 24250), eorPlus2: ext('EOR+2', 24300), eosPlus1: ext('EOS+1', 24060), eos: ext('EOS', 24010), eosMinus1: ext('EOS-1', 23960), eosMinus2: ext('EOS-2', 23910), short: tradeLines({}, 'short'), long: tradeLines({}, 'long') });
