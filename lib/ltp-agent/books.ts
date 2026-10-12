// The two paper books. BUY: one lot of the ATM (or 1-OTM) option. SELL: a hedged credit spread (short leg at the anchor strike, hedge
// `hedge_width` strikes further out). Both are opened, marked and closed by the same code in live and replay. Pure: snapshots go in, trades come out.
import { ratesOn } from './config/costs';
import { lotSizeOn } from './config/lots';
import { chargesFor, type Charges, type OrderLeg } from './costs';
import { fillPrice, type FillQuality } from './fills';
import type { Strategy } from './strategy';
import type { ChainRow, Side, Snapshot } from '@/lib/ltp/types';

export type Book = 'buy' | 'sell';
export type Direction = 'long' | 'short';
export type ExitReason = 'target' | 'stop' | 'time' | 'level_shift' | 'data_gap';

export type Leg = { side: 'buy' | 'sell'; optionSide: Side; strike: number; entryPrice: number; quality: FillQuality; lastLtp: number };
export type Position = {
  book: Book; underlying: string; expiry: string; direction: Direction; date: string; openedTs: number; entrySpot: number;
  qty: number; legs: Leg[]; plannedRiskInr: number; marginEstimate?: { inr: number; estimate: true }; fillQuality: FillQuality;
  maeSpot: number; mfeSpot: number; maeInr: number; mfeInr: number;
};
export type Signal = { direction: Direction; underlying: string; anchorStrike: number };
export type ClosedTrade = {
  book: Book; underlying: string; direction: Direction; date: string; openedTs: number; closedTs: number; qty: number;
  legs: (Leg & { exitPrice: number; exitQuality: FillQuality })[];
  grossPnl: number; charges: Charges; netPnl: number; plannedRiskInr: number; rMultiple: number;
  maeSpot: number; mfeSpot: number; maeInr: number; mfeInr: number; holdingMinutes: number;
  exitReason: ExitReason; fillQuality: FillQuality; marginEstimate?: { inr: number; estimate: true };
};

const rowAt = (snap: Snapshot, side: Side, strike: number): ChainRow | undefined => snap.rows.find((r) => r.side === side && r.strike === strike);
const strikesOf = (snap: Snapshot) => [...new Set(snap.rows.map((r) => r.strike))].sort((a, b) => a - b);
const nearest = (strikes: number[], x: number) => strikes.reduce((best, k) => (Math.abs(k - x) < Math.abs(best - x) ? k : best), strikes[0]);
const money = (x: number) => Math.round(x * 100) / 100;
const exchangeOf = (underlying: string) => (underlying.startsWith('BSE:') ? 'BSE' : 'NSE');

export function openPosition(book: Book, signal: Signal, snap: Snapshot, strategy: Strategy, date: string): Position | { skipped: string } {
  const lot = lotSizeOn(signal.underlying, date);
  const strikes = strikesOf(snap);
  if (!strikes.length) return { skipped: 'no_option' };
  const base = { book, underlying: signal.underlying, expiry: snap.expiry, direction: signal.direction, date, openedTs: snap.ts, entrySpot: snap.spot, qty: lot, maeSpot: 0, mfeSpot: 0, maeInr: 0, mfeInr: 0 };

  if (book === 'buy') {
    const optionSide: Side = signal.direction === 'long' ? 'CE' : 'PE';
    const atm = nearest(strikes, snap.spot);
    const at = strikes.indexOf(atm);
    const strike = strategy.books.buy.strike === 'atm' ? atm : strikes[at + (signal.direction === 'long' ? 1 : -1)];
    const row = strike === undefined ? undefined : rowAt(snap, optionSide, strike);
    const fill = row ? fillPrice(row, 'buy', strategy.fills) : null;
    if (!row || !fill) return { skipped: 'no_option' };
    return { ...base, legs: [{ side: 'buy', optionSide, strike, entryPrice: fill.price, quality: fill.quality, lastLtp: row.ltp ?? fill.price }], plannedRiskInr: money(fill.price * lot), fillQuality: fill.quality };
  }

  const optionSide: Side = signal.direction === 'long' ? 'PE' : 'CE';
  const shortStrike = nearest(strikes, signal.anchorStrike);
  const width = strategy.books.sell.hedge_width;
  const hedgeStrike = signal.direction === 'long' ? shortStrike - width * snap.step : shortStrike + width * snap.step;
  const shortRow = rowAt(snap, optionSide, shortStrike);
  const hedgeRow = rowAt(snap, optionSide, hedgeStrike);
  const shortFill = shortRow ? fillPrice(shortRow, 'sell', strategy.fills) : null;
  const hedgeFill = hedgeRow ? fillPrice(hedgeRow, 'buy', strategy.fills) : null;
  if (!shortRow || !shortFill) return { skipped: 'no_short_quote' };
  if (!hedgeRow || !hedgeFill) return { skipped: 'no_hedge_quote' };
  const credit = shortFill.price - hedgeFill.price;
  const maxLoss = money((width * snap.step - credit) * lot);
  return {
    ...base, plannedRiskInr: maxLoss, marginEstimate: { inr: maxLoss, estimate: true },
    legs: [
      { side: 'sell', optionSide, strike: shortStrike, entryPrice: shortFill.price, quality: shortFill.quality, lastLtp: shortRow.ltp ?? shortFill.price },
      { side: 'buy', optionSide, strike: hedgeStrike, entryPrice: hedgeFill.price, quality: hedgeFill.quality, lastLtp: hedgeRow.ltp ?? hedgeFill.price },
    ],
    fillQuality: shortFill.quality === 'quote' && hedgeFill.quality === 'quote' ? 'quote' : 'ltp_fallback',
  };
}

