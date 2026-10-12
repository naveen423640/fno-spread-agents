// The monthly readiness report: per strategy version and book, how it did, which mistakes recur, and whether the evidence is stable out of sample.
// It states facts and never recommends going live; live trading is out of scope.
import type { Book } from './books';
import { metricsOf } from './metrics';
import type { ClosedRecord, JournalStore } from './journal-store';

export type ReportRow = { version: string; book: Book; trades: number; winRate: number; expectancy: number; profitFactor: number | null; maxDrawdown: number; percentileVsRandom: number | null };
export type Stability = { stable: boolean; basis: string };
export type MonthlyReport = {
  month: string; rows: ReportRow[]; topTags: { tag: string; count: number; previousMonth: number }[];
  stability: Record<Book, Stability>; text: string[];
};

const MIN_TRADES = 30;
const BOOKS: Book[] = ['buy', 'sell'];
const versionKey = (v: string) => v.split('.').map(Number);
const compareVersion = (a: string, b: string) => versionKey(a)[0] - versionKey(b)[0] || versionKey(a)[1] - versionKey(b)[1];
const previousMonth = (m: string) => { const [y, mo] = m.split('-').map(Number); return mo === 1 ? `${y - 1}-12` : `${y}-${String(mo - 1).padStart(2, '0')}`; };

// Net P&L of one book across records, in close order.
const netsOf = (records: ClosedRecord[], book: Book) => records.flatMap((r) => r.outcomes.filter((o) => o.book === book)).sort((a, b) => a.closedTs - b.closedTs || a.decisionId.localeCompare(b.decisionId)).map((o) => o.netPnl);
const qualifies = (nets: number[]) => { const m = metricsOf(nets); return m.n >= MIN_TRADES && m.expectancy > 0; };
const tagCounts = (records: ClosedRecord[]) => {
  const out: Record<string, number> = {};
  for (const r of records) for (const t of ((r.review as { mistake_tags?: string[] } | null)?.mistake_tags ?? [])) out[t] = (out[t] ?? 0) + 1;
  return out;
};

export async function monthlyReport(journal: JournalStore, month: string): Promise<MonthlyReport> {
  const all = await journal.closedTrades();
  const inMonth = all.filter((r) => r.decision.tradeDate.startsWith(month));
  const experiments = await journal.listExperiments();

  const versions = [...new Set(inMonth.map((r) => r.decision.strategyVersion))].sort(compareVersion);
  const rows: ReportRow[] = versions.flatMap((version) => BOOKS.map((book) => {
    const m = metricsOf(netsOf(inMonth.filter((r) => r.decision.strategyVersion === version), book));
    const percentile = experiments.find((e) => e.appliedVersion === version)?.results?.[book]?.baselinePercentile ?? null;
    return { version, book, trades: m.n, winRate: m.winRate, expectancy: m.expectancy, profitFactor: m.profitFactor, maxDrawdown: m.maxDrawdown, percentileVsRandom: percentile };
  }));

  const now = tagCounts(inMonth);
  const before = tagCounts(all.filter((r) => r.decision.tradeDate.startsWith(previousMonth(month))));
  const topTags = Object.entries(now).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 5).map(([tag, count]) => ({ tag, count, previousMonth: before[tag] ?? 0 }));

  const allVersions = [...new Set(all.map((r) => r.decision.strategyVersion))].sort(compareVersion);
  const allMonths = [...new Set(all.map((r) => r.decision.tradeDate.slice(0, 7)))].sort();
  const stability = {} as Record<Book, Stability>;
  for (const book of BOOKS) {
    const verOk = allVersions.map((v) => qualifies(netsOf(all.filter((r) => r.decision.strategyVersion === v), book)));
    const monOk = allMonths.map((m) => qualifies(netsOf(all.filter((r) => r.decision.tradeDate.startsWith(m)), book)));
    const consecutiveVersions = verOk.some((ok, i) => ok && verOk[i + 1]);
    const consecutiveMonths = monOk.some((ok, i) => ok && monOk[i + 1] && allMonths[i + 1] === nextMonth(allMonths[i]));
    stability[book] = consecutiveVersions || consecutiveMonths
      ? { stable: true, basis: `at least 2 consecutive ${consecutiveVersions ? 'versions' : 'months'} each had ${MIN_TRADES} or more trades and a positive net expectancy after costs` }
      : { stable: false, basis: allVersions.length < 2 && allMonths.length < 2 ? 'fewer than 2 versions or months have data' : `no 2 consecutive versions or months both had ${MIN_TRADES} or more trades and a positive net expectancy after costs` };
  }
  const text = [
    `LTP agent report for ${month}. Paper trading only; EOS/EOR are proxies.`,
    ...BOOKS.map((b) => `${b.toUpperCase()} book: evidence stable out of sample: ${stability[b].stable ? 'yes' : 'no'} (${stability[b].basis}).`),
    'Live trading is out of scope for this report; it states what the paper results were and nothing about what to do with them.',
  ];
  return { month, rows, topTags, stability, text };
}

function nextMonth(m: string): string { const [y, mo] = m.split('-').map(Number); return mo === 12 ? `${y + 1}-01` : `${y}-${String(mo + 1).padStart(2, '0')}`; }
