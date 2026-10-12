// Names a side's history as one of the numbered conditions of the Detailed Chart of Accuracy practice tool (13 for a strong side, 5 for a weak side;
// docs/ltp-coa-verification.md, section 4). The side's log is first turned into phases: a shift always starts a phase, and a weak or strong spell
// shorter than the minimum is a blink and is dropped. The shapes below are the ones the tool lists; any other history is given the listed condition of
// the same pressure and marked approximate. Pure.
import { HISTORY_CONDITIONS } from './coa-histories';
import { LTP_CONFIG, type LtpConfig } from './config';
import type { SideEvent } from './direction';
import { kindOfEvent, pressureOf, type EventKind, type Pressure } from './pressure';
import type { Status } from './types';

export type ConditionInfo = {
  number: number; // 1-based, in the tool's list order for this status
  exact: boolean; // false: the history is not one of the listed shapes, so the number is the listed condition of the same pressure
  wording: string; // the tool's wording
  pressure: Pressure;
  phases: number; // phases in the day so far, blinks ignored
  currentPhaseMinutes: number;
  continuation: boolean; // the current phase has lasted at least the continuation time (SOC is judged separately)
};

type Item = { kind: EventKind; ts: number; second: number | null };
const isShift = (k: EventKind) => k === 'up' || k === 'down';
const isWeak = (k: EventKind) => k === 'wtt' || k === 'wtb';
const isFrom = (k: EventKind) => k === 'fromWtt' || k === 'fromWtb';

// Events to items; a shift that arrives already weak is the shift followed by that weakness at the same moment.
function itemsOf(events: SideEvent[]): Item[] {
  const items: Item[] = [];
  for (const e of [...events].sort((a, b) => a.ts - b.ts)) {
    const kind = kindOfEvent(e);
    items.push({ kind, ts: e.ts, second: e.second });
    if (isShift(kind) && (e.status === 'wtt' || e.status === 'wtb')) items.push({ kind: e.status, ts: e.ts, second: e.second });
  }
  return items;
}

// Drops the blinks: groups of non-shift items at one moment that last less than the minimum, except the current phase. When a drop leaves two equal
// weak items side by side they were one weakness, so the second is removed.
function withoutBlinks(items: Item[], now: number, cfg: LtpConfig): Item[] {
  const groups: Item[][] = [];
  for (const it of items) { const g = groups[groups.length - 1]; if (g && g[0].ts === it.ts) g.push(it); else groups.push([it]); }
  const minSeconds = cfg.phases.minPhaseMinutes * 60;
  const kept: Item[] = [];
  let dropped = false;
  groups.forEach((g, i) => {
    const end = i + 1 < groups.length ? groups[i + 1][0].ts : now;
    const blink = i + 1 < groups.length && end - g[0].ts < minSeconds && !g.some((x) => isShift(x.kind));
    if (blink) { dropped = true; return; }
    const prev = kept[kept.length - 1];
    // The end of a dropped blink (a weakness that turned strong again at once) goes with it.
    if (dropped && g.length === 1 && isFrom(g[0].kind) && (!prev || !isWeak(prev.kind))) { dropped = false; return; }
    if (dropped && prev && g.length === 1 && g[0].kind === prev.kind && g[0].second === prev.second) { dropped = false; return; }
    dropped = false;
    kept.push(...g);
  });
  return kept;
}

type Match = { index: number; exact: boolean };

function strongNow(K: EventKind[]): Match | null {
  const shifts = K.flatMap((k, i) => (isShift(k) ? [i] : []));
  if (!shifts.length) {
    const weak = K.filter(isWeak);
    if (!weak.length) return { index: 0, exact: true };
    const first = K[0];
    if (isWeak(first) && K[K.length - 1] && isFrom(K[K.length - 1])) return { index: first === 'wtb' ? 3 : 4, exact: K.length === 2 };
    return null;
  }
  const last = shifts[shifts.length - 1];
  const prev = shifts.length > 1 ? shifts[shifts.length - 2] : null;
  const after = K.slice(last + 1);
  if (prev === null) {
    if (!after.length) return { index: K[last] === 'down' ? 1 : 2, exact: true };
    const toward = K[last] === 'down' ? 'wtt' : 'wtb'; // after a shift down the continuing weakness is WTT, after a shift up it is WTB
    const places = after.filter((k) => k === toward).length;
    if (places >= 1 && after.every((k) => k === toward || isFrom(k)) && isFrom(after[after.length - 1])) return { index: K[last] === 'down' ? 9 : 12, exact: places >= 2 };
    return null;
  }
  if (K[prev] === K[last]) return { index: K[last] === 'down' ? 5 : 6, exact: true };
  const before = K[last - 1];
  if (K[prev] === 'down') return { index: before === 'wtt' ? 8 : 7, exact: true };
  return { index: before === 'wtb' ? 11 : 10, exact: true };
}

function weakNow(K: EventKind[], weak: 'wtb' | 'wtt'): Match | null {
  const shifts = K.flatMap((k, i) => (isShift(k) ? [i] : []));
  if (!shifts.length) return { index: 0, exact: true };
  const last = shifts[shifts.length - 1];
  const same = weak === 'wtb' ? 'down' : 'up'; // the shift that points the way of this weakness
  if (K[last] === same) return K[last - 1] === weak ? { index: 1, exact: true } : null;
  const after = K.slice(last + 1);
  if (after.some(isFrom)) return { index: 3, exact: true };
  return { index: after.filter((k) => k === weak).length >= 2 ? 4 : 2, exact: true };
}

export function classifyCondition(events: SideEvent[], status: Status, now: number, cfg: LtpConfig = LTP_CONFIG): ConditionInfo {
  const kept = withoutBlinks(itemsOf(events), now, cfg);
  const K = kept.map((x) => x.kind);
  const pressure = pressureOf(events, status);
  const list = HISTORY_CONDITIONS[status];
  let match = events.length === 0 ? { index: 0, exact: true } : status === 'strong' ? strongNow(K) : weakNow(K, status);
  // A listed shape whose canonical pressure is not the one the log gives is not an exact match.
  const canonical = (i: number) => pressureOf(eventsOfLog(list[i].log), status);
  if (match && canonical(match.index) !== pressure) match = { index: match.index, exact: false };
  if (!match || !match.exact) {
    const sameP = list.findIndex((_c, i) => canonical(i) === pressure);
    match = { index: match && canonical(match.index) === pressure ? match.index : sameP >= 0 ? sameP : 0, exact: false };
  }
  const starts = [...new Set(kept.map((x) => x.ts))];
  const lastStart = starts[starts.length - 1];
  const currentPhaseMinutes = lastStart === undefined ? 0 : Math.max(0, Math.round((now - lastStart) / 60));
  return {
    number: match.index + 1, exact: match.exact, wording: list[match.index].wording, pressure, phases: starts.length,
    currentPhaseMinutes, continuation: starts.length > 0 && currentPhaseMinutes >= cfg.phases.continuationMinutes,
  };
}

// The canonical logs of the listed conditions, as events (kinds to the words sideEvents() writes).
import { eventsOf as eventsOfLog } from './coa-histories';
