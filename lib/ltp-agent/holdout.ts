// Which days the reviewer and the proposer may learn from. The chronologically last 30% of recorded days is the holdout and is only ever used
// by the gate; everything the LLM is shown comes through `discoverySet`, which excludes holdout days inside the database query.
import type { JournalStore } from './journal-store';
import { summarizeTrades, summaryTradeOf, type SummaryTrade, type WeeklySummary } from './reviewer';

export type Split = { discovery: string[]; holdout: string[] };
export const HOLDOUT_SHARE = 0.3;

export function splitDays(days: string[], share: number = HOLDOUT_SHARE): Split {
  const sorted = [...new Set(days)].sort();
  if (sorted.length < 2) throw new Error('Splitting needs at least 2 recorded trading days.');
  const holdoutCount = Math.min(sorted.length - 1, Math.max(1, Math.round(sorted.length * share)));
  return { discovery: sorted.slice(0, sorted.length - holdoutCount), holdout: sorted.slice(sorted.length - holdoutCount) };
}

export type DiscoverySet = { version: string; days: string[]; trades: SummaryTrade[]; summary: WeeklySummary };

// Closed trades of one strategy version on every day that is not held out (days recorded after the split count as discovery), with their reviews.
export async function discoverySet(journal: JournalStore, version: string, split: Split): Promise<DiscoverySet> {
  const trades = (await journal.closedTrades({ version, excludeDays: split.holdout })).map(summaryTradeOf);
  return { version, days: [...new Set(trades.map((t) => t.date))].sort(), trades, summary: summarizeTrades(trades) };
}
