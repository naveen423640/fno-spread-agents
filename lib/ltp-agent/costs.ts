// Charges for a set of option orders, each component rounded to the paisa and the total the sum of the rounded parts. Pure.
import type { Rates } from './config/costs';

export type OrderLeg = { side: 'buy' | 'sell'; price: number; qty: number };
export type Charges = { brokerage: number; stt: number; exchange: number; sebi: number; gst: number; stamp: number; total: number };

const paise = (x: number) => Math.round(x * 100 + 1e-9) / 100;

export function chargesFor(legs: OrderLeg[], rates: Rates, opts: { exercise?: { intrinsic: number; qty: number } } = {}): Charges {
  const turnover = legs.reduce((sum, l) => sum + l.price * l.qty, 0);
  const sold = legs.filter((l) => l.side === 'sell').reduce((sum, l) => sum + l.price * l.qty, 0);
  const bought = turnover - sold;
  const brokerage = legs.length * rates.brokeragePerOrder;
  const exchange = turnover * rates.exchange;
  const sebi = turnover * rates.sebi;
  const sttRaw = sold * rates.sttSell + (opts.exercise ? opts.exercise.intrinsic * opts.exercise.qty * rates.sttExercise : 0);
  const gst = (brokerage + exchange + sebi) * rates.gst;
  const parts = { brokerage: paise(brokerage), stt: paise(sttRaw), exchange: paise(exchange), sebi: paise(sebi), gst: paise(gst), stamp: paise(bought * rates.stampBuy) };
  return { ...parts, total: paise(Object.values(parts).reduce((a, b) => a + b, 0)) };
}
