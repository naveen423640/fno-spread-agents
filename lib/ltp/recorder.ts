// B: the minute recorder. One call stores one snapshot per underlying, stamped with the minute it belongs to, so repeating a minute adds
// nothing. A failed fetch becomes a row in recorder_gaps with its reason; nothing is filled in, interpolated or copied from an earlier minute.
import { LTP_CONFIG } from './config';
import { parseChain } from './chain';
import type { LtpStore } from './store';
import { istDate, istTs } from './time';

export const UNDERLYINGS = ['NSE:NIFTY50-INDEX', 'NSE:NIFTYBANK-INDEX', 'BSE:SENSEX-INDEX'];

// What the recorder needs from a broker: the raw chain, or an explicit failure with a code and a message.
export type ChainSource = { optionChain(underlying: string, strikecount?: number): Promise<{ ok: true; value: unknown } | { ok: false; code: string; message: string }> };

// A trading day (Monday to Friday, not a listed holiday) and a time from 09:15:00 to 15:30:00 IST, both ends included.
export function isRecordingMinute(ts: number, holidays: ReadonlySet<string>): boolean {
  const date = istDate(ts);
  const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
  if (weekday === 0 || weekday === 6 || holidays.has(date)) return false;
  return ts >= istTs(date, LTP_CONFIG.recorder.start.slice(0, 5)) && ts <= istTs(date, LTP_CONFIG.recorder.end.slice(0, 5));
}

export type RecordDeps = { adapter: ChainSource; store: LtpStore; now: () => Date; underlyings: string[]; strikecount: number; holidays: ReadonlySet<string>; force?: boolean };
export type RecordResult = { underlying: string; inserted: number; gap?: string; skipped?: 'already_recorded'; warnings: string[]; missing: string[] };
export type RecordSummary = { minuteTs: number; skipped?: 'not_recording_minute'; results: RecordResult[] };

export async function recordOnce(deps: RecordDeps): Promise<RecordSummary> {
  const minuteTs = Math.floor(deps.now().getTime() / 60_000) * 60;
  const inWindow = isRecordingMinute(minuteTs, deps.holidays);
  if (!inWindow && !deps.force) return { minuteTs, skipped: 'not_recording_minute', results: [] };

  const results: RecordResult[] = [];
  for (const underlying of deps.underlyings) {
    const result: RecordResult = { underlying, inserted: 0, warnings: [], missing: [] };
    // A gap is a missed minute, so it is only logged inside the window; a forced test run outside it is not a miss.
    const gap = async (reason: string, detail: string) => { result.gap = reason; if (inWindow) await deps.store.addGap({ underlying, minuteTs, reason, detail }); };
    try {
      const last = await deps.store.lastSnapshotTs(underlying);
      if (last !== null && last >= minuteTs) { result.skipped = 'already_recorded'; results.push(result); continue; }
      const started = deps.now().getTime();
      const response = await deps.adapter.optionChain(underlying, deps.strikecount);
      const finished = deps.now().getTime();
      if (!response.ok) { await gap(response.code === 'LOGIN_REQUIRED' ? 'login_required' : 'upstream', response.message); results.push(result); continue; }
      const parsed = parseChain(response.value, { underlying, snapshotTs: minuteTs, latencyMs: finished - started });
      if (!parsed.ok) { await gap(parsed.reason, parsed.message); results.push(result); continue; }
      result.warnings = parsed.warnings;
      result.missing = parsed.missing;
      result.inserted = (await deps.store.insertSnapshot(parsed.snapshot)).inserted;
    } catch {
      // Fixed text on purpose: nothing from an exception (which can carry request details) is stored or returned.
      await gap('upstream', 'The recorder hit an unexpected error for this minute.').catch(() => undefined);
    }
    results.push(result);
  }
  return { minuteTs, results };
}

export type Health = {
  lastSuccessTs: number | null;
  perUnderlying: Record<string, { lastTs: number | null }>;
  snapshotsToday: Record<string, number>;
  gapsToday: number;
  badge: 'green' | 'amber' | 'red';
  recordingNow: boolean;
};

// Green when the last snapshot is under 2 minutes old, amber under 5, red otherwise (or when nothing has been recorded).
export async function health(store: LtpStore, nowTs: number, underlyings: string[], holidays: ReadonlySet<string> = new Set()): Promise<Health> {
  const today = istDate(nowTs);
  const perUnderlying: Health['perUnderlying'] = {};
  const snapshotsToday: Record<string, number> = {};
  for (const u of underlyings) {
    perUnderlying[u] = { lastTs: await store.lastSnapshotTs(u) };
    snapshotsToday[u] = await store.countForDay(u, today);
  }
  const lasts = Object.values(perUnderlying).map((p) => p.lastTs).filter((t): t is number => t !== null);
  const lastSuccessTs = lasts.length ? Math.max(...lasts) : null;
  const age = lastSuccessTs === null ? Infinity : nowTs - lastSuccessTs;
  return {
    lastSuccessTs, perUnderlying, snapshotsToday, gapsToday: (await store.gapsForDay(today)).length,
    badge: age < 120 ? 'green' : age < 300 ? 'amber' : 'red', recordingNow: isRecordingMinute(nowTs, holidays),
  };
}
