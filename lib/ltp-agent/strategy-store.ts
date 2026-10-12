// The strategy the live agent runs. The app cannot read files at run time, so versions live in the database; v0.1 is bundled into the build
// as text and used when the database has no copy. Scripts that need the file copies use strategy-files.ts instead.
import v01 from '../../strategies/ltp_v0.1.yaml?raw';
import type { JournalStore } from './journal-store';
import { parseStrategy, type Strategy } from './strategy';

export const BUNDLED_STRATEGIES: Record<string, string> = { '0.1': v01 };

export async function loadStrategy(journal: JournalStore, version: string): Promise<Strategy> {
  const text = (await journal.strategyYaml(version)) ?? BUNDLED_STRATEGIES[version];
  if (!text) throw new Error(`Strategy version ${version} is not available.`);
  return parseStrategy(text);
}

export async function loadActiveStrategy(journal: JournalStore): Promise<Strategy> {
  return loadStrategy(journal, (await journal.getState('active_version')) ?? '0.1');
}
