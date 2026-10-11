// Transaction costs for intraday futures-style trades on Indian equity F&O. Every rate is a number in this file, with where it came from.
// Rates change; confirm against your broker's contract note before relying on a rupee figure.

export type SttStep = { from: string; sellPct: number };
export type FuturesCostConfig = {
  verifiedOn: string;
  sources: string[];
  brokeragePerOrder: number; // flat rupees per order (many brokers charge less, or nothing, on F&O)
  exchangePct: number; // NSE transaction charge, percent of turnover, each leg
  sebiPct: number; // SEBI turnover fee, percent of turnover, each leg
  stampBuyPct: number; // stamp duty, buy leg only
  stt: SttStep[]; // securities transaction tax on futures, sell leg only, by effective date
  gstPct: number; // on brokerage + exchange charge + SEBI fee
};

export const FUTURES_COSTS: FuturesCostConfig = {
  verifiedOn: '2026-10-12',
  sources: [
    'STT on futures raised from 0.02% to 0.05% (sell side) from 1 April 2026, per Union Budget 2026 coverage (Swastika, ICICI Direct, Angel One). Not checked against the NSE schedule itself.',
    'NSE equity futures transaction charge about Rs 1.73 to 1.90 per lakh of turnover (0.0017% to 0.0019%); a Feb 2026 circular restructured it from 1 March 2026 with the total unchanged. 0.0019% is used here.',
    'SEBI turnover fee Rs 10 per crore (0.0001%); stamp duty 0.002% on the buy leg; GST 18% on brokerage, exchange and SEBI charges.',
  ],
  brokeragePerOrder: 20,
  exchangePct: 0.0019,
  sebiPct: 0.0001,
  stampBuyPct: 0.002,
  stt: [{ from: '1900-01-01', sellPct: 0.02 }, { from: '2026-04-01', sellPct: 0.05 }],
  gstPct: 18,
};

export type CostBreakdown = { brokerage: number; exchange: number; sebi: number; stt: number; stamp: number; gst: number; total: number };

export const sttSellPct = (date: string, config: FuturesCostConfig = FUTURES_COSTS) => [...config.stt].sort((a, b) => a.from.localeCompare(b.from)).filter((s) => s.from <= date).pop()?.sellPct ?? 0;

// Round-trip cost of one futures-style trade (two orders). `direction` +1 buys first and sells later; -1 sells first and buys back.
export function futuresRoundTripCosts(args: { entryFill: number; exitFill: number; qty: number; direction: 1 | -1; date: string }, config: FuturesCostConfig = FUTURES_COSTS): CostBreakdown {
  const buy = (args.direction === 1 ? args.entryFill : args.exitFill) * args.qty;
  const sell = (args.direction === 1 ? args.exitFill : args.entryFill) * args.qty;
  const brokerage = 2 * config.brokeragePerOrder;
  const exchange = ((buy + sell) * config.exchangePct) / 100;
  const sebi = ((buy + sell) * config.sebiPct) / 100;
  const stt = (sell * sttSellPct(args.date, config)) / 100;
  const stamp = (buy * config.stampBuyPct) / 100;
  const gst = ((brokerage + exchange + sebi) * config.gstPct) / 100;
  return { brokerage, exchange, sebi, stt, stamp, gst, total: brokerage + exchange + sebi + stt + stamp + gst };
}
