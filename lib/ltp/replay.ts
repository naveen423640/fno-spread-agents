// Replay: run the same engine over a stored day, one row per snapshot, each row seeing only the snapshots up to its own time (as the live view would).
import { analyzeSession } from './analyze';
import { LTP_CONFIG, type LtpConfig } from './config';
import { writerBreakeven, type ExtensionMethod } from './extensions';
import type { LtpStore } from './store';
import { istHhmm } from './time';

export const REPLAY_COLUMNS = ['time', 'spot', 'support', 'resistance', 'support_status', 'resistance_status', 'support_pct_volume', 'support_pct_oi', 'resistance_pct_volume', 'resistance_pct_oi', 'coa1', 'coa2', 'soc', 'eos_proxy', 'eor_proxy'];

type Cell = string | number | null;

export function replayCsv(rows: Record<string, Cell>[], columns: string[]): string {
  const cell = (v: Cell) => (v === null || v === undefined ? '' : /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
  return `${columns.join(',')}\n${rows.map((r) => columns.map((c) => cell(r[c] ?? null)).join(',')).join('\n')}${rows.length ? '\n' : ''}`;
}

const r2 = (v: number | null) => (v === null ? null : Math.round(v * 100) / 100);

// Null when nothing is stored for that underlying and day.
export async function replayDay(store: LtpStore, underlying: string, date: string, method: ExtensionMethod = writerBreakeven, cfg: LtpConfig = LTP_CONFIG): Promise<string | null> {
  const snaps = await store.snapshotsForDay(underlying, date);
  if (!snaps.length) return null;
  const rows = snaps.map((s, i): Record<string, Cell> => {
    const a = analyzeSession(snaps.slice(0, i + 1), { now: s.ts, method, cfg });
    const base: Record<string, Cell> = { time: istHhmm(s.ts), spot: s.spot };
    if (a.empty || !a.usable) return base;
    return {
      ...base, support: a.levels.support.strike, resistance: a.levels.resistance.strike, support_status: a.strength.support.status, resistance_status: a.strength.resistance.status,
      support_pct_volume: r2(a.strength.support.pct.volume), support_pct_oi: r2(a.strength.support.pct.oi), resistance_pct_volume: r2(a.strength.resistance.pct.volume), resistance_pct_oi: r2(a.strength.resistance.pct.oi),
      coa1: a.coa1.scenario.number, coa2: a.coa2.result.status === 'ok' ? a.coa2.result.number : a.coa2.result.status, soc: a.soc?.type ?? '',
      eos_proxy: a.extensions.eos.value, eor_proxy: a.extensions.eor.value,
    };
  });
  return replayCsv(rows, REPLAY_COLUMNS);
}
