// The learning phases. The first 100 closed trades of a strategy version are journal only; proposals and experiments are locked until then.
import type { JournalStore } from './journal-store';

export const REQUIRED_TRADES = 100;

export class PhaseLockedError extends Error {
  constructor(message: string) { super(message); this.name = 'PhaseLockedError'; }
}

export function phaseOf(closed: number): { phase: 'journal' | 'learning'; counter: string; unlocked: boolean } {
  return closed >= REQUIRED_TRADES
    ? { phase: 'learning', counter: 'Learning phase', unlocked: true }
    : { phase: 'journal', counter: `Journal phase: ${closed} / ${REQUIRED_TRADES} trades`, unlocked: false };
}

export async function assertLearning(journal: JournalStore, version: string): Promise<void> {
  const p = phaseOf(await journal.closedTradeCount(version));
  if (!p.unlocked) throw new PhaseLockedError(`Proposals and experiments are locked. ${p.counter}.`);
}
