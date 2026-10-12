// Runs the whole engine over one session's snapshots and returns everything the tab shows. Pure: `now` is passed in, and only snapshots at or
// before it are read, so a stored day can be replayed exactly as it would have looked live.
import { classifyTrend, selectCoa2, type Coa2Result, type Trend } from './coa2';
import { countHits, hitLabel, scenarioLevels, type Coa1Scenario } from './coa1';
import { selectDetailed } from './coa1-detailed';
import { LTP_CONFIG, type LtpConfig } from './config';
import { banner, currentDirection, sideEvents, type Banner, type Direction, type SideEvent, type SideState } from './direction';
import { diversionCount, diversionPath, type DiversionPoint } from './diversions';
import { extensionLevels, ivMove, weakStrike, type ExtLevel, type Extensions, type ExtensionMethod } from './extensions';
import type { Levels } from './levels';
import { pressureOf } from './pressure';
import { freezeLines0920, type Lines0920 } from './lines0920';
import { detectSoc, socTarget, type SocResult } from './soc';
import { trackStrength, type LevelShift, type SideStrength } from './strength';
import { istDate, istHhmm } from './time';
import { valueAt, type Snapshot } from './types';

// An event with what the real tool's popup shows beside it: the spot and the EOR/EOS family at that moment (null: no data, 'broken': already passed).
export type Reversal = number | 'broken' | null;
export type LoggedEvent = SideEvent & { spot: number | null; reversals: { center: Reversal; plus1: Reversal; minus1: Reversal } | null };

export type AnalysisOptions = { now: number; method?: ExtensionMethod; cfg?: LtpConfig };

type Hit = { level: number | null; count: number; label: 'generally safe' | 'risk rising' | null };

export type UsableAnalysis = {
  empty: false; usable: true;
  asOf: number; date: string; underlying: string; expiry: string; spot: number; step: number;
  levels: Levels;
  strength: { support: SideStrength; resistance: SideStrength };
  method: { id: string; label: string };
  extensions: Extensions;
  coa1: { scenario: Coa1Scenario; top: ExtLevel | null; bottom: ExtLevel | null; hits: { top: Hit; bottom: Hit } };
  coa2: { callTrend: Trend | null; putTrend: Trend | null; result: Coa2Result; firstHitOfExtension: boolean };
  diversions: { count: number; bullish: DiversionPoint[]; bearish: DiversionPoint[] };
  soc: (SocResult & { target: number | null }) | null; // target: the diversion price where the confusion is expected to resolve (proxy)
  direction: { support: { events: LoggedEvent[]; current: Direction }; resistance: { events: LoggedEvent[]; current: Direction }; banner: Banner };
  lines0920: Lines0920 | null;
  events: LevelShift[];
  series: {
    spot: { ts: number; spot: number }[];
    pct: { ts: number; supportVolume: number | null; supportOi: number | null; resistanceVolume: number | null; resistanceOi: number | null }[];
    ceOiAtResistance: { ts: number; oi: number }[];
    peOiAtSupport: { ts: number; oi: number }[];
  };
  flags: string[];
};
export type UnusableAnalysis = { empty: false; usable: false; asOf: number; date: string; underlying: string; spot: number; flags: string[] };
export type SessionAnalysis = { empty: true } | UnusableAnalysis | UsableAnalysis;

