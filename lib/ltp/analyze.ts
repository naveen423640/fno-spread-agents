// Runs the whole engine over one session's snapshots and returns everything the tab shows. Pure: `now` is passed in, and only snapshots at or
// before it are read, so a stored day can be replayed exactly as it would have looked live.
import { classifyTrend, selectCoa2, type Coa2Result, type Trend } from './coa2';
import { countHits, hitLabel, scenarioLevels, selectCoa1, type Coa1Scenario } from './coa1';
import { LTP_CONFIG, type LtpConfig } from './config';
import { diversionCount, diversionPath, type DiversionPoint } from './diversions';
import { extensionLevels, writerBreakeven, type ExtLevel, type Extensions, type ExtensionMethod } from './extensions';
import type { Levels } from './levels';
import { freezeLines0920, type Lines0920 } from './lines0920';
import { detectSoc, type SocResult } from './soc';
import { trackStrength, type LevelShift, type SideStrength } from './strength';
import { istDate, istHhmm } from './time';
import { valueAt, type Snapshot } from './types';

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
  soc: SocResult | null;
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
  const method = opts.method ?? writerBreakeven;
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

  // COA 1.0 and its hit counter (spot touches of each reversal level today).
  const scenario = selectCoa1(support.status, resistance.status);
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

  const flags: string[] = [];
  const allExt = [ext.eos, ext.eor, ...ext.eosMinus, ...ext.eorPlus];
  if (allExt.some((e) => e.value === null)) flags.push('Some reversal values are unavailable because an option LTP is missing.');

  return {
    empty: false, usable: true, asOf: latest.ts, date, underlying: latest.underlying, expiry: latest.expiry, spot: latest.spot, step: latest.step,
    levels, strength: { support, resistance }, method: { id: method.id, label: method.label }, extensions: ext,
    coa1: { scenario, top, bottom, hits },
    coa2: { callTrend, putTrend, result, firstHitOfExtension },
    diversions: { count: diversionCount(levels.support.strike, levels.resistance.strike, latest.step), bullish: diversionPath(latest, levels.support.strike, levels.resistance.strike, 'bullish', method), bearish: diversionPath(latest, levels.support.strike, levels.resistance.strike, 'bearish', method) },
    soc: detectSoc(perSnapshot, events, cfg),
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
