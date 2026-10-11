import type { D1Like } from '../../agents/store';
import { HOLIDAYS } from '../../screener/holidays';
import { istDayOf, type C5 } from '../core';
import type { DataProvider } from '../provider';
import { UNRELIABLE_GAP_PCT, VOLUME_SPIKE_MULTIPLE } from '../service';
import type { UniverseEntry } from '../universe';

export type SymbolMonth = { entry: UniverseEntry; month: string; days: Map<string, C5[]> };
export type SkippedMonth = { symbol: string; month: string; reason: string };

const addDays = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const lastOfMonth = (month: string) => new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).toISOString().slice(0, 10);

export function monthsBetween(from: string, to: string): string[] {
  const out: string[] = [];
  for (let m = from.slice(0, 7); m <= to.slice(0, 7); m = addDays(lastOfMonth(m), 1).slice(0, 7)) out.push(m);
  return out;
}

// The first weekday of the month that is not a listed holiday. The holiday list in the repo is marked unverified, so this is a check on
// the data, not an authority: a month whose data opens later than this is treated as incomplete, because the VWAP anchor would be wrong.
export function expectedFirstSession(month: string): string {
  let d = `${month}-01`;
  for (;;) { const wd = new Date(`${d}T00:00:00Z`).getUTCDay(); if (wd !== 0 && wd !== 6 && !HOLIDAYS.has(d)) return d; d = addDays(d, 1); }
}

// A split or bonus inside the month would corrupt the anchored VWAP: a one-day gap above 20% with no volume spike marks the month unusable.
export function corporateActionIn(days: Map<string, C5[]>): string | null {
  let previousClose: number | null = null;
  const volumes: number[] = [];
  for (const day of [...days.keys()].sort()) {
    const candles = days.get(day)!;
    const volume = candles.reduce((a, c) => a + c.v, 0);
    if (previousClose !== null) {
      const gap = (candles[0].o / previousClose - 1) * 100;
      const avg = volumes.length ? volumes.reduce((a, b) => a + b, 0) / volumes.length : null;
      if (Math.abs(gap) > UNRELIABLE_GAP_PCT && (avg === null || volume < VOLUME_SPIKE_MULTIPLE * avg)) return `${day}: ${gap.toFixed(0)}% gap with no volume spike (possible split or bonus)`;
    }
    previousClose = candles[candles.length - 1].c;
    volumes.push(volume);
  }
  return null;
}

export function groupDays(candles: C5[]): Map<string, C5[]> {
  const out = new Map<string, C5[]>();
  for (const c of candles) { const d = istDayOf(c.t); out.set(d, [...(out.get(d) ?? []), c]); }
  for (const [d, list] of out) out.set(d, list.sort((a, b) => a.t - b.t));
  return out;
}

// Loads whole calendar months (the VWAP anchors at month start) for each symbol and drops the months that cannot be trusted.
export async function loadHistory(deps: { provider: DataProvider; entries: UniverseEntry[]; from: string; to: string; concurrency?: number; onProgress?: (done: number, total: number) => void }): Promise<{ data: SymbolMonth[]; skipped: SkippedMonth[]; loginRequired: boolean; errors: string[] }> {
  const months = monthsBetween(deps.from, deps.to);
  const jobs = deps.entries.flatMap((entry) => months.map((month) => ({ entry, month })));
  const data: SymbolMonth[] = [];
  const skipped: SkippedMonth[] = [];
  const errors: string[] = [];
  let next = 0, done = 0, loginRequired = false;
  const worker = async () => {
    while (!loginRequired) {
      const index = next++;
      if (index >= jobs.length) return;
      const { entry, month } = jobs[index];
      const end = deps.to < lastOfMonth(month) ? deps.to : lastOfMonth(month);
      const result = await deps.provider.candles5m(entry.symbol, `${month}-01`, end);
      if (!result.ok) {
        if (result.code === 'LOGIN_REQUIRED') { loginRequired = true; return; }
        skipped.push({ symbol: entry.ticker, month, reason: `data error: ${result.message}` });
        if (errors.length < 5) errors.push(`${entry.ticker} ${month}: ${result.message}`);
      } else {
        const days = groupDays(result.value);
        const first = [...days.keys()].sort()[0];
        const expected = expectedFirstSession(month);
        const action = days.size ? corporateActionIn(days) : null;
        if (!days.size) skipped.push({ symbol: entry.ticker, month, reason: 'no candles' });
        else if (first > expected) skipped.push({ symbol: entry.ticker, month, reason: `history starts ${first} but the month opens ${expected}, so the anchored VWAP would be wrong` });
        else if (action) skipped.push({ symbol: entry.ticker, month, reason: action });
        else data.push({ entry, month, days });
      }
      done += 1;
      deps.onProgress?.(done, jobs.length);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, deps.concurrency ?? 6) }, worker));
  return { data, skipped, loginRequired, errors };
}

// Wraps a provider with a per-symbol-month cache so a re-run does not fetch again. Today's partial session is never cached.
export function createCachingProvider(inner: DataProvider, db: D1Like, todayIso: string): DataProvider {
  return {
    name: `${inner.name}+cache`,
    async candles5m(symbol, fromDay, toDay) {
      const month = fromDay.slice(0, 7);
      if (fromDay !== `${month}-01` || toDay.slice(0, 7) !== month) return inner.candles5m(symbol, fromDay, toDay); // only month-aligned requests are cached
      const cached = await db.prepare('SELECT through, candles_json FROM vwap_m5_month WHERE symbol = ? AND month = ?').bind(symbol, month).first<{ through: string; candles_json: string }>();
      let candles: C5[] = cached ? (JSON.parse(cached.candles_json) as number[][]).map(([t, o, h, l, c, v]) => ({ t, o, h, l, c, v })) : [];
      const through = cached?.through ?? addDays(`${month}-01`, -1);
      if (through < toDay) {
        const fetchedFrom = addDays(through, 1);
        const result = await inner.candles5m(symbol, fetchedFrom, toDay);
        if (!result.ok) return result;
        candles = [...candles, ...result.value].filter((c, i, all) => all.findIndex((x) => x.t === c.t) === i).sort((a, b) => a.t - b.t);
        const stable = candles.filter((c) => istDayOf(c.t) < todayIso);
        const safeThrough = toDay < todayIso ? toDay : addDays(todayIso, -1);
        if (safeThrough >= fromDay) await db.prepare('INSERT OR REPLACE INTO vwap_m5_month (symbol, month, through, candles_json) VALUES (?, ?, ?, ?)').bind(symbol, month, safeThrough, JSON.stringify(stable.map((c) => [c.t, c.o, c.h, c.l, c.c, c.v]))).run();
        return { ok: true as const, value: candles };
      }
      return { ok: true as const, value: candles.filter((c) => istDayOf(c.t) <= toDay) };
    },
  };
}