const grossOf = (legs: { side: 'buy' | 'sell'; entryPrice: number; lastLtp: number }[], qty: number) =>
  legs.reduce((sum, l) => sum + (l.side === 'buy' ? l.lastLtp - l.entryPrice : l.entryPrice - l.lastLtp) * qty, 0);

// Updates the last known LTP of each leg and the running excursions. Returns a new position.
export function markPosition(p: Position, snap: Snapshot): Position {
  const legs = p.legs.map((l) => ({ ...l, lastLtp: rowAt(snap, l.optionSide, l.strike)?.ltp ?? l.lastLtp }));
  const favourable = p.direction === 'long' ? snap.spot - p.entrySpot : p.entrySpot - snap.spot;
  const pnl = grossOf(legs, p.qty);
  return { ...p, legs, maeSpot: Math.max(p.maeSpot, -favourable), mfeSpot: Math.max(p.mfeSpot, favourable), maeInr: Math.max(p.maeInr, -pnl), mfeInr: Math.max(p.mfeInr, pnl) };
}

export function closePosition(p: Position, snap: Snapshot, reason: ExitReason, strategy: Strategy): ClosedTrade {
  const marked = markPosition(p, snap);
  const legs = marked.legs.map((l) => {
    const action = l.side === 'buy' ? 'sell' : 'buy';
    const row = rowAt(snap, l.optionSide, l.strike);
    const fill = row ? fillPrice(row, action, strategy.fills) : null;
    if (fill) return { ...l, exitPrice: fill.price, exitQuality: fill.quality };
    // The contract is gone from this snapshot (a gap): use its last known LTP with the fallback slippage, and say so.
    const moved = action === 'sell' ? l.lastLtp * (1 - strategy.fills.fallback_slippage_pct / 100) : l.lastLtp * (1 + strategy.fills.fallback_slippage_pct / 100);
    return { ...l, exitPrice: money(Math.max(strategy.fills.tick, moved)), exitQuality: 'ltp_fallback' as FillQuality };
  });
  const gross = legs.reduce((sum, l) => sum + (l.side === 'buy' ? l.exitPrice - l.entryPrice : l.entryPrice - l.exitPrice) * p.qty, 0);
  const orders: OrderLeg[] = [
    ...legs.map((l) => ({ side: l.side, price: l.entryPrice, qty: p.qty })),
    ...legs.map((l) => ({ side: (l.side === 'buy' ? 'sell' : 'buy') as 'buy' | 'sell', price: l.exitPrice, qty: p.qty })),
  ];
  const charges = chargesFor(orders, ratesOn(p.date, exchangeOf(p.underlying)));
  const net = gross - charges.total;
  return {
    book: p.book, underlying: p.underlying, direction: p.direction, date: p.date, openedTs: p.openedTs, closedTs: snap.ts, qty: p.qty, legs,
    grossPnl: gross, charges, netPnl: net, plannedRiskInr: p.plannedRiskInr, rMultiple: net / p.plannedRiskInr,
    maeSpot: marked.maeSpot, mfeSpot: marked.mfeSpot, maeInr: marked.maeInr, mfeInr: marked.mfeInr, holdingMinutes: (snap.ts - p.openedTs) / 60,
    exitReason: reason, fillQuality: p.fillQuality === 'ltp_fallback' || legs.some((l) => l.exitQuality === 'ltp_fallback') ? 'ltp_fallback' : 'quote',
    ...(p.marginEstimate ? { marginEstimate: p.marginEstimate } : {}),
  };
}

// Judged on the spot between the previous snapshot and this one. If the stop and the target were both crossed in that step, the stop is booked.
export function resolveExit(prevSpot: number | null, spot: number, plan: { stop: number; target: number; direction: Direction }): 'stop' | 'target' | null {
  const lo = prevSpot === null ? spot : Math.min(prevSpot, spot);
  const hi = prevSpot === null ? spot : Math.max(prevSpot, spot);
  const stopHit = plan.direction === 'long' ? lo <= plan.stop : hi >= plan.stop;
  const targetHit = plan.direction === 'long' ? hi >= plan.target : lo <= plan.target;
  return stopHit ? 'stop' : targetHit ? 'target' : null;
}
