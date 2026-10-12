// D: the calibration log. LTP Calculator's EOS / EOR calculation is unpublished, so the user types in the value the website showed at a time,
// and this file records what each proxy method gives for the same moment. The summary says how far each proxy is from the real thing.
import { LTP_CONFIG } from './config';
import { EXTENSION_METHODS, extensionLevels } from './extensions';
import { computeLevels } from './levels';
import { statusOf } from './strength';
import type { CalibrationEntry } from './store';
import type { Snapshot } from './types';

export const CALIBRATION_LABELS = ['EOS', 'EOR', 'EOS-1', 'EOR+1'];
const WINDOW_SECONDS = 60;

export type ProxiesResult = { ok: true; snapshotTs: number; proxies: Record<string, number | null> } | { ok: false; message: string };

// The proxy value of `label` under every method, from the stored snapshot nearest to `entryTs` (within one minute either way).
export function proxiesAt(snapshots: Snapshot[], entryTs: number, label: string): ProxiesResult {
  if (!CALIBRATION_LABELS.includes(label)) return { ok: false, message: `Unknown label. Use one of ${CALIBRATION_LABELS.join(', ')}.` };
  let nearest: Snapshot | null = null;
  for (const s of snapshots) if (Math.abs(s.ts - entryTs) <= WINDOW_SECONDS && (!nearest || Math.abs(s.ts - entryTs) < Math.abs(nearest.ts - entryTs))) nearest = s;
  if (!nearest) return { ok: false, message: 'No snapshot within one minute of that time.' };
  const levels = computeLevels(nearest);
  if (!levels) return { ok: false, message: 'That snapshot has no usable levels.' };
  const support = statusOf('support', levels.support, levels.line, LTP_CONFIG);
  const resistance = statusOf('resistance', levels.resistance, levels.line, LTP_CONFIG);
  const proxies: Record<string, number | null> = {};
  for (const method of EXTENSION_METHODS) {
    const e = extensionLevels(nearest, levels, support, resistance, method);
    const level = { EOS: e.eos, EOR: e.eor, 'EOS-1': e.eosMinus[0], 'EOR+1': e.eorPlus[0] }[label]!;
    proxies[method.id] = level.value;
  }
  return { ok: true, snapshotTs: nearest.ts, proxies };
}

export type MethodSummary = { n: number; meanAbsError: number; medianError: number; errorInSteps: number };

// Error is proxy minus the website's value. Entries where a method had no value are left out of that method's numbers.
export function calibrationSummary(entries: CalibrationEntry[]): Record<string, MethodSummary> {
  const byMethod = new Map<string, { error: number; step: number }[]>();
  for (const e of entries) {
    const step = LTP_CONFIG.expectedStep[e.underlying] ?? 50;
    for (const [method, value] of Object.entries(e.proxies)) {
      if (value === null) continue;
      byMethod.set(method, [...(byMethod.get(method) ?? []), { error: value - e.actual, step }]);
    }
  }
  const out: Record<string, MethodSummary> = {};
  for (const [method, list] of byMethod) {
    const sorted = list.map((x) => x.error).sort((a, b) => a - b);
    const mid = sorted.length >> 1;
    const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
    out[method] = {
      n: list.length,
      meanAbsError: mean(list.map((x) => Math.abs(x.error))),
      medianError: sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2,
      errorInSteps: mean(list.map((x) => Math.abs(x.error) / x.step)),
    };
  }
  return out;
}
