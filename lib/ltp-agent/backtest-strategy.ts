// Which strategy a backtest runs: a stored version (the active one by default), an experiment from the agent applied on the version it was
// proposed against, and/or your own changes to the tunable fields. Trying one never changes a stored strategy or the active version.
import type { JournalStore } from './journal-store';
import { applyDiff, validateDiff, type Strategy } from './strategy';
import { DEFAULT_VERSION } from './default-version';
import { loadStrategy } from './strategy-store';

export type BacktestSpec = { version?: string; experiment?: string; overrides?: Record<string, unknown> };

export async function resolveBacktestStrategy(journal: JournalStore, spec: BacktestSpec): Promise<{ strategy: Strategy; label: string }> {
  let base = spec.version ?? (await journal.getState('active_version')) ?? DEFAULT_VERSION;
  let diff: Record<string, unknown> | null = null;
  const labels: string[] = [];
  if (spec.experiment) {
    const e = await journal.getExperiment(spec.experiment);
    if (!e) throw new Error(`No experiment ${spec.experiment}.`);
    base = e.baseVersion;
    diff = e.diff;
  }
  let strategy = await loadStrategy(journal, base);
  labels.push(`v${base}`);
  if (diff) { strategy = applyDiff(strategy, diff); labels.push(spec.experiment!); }
  const overrides = spec.overrides && Object.keys(spec.overrides).length ? spec.overrides : null;
  if (overrides) {
    const check = validateDiff(overrides);
    if (!check.ok) throw new Error(`Invalid changes: ${check.reason}`);
    strategy = applyDiff(strategy, overrides);
    labels.push(`changes (${Object.entries(overrides).map(([k, v]) => `${k}=${String(v)}`).join(', ')})`);
  }
  return { strategy, label: labels.join(' + ') };
}
