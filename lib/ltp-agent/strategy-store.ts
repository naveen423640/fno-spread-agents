// The strategy the live agent runs. The app cannot read files at run time, so versions live in the database; v0.1 is bundled into the build
// as text and used when the database has no copy. Scripts that need the file copies use strategy-files.ts instead.
import v01 from '../../strategies/ltp_v0.1.yaml?raw';
import v20 from '../../strategies/ltp_v2.0.yaml?raw';
import { DEFAULT_VERSION } from './default-version';
import type { JournalStore } from './journal-store';
import { parseStrategy, type Strategy } from './strategy';

export const BUNDLED_STRATEGIES: Record<string, string> = { '0.1': v01, '2.0': v20 };
export { DEFAULT_VERSION };
// v0.1 stays loadable for comparison.
export const BUNDLED_CHANGELOG: Record<string, string> = { '0.1': 'The pure course rules.', '2.0': 'Course rules (Detailed Chart of Accuracy, 529 practice-tool cases verified) with the knowledge graph as a guard: a signal is skipped when the live scenario and the graph disagree.' };

export async function loadStrategy(journal: JournalStore, version: string): Promise<Strategy> {
  const text = (await journal.strategyYaml(version)) ?? BUNDLED_STRATEGIES[version];
  if (!text) throw new Error(`Strategy version ${version} is not available.`);
  return parseStrategy(text);
}

export async function loadActiveStrategy(journal: JournalStore): Promise<Strategy> {
  return loadStrategy(journal, (await journal.getState('active_version')) ?? DEFAULT_VERSION);
}
