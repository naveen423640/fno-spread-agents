// Option charges, with the date each set took effect. Rates for NSE index options are the ones already used by lib/options-costs.ts. Everything
// marked "confirm" is my reading and should be checked against the current exchange and SEBI circulars before the numbers are trusted.
type RateSet = {
  effectiveFrom: string;
  brokeragePerOrder: number; // Rs per order (assumed flat discount-broker rate, confirm)
  sttSell: number; // on the premium of options sold
  sttExercise: number; // on the intrinsic value of an option exercised in the money (confirm)
  exchangeNse: number; // exchange transaction charge on premium turnover
  exchangeBse: number; // BSE (SENSEX) transaction charge on premium turnover (confirm)
  sebi: number; // Rs 10 per crore of turnover
  gst: number; // on brokerage + exchange + SEBI
  stampBuy: number; // on the premium of options bought
};

const BASE: Omit<RateSet, 'effectiveFrom' | 'sttSell' | 'exchangeNse'> = { brokeragePerOrder: 20, sttExercise: 0.00125, exchangeBse: 0.000325, sebi: 0.000001, gst: 0.18, stampBuy: 0.00003 };
export const COST_RATES: RateSet[] = [
  { ...BASE, effectiveFrom: '2024-10-01', sttSell: 0.001, exchangeNse: 0.0003503 },
  { ...BASE, effectiveFrom: '2026-03-01', sttSell: 0.001, exchangeNse: 0.000355299 },
  { ...BASE, effectiveFrom: '2026-04-01', sttSell: 0.0015, exchangeNse: 0.000355299 },
];

export type Rates = { effectiveFrom: string; brokeragePerOrder: number; sttSell: number; sttExercise: number; exchange: number; sebi: number; gst: number; stampBuy: number };

export function ratesOn(date: string, exchange: 'NSE' | 'BSE'): Rates {
  const set = COST_RATES.filter((r) => r.effectiveFrom <= date).sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom))[0];
  if (!set) throw new Error(`No cost rates for ${date}: the table starts at ${COST_RATES[0].effectiveFrom}.`);
  return { effectiveFrom: set.effectiveFrom, brokeragePerOrder: set.brokeragePerOrder, sttSell: set.sttSell, sttExercise: set.sttExercise, exchange: exchange === 'NSE' ? set.exchangeNse : set.exchangeBse, sebi: set.sebi, gst: set.gst, stampBuy: set.stampBuy };
}
