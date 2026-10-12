// C6 COA 2.0: the OI-trend scenarios at the resistance (call OI) and support (put OI) strikes. The stable band and the lookback are my own
// parameters (the method gives no numbers) and live in the config. Pure.
import { LTP_CONFIG, type LtpConfig } from './config';
import { minutesOf } from './time';

export type Trend = 'increasing' | 'decreasing' | 'stable';

// Percent change of OI from the first point inside the lookback window to the last point at or before `now`.
export function classifyTrend(series: { ts: number; oi: number }[], now: number, cfg: LtpConfig = LTP_CONFIG): Trend | null {
  const from = now - cfg.coa2.lookbackMin * 60;
  const inside = series.filter((p) => p.ts >= from && p.ts <= now).sort((a, b) => a.ts - b.ts);
  if (inside.length < 2) return null;
  const first = inside[0].oi;
  const last = inside[inside.length - 1].oi;
  if (!(first > 0)) return null;
  const change = ((last - first) / first) * 100;
  return Math.abs(change) <= cfg.coa2.stableBandPct ? 'stable' : change > 0 ? 'increasing' : 'decreasing';
}

const row = (number: number, outcome: string) => ({ number, outcome });
export const COA2_TABLE: Record<`${Trend}|${Trend}`, { number: number; outcome: string }> = {
  'increasing|increasing': row(1, 'Reversal at both; consolidation'),
  'increasing|stable': row(2, 'Reversal at resistance; support may break'),
  'increasing|decreasing': row(3, 'Reversal at resistance; support will break'),
  'stable|increasing': row(4, 'Reversal at support; resistance may break out'),
  'stable|stable': row(5, 'Reversal at both; consolidation'),
  'stable|decreasing': row(6, 'Reversal at resistance; support may break'),
  'decreasing|increasing': row(7, 'Reversal at support; resistance may break out'),
  'decreasing|stable': row(8, 'Reversal at support; resistance will break out'),
  'decreasing|decreasing': row(9, 'Unpredictable; avoid'),
};

export type Coa2Result =
  | { status: 'ok'; number: number; outcome: string }
  | { status: 'outside_window' | 'not_on_first_hit' | 'no_data' };

// `hhmm` is the IST clock time. Valid from the window start to the window end, both inclusive. Not used on the first hit of an extension.
export function selectCoa2(call: Trend | null, put: Trend | null, hhmm: string, opts: { firstHitOfExtension: boolean }, cfg: LtpConfig = LTP_CONFIG): Coa2Result {
  const minute = minutesOf(hhmm);
  if (minute < minutesOf(cfg.coa2.windowStart) || minute > minutesOf(cfg.coa2.windowEnd)) return { status: 'outside_window' };
  if (opts.firstHitOfExtension) return { status: 'not_on_first_hit' };
  if (!call || !put) return { status: 'no_data' };
  return { status: 'ok', ...COA2_TABLE[`${call}|${put}`] };
}
