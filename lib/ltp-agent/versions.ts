// Strategy versions: listing, approving an experiment into the next version, rejecting, and rolling back. Nothing is ever deleted: a rollback
// only changes which version is active, and an approved version stays on record even if it is later rolled back from.
import { stringify } from 'yaml';
import type { LtpStore } from '@/lib/ltp/store';
import { splitDays, type Split } from './holdout';
import type { JournalStore } from './journal-store';
import { applyDiff, getPath, strategySchema } from './strategy';
import { BUNDLED_CHANGELOG, BUNDLED_STRATEGIES, DEFAULT_VERSION, loadStrategy } from './strategy-store';

const versionKey = (v: string) => v.split('.').map(Number) as [number, number];
const byVersion = (a: { version: string }, b: { version: string }) => versionKey(a.version)[0] - versionKey(b.version)[0] || versionKey(a.version)[1] - versionKey(b.version)[1];

export type VersionRow = { version: string; changelog: string; active: boolean };

export async function listVersions(journal: JournalStore): Promise<VersionRow[]> {
  const stored = await journal.listStrategies();
  const active = (await journal.getState('active_version')) ?? DEFAULT_VERSION;
  const all = new Map<string, string>(Object.keys(BUNDLED_STRATEGIES).map((v) => [v, BUNDLED_CHANGELOG[v] ?? 'Bundled strategy.']));
  for (const s of stored) all.set(s.version, s.changelog);
  return [...all.entries()].map(([version, changelog]) => ({ version, changelog, active: version === active })).sort(byVersion);
}

async function pushHistory(journal: JournalStore, version: string, via: string) {
  const history = JSON.parse((await journal.getState('version_history')) ?? '[]') as unknown[];
  await journal.setState('version_history', JSON.stringify([...history, { version, via, at: Math.floor(Date.now() / 1000) }]));
}

export async function approveExperiment(deps: { store: LtpStore; journal: JournalStore }, id: string): Promise<{ version: string }> {
  const { store, journal } = deps;
  const experiment = await journal.getExperiment(id);
  if (!experiment) throw new Error(`No experiment ${id}.`);
  if (experiment.status !== 'awaiting_approval') throw new Error(`Experiment ${id} is ${experiment.status}; only an experiment that is awaiting_approval can be approved.`);
  const active = (await journal.getState('active_version')) ?? DEFAULT_VERSION;
  if (active !== experiment.baseVersion) throw new Error(`Experiment ${id} was tested against version ${experiment.baseVersion}, but ${active} is active.`);
  const parent = await loadStrategy(journal, experiment.baseVersion);
  const taken = new Set((await listVersions(journal)).map((v) => v.version));
  const [major, startMinor] = versionKey(parent.version);
  let minor = startMinor;
  do { minor += 1; } while (taken.has(`${major}.${minor}`));
  const version = `${major}.${minor}`;
  const next = strategySchema.parse({ ...applyDiff(parent, experiment.diff), version });
  const changelog = `${version} (${id}): ${Object.entries(experiment.diff).map(([k, v]) => `${k} ${String(getPath(parent, k))} -> ${String(v)}`).join(', ')}. ${experiment.hypothesis}`;
  const yaml = `# ltp_v${version}.yaml, generated from ${parent.version} by ${id}\n# changelog\n#   ${changelog}\n${stringify(next)}`;
  await journal.saveStrategy(version, yaml, changelog);
  await journal.setState('active_version', version);
  await pushHistory(journal, version, id);
  try { await journal.setState(`split_${version}`, JSON.stringify(splitDays(await store.recordedDays()))); } catch { /* fewer than 2 recorded days: the split is made when it is first needed */ }
  await journal.saveExperiment({ ...experiment, status: 'approved', appliedVersion: version });
  return { version };
}

export async function rejectExperiment(journal: JournalStore, id: string): Promise<void> {
  const experiment = await journal.getExperiment(id);
  if (!experiment) throw new Error(`No experiment ${id}.`);
  if (experiment.status !== 'awaiting_approval' && experiment.status !== 'proposed') throw new Error(`Experiment ${id} is ${experiment.status}; only a proposed or awaiting_approval experiment can be rejected.`);
  await journal.saveExperiment({ ...experiment, status: 'rejected' });
}

export async function rollbackTo(journal: JournalStore, version: string): Promise<void> {
  await loadStrategy(journal, version); // throws if the version does not exist
  await journal.setState('active_version', version);
  await pushHistory(journal, version, 'rollback');
}

// A version has one split, fixed the first time it is needed (and again whenever a new version is adopted).
export async function ensureSplit(deps: { store: LtpStore; journal: JournalStore }, version: string): Promise<Split> {
  const stored = await deps.journal.getState(`split_${version}`);
  if (stored) return JSON.parse(stored) as Split;
  const split = splitDays(await deps.store.recordedDays());
  await deps.journal.setState(`split_${version}`, JSON.stringify(split));
  return split;
}
