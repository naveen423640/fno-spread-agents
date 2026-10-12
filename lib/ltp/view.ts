// Pure helpers for the LTP Levels tab: which table cells to highlight, the health badge colour and the COA 2.0 window label.
import type { UsableAnalysis } from './analyze';
import { LTP_CONFIG } from './config';
import type { ChainView } from './state';
import type { ConditionInfo } from './conditions';
import { istHhmm, minutesOf } from './time';
import { signalTag } from './tug-of-war';

export type CellMark = 'max' | 'second_weak';

// Keys are `${strike}|${side}|${metric}`. Every strike shown counts, in-the-money ones too, like the engine.
// The highest value of each column gets 'max'; the second-highest gets 'second_weak' only when it is MORE than `weakPct` percent of the highest
// (the yellow box). Missing values are skipped, never read as zero.
export function highlightCells(chain: ChainView[], _line: { low: number; high: number }, weakPct: number = LTP_CONFIG.weakThresholdPct): Record<string, CellMark> {
  const marks: Record<string, CellMark> = {};
  for (const side of ['PE', 'CE'] as const) {
    for (const metric of ['volume', 'oi'] as const) {
      const ranked = chain
        .flatMap((r) => { const v = (side === 'PE' ? r.pe : r.ce)?.[metric]; return v === null || v === undefined ? [] : [{ strike: r.strike, v }]; })
        .sort((a, b) => b.v - a.v || (side === 'PE' ? b.strike - a.strike : a.strike - b.strike));
      const [top, second] = ranked;
      if (!top) continue;
      marks[`${top.strike}|${side}|${metric}`] = 'max';
      if (second && top.v > 0 && (second.v / top.v) * 100 > weakPct) marks[`${second.strike}|${side}|${metric}`] = 'second_weak';
    }
  }
  return marks;
}

export function healthBadge(ageSeconds: number | null): 'green' | 'amber' | 'red' {
  if (ageSeconds === null) return 'red';
  return ageSeconds < 120 ? 'green' : ageSeconds < 300 ? 'amber' : 'red';
}

export function windowLabel(hhmm: string): { state: 'before' | 'valid' | 'after'; text: string } {
  const { windowStart, windowEnd } = LTP_CONFIG.coa2;
  const m = minutesOf(hhmm);
  if (m < minutesOf(windowStart)) return { state: 'before', text: `COA 2.0 starts at ${windowStart}` };
  if (m > minutesOf(windowEnd)) return { state: 'after', text: `COA 2.0 window closed at ${windowEnd}` };
  return { state: 'valid', text: `COA 2.0 valid (${windowStart}–${windowEnd})` };
}

// Each cell as a percent of its column's highest value (the highest is 100). Same keys as highlightCells.
export function columnPercents(chain: ChainView[], _line: { low: number; high: number }): Record<string, number> {
  const out: Record<string, number> = {};
  for (const side of ['PE', 'CE'] as const) {
    for (const metric of ['volume', 'oi'] as const) {
      const cells = chain
        .flatMap((r) => { const v = (side === 'PE' ? r.pe : r.ce)?.[metric]; return v === null || v === undefined ? [] : [{ strike: r.strike, v }]; });
      const top = Math.max(0, ...cells.map((c) => c.v));
      if (!(top > 0)) continue;
      for (const c of cells) out[`${c.strike}|${side}|${metric}`] = (c.v / top) * 100;
    }
  }
  return out;
}

export type TradeCell = { value: number | null; broken: 'Break Down' | 'Break Out' | null };
export type TradeLevels = {
  short: { risky: TradeCell; moderate: TradeCell; maxPain: TradeCell; maxGain: TradeCell };
  long: { risky: TradeCell; moderate: TradeCell; maxPain: TradeCell; maxGain: TradeCell };
  ruledOut: { short: boolean; long: boolean };
};

// The live Risky / Moderate / Max Pain / Max Gain on each side, like the real tool's header. Max Gain reads "Break Down" (short side) or
// "Break Out" (long side) once the spot has already passed it. Blood Bath rules out longs, Bull Run rules out shorts.
export function tradeLevels(a: UsableAnalysis): TradeLevels {
  const e = a.extensions;
  const cell = (l: { value: number | null }, broken: TradeCell['broken'] = null): TradeCell => ({ value: l.value, broken: l.value !== null ? broken : null });
  const gainShort = e.eos.value !== null && a.spot < e.eos.value;
  const gainLong = e.eor.value !== null && a.spot > e.eor.value;
  const kind = a.direction.banner.kind;
  return {
    short: { risky: cell(e.riskyShort), moderate: cell(e.eor), maxPain: cell(e.eorPlus[1]), maxGain: cell(e.eos, gainShort ? 'Break Down' : null) },
    long: { risky: cell(e.riskyLong), moderate: cell(e.eos), maxPain: cell(e.eosMinus[1]), maxGain: cell(e.eor, gainLong ? 'Break Out' : null) },
    ruledOut: { short: kind === 'bull_run', long: kind === 'blood_bath' },
  };
}

// The scenario popup's title: the State of Confusion text when there is one ("Bullish SOC- 3 hours"), else the banner.
export function popupTitle(a: Pick<UsableAnalysis, 'soc' | 'direction'>, name: string): string {
  if (a.soc) return `LTP Calculator – ${a.soc.bias === 'bullish' ? 'Bullish' : 'Bearish'} SOC- ${a.soc.type.replace('h', '')} hours`;
  return `LTP Calculator – ${name} ${a.direction.banner.kind === 'mixed' ? 'SIDES DISAGREE' : `IS IN ${a.direction.banner.text.toUpperCase()}`}`;
}
// A log row's level label: the tool prints a Strong level with a trailing dash ("71700 - STRONG -").
export const logLabel = (e: { status: string; label: string }): string => (e.status === 'strong' ? `${e.label} -` : e.label);
// HH:MM:SS in IST. Rows are recorded once a minute, so the seconds are :00.
export const logTime = (ts: number): string => `${istHhmm(ts)}:00`;

const PRESSURE_WORD: Record<string, string> = { S: 'stable strong', B: 'bearish', U: 'bullish', HB: 'highly bearish', HU: 'highly bullish' };
export const phaseAge = (minutes: number): string => (minutes < 60 ? `${minutes}m` : minutes % 60 === 0 ? `${minutes / 60}h` : `${Math.floor(minutes / 60)}h ${minutes % 60}m`);
// One line for a side: its condition number (S for support, R for resistance), the pressure, the phases so far and how long the current one has lasted.
export function conditionSummary(prefix: 'S' | 'R', c: ConditionInfo): string {
  const phases = `${c.phases} phase${c.phases === 1 ? '' : 's'}`;
  const age = `${phaseAge(c.currentPhaseMinutes)} in this phase${c.continuation ? ' (continuation)' : ''}`;
  return `${prefix}${c.number}${c.exact ? '' : '~'}: ${PRESSURE_WORD[c.pressure]} · ${phases} · ${age}${c.exact ? '' : ' · closest listed condition'}`;
}
// The short headline of the current signal, "6(S5/R1) S-Bearish R-Bullish(H)", with the State of Confusion when there is one.
export function scenarioHeadline(a: Pick<UsableAnalysis, 'coa1' | 'soc'>): string {
  const soc = a.soc ? ` · ${a.soc.bias === 'bullish' ? 'Bullish' : 'Bearish'} SOC ${a.soc.type}` : '';
  return `${signalTag(a)}${soc}`;
}