export function analyzeSession(snapshots: Snapshot[], opts: AnalysisOptions): SessionAnalysis {
  const cfg = opts.cfg ?? LTP_CONFIG;
  const method = opts.method ?? ivMove;
  const upToNow = snapshots.filter((s) => s.ts <= opts.now).sort((a, b) => a.ts - b.ts);
  if (!upToNow.length) return { empty: true };
  const latest = upToNow[upToNow.length - 1];
  const date = istDate(latest.ts);
  const snaps = upToNow.filter((s) => istDate(s.ts) === date); // one session at a time

  const { perSnapshot, events } = trackStrength(snaps, cfg);
  const point = perSnapshot[perSnapshot.length - 1];
  if (!point.levels || !point.support || !point.resistance) {
    return { empty: false, usable: false, asOf: latest.ts, date, underlying: latest.underlying, spot: latest.spot, flags: ['No usable levels: the chain has no strikes on both sides of the spot, or no volume/OI data on one side.'] };
  }
  const { levels, support, resistance } = point;
  const ext = extensionLevels(latest, levels, support, resistance, method);

  // Each side's event log and direction, and the banner they make together (see direction.ts).
  const statesOf = (side: 'support' | 'resistance'): SideState[] => perSnapshot.flatMap((p) => {
    const strength = p[side];
    const level = p.levels?.[side];
    if (!strength || !level) return [];
    return [{ ts: p.ts, strike: strength.strike, status: strength.status, second: strength.status === 'strong' ? null : weakStrike(strength, level) }];
  });
  const snapAt = new Map(snaps.map((x) => [x.ts, x]));
  const lineAt = new Map(perSnapshot.map((p) => [p.ts, p.levels?.line]));
  const logged = (side: 'support' | 'resistance', list: SideEvent[]): LoggedEvent[] => list.map((e) => {
    const snap = snapAt.get(e.ts);
    const line = lineAt.get(e.ts);
    if (!snap || !line) return { ...e, spot: snap?.spot ?? null, reversals: null };
    // Puts are shown up to the line's upper strike and calls from its lower strike; beyond that the tool says Break Down / Break Out.
    const at = (k: number): Reversal => (side === 'support' ? (k <= line.high ? method.reversal(snap, k, 'PE') : 'broken') : (k >= line.low ? method.reversal(snap, k, 'CE') : 'broken'));
    return { ...e, spot: snap.spot, reversals: { center: at(e.strike), plus1: at(e.strike + snap.step), minus1: at(e.strike - snap.step) } };
  });
  const supportEvents = logged('support', sideEvents(statesOf('support')));
  const resistanceEvents = logged('resistance', sideEvents(statesOf('resistance')));
  const direction = {
    support: { events: supportEvents, current: currentDirection(supportEvents) },
    resistance: { events: resistanceEvents, current: currentDirection(resistanceEvents) },
    banner: banner(currentDirection(supportEvents), currentDirection(resistanceEvents)),
  };

  // COA 1.0, read from the Detailed Chart of Accuracy: each side's pressure class comes from its history today (see pressure.ts), and the pair of
  // classes gives the top and bottom. A side that is Strong now but just came back from a weakness or a shift therefore still counts as pressure.
  const scenario = selectDetailed(pressureOf(supportEvents, support.status), pressureOf(resistanceEvents, resistance.status), support.status, resistance.status);
  const { top, bottom } = scenarioLevels(scenario, ext);
  const spots = snaps.map((s) => s.spot);
  const hit = (lv: ExtLevel | null): Hit => { const count = countHits(spots, lv?.value ?? null, cfg.hitTolerancePoints); return { level: lv?.value ?? null, count, label: hitLabel(count) }; };
  const hits = { top: hit(top), bottom: hit(bottom) };

  // COA 2.0: CE OI at the resistance strike and PE OI at the support strike since the open.
  const ceOi = snaps.flatMap((s) => { const oi = valueAt(s, levels.resistance.strike, 'CE', 'oi'); return oi === null ? [] : [{ ts: s.ts, oi }]; });
  const peOi = snaps.flatMap((s) => { const oi = valueAt(s, levels.support.strike, 'PE', 'oi'); return oi === null ? [] : [{ ts: s.ts, oi }]; });
  const callTrend = classifyTrend(ceOi, latest.ts, cfg);
  const putTrend = classifyTrend(peOi, latest.ts, cfg);
  // The first touch of an extension level (anything other than plain EOS / EOR) is not read with COA 2.0.
  const onFirstExtensionHit = (label: string | null, lv: ExtLevel | null, h: Hit) => label !== null && label !== 'EOS' && label !== 'EOR' && lv?.value != null && Math.abs(latest.spot - lv.value) <= cfg.hitTolerancePoints && h.count <= 1;
  const firstHitOfExtension = onFirstExtensionHit(scenario.top, top, hits.top) || onFirstExtensionHit(scenario.bottom, bottom, hits.bottom);
  const result = selectCoa2(callTrend, putTrend, istHhmm(latest.ts), { firstHitOfExtension }, cfg);

  const detected = detectSoc(perSnapshot, events, cfg);
  const socWithTarget = detected ? { ...detected, target: socTarget(detected, latest, method) } : null;

  const flags: string[] = [];
  const allExt = [ext.eos, ext.eor, ...ext.eosMinus, ...ext.eorPlus];
  if (allExt.some((e) => e.value === null)) flags.push('Some reversal values are unavailable because an option LTP is missing.');

  return {
    empty: false, usable: true, asOf: latest.ts, date, underlying: latest.underlying, expiry: latest.expiry, spot: latest.spot, step: latest.step,
    levels, strength: { support, resistance }, method: { id: method.id, label: method.label }, extensions: ext,
    coa1: { scenario, top, bottom, hits },
    coa2: { callTrend, putTrend, result, firstHitOfExtension },
    diversions: { count: diversionCount(levels.support.strike, levels.resistance.strike, latest.step), bullish: diversionPath(latest, levels.support.strike, levels.resistance.strike, 'bullish', method), bearish: diversionPath(latest, levels.support.strike, levels.resistance.strike, 'bearish', method) },
    soc: socWithTarget, direction,
    lines0920: freezeLines0920(snaps, method, cfg),
    events,
    series: {
      spot: snaps.map((s) => ({ ts: s.ts, spot: s.spot })),
      pct: perSnapshot.map((p) => ({ ts: p.ts, supportVolume: p.support?.pct.volume ?? null, supportOi: p.support?.pct.oi ?? null, resistanceVolume: p.resistance?.pct.volume ?? null, resistanceOi: p.resistance?.pct.oi ?? null })),
      ceOiAtResistance: ceOi, peOiAtSupport: peOi,
    },
    flags,
  };
}
