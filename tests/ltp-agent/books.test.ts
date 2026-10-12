import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { chargesFor } from '@/lib/ltp-agent/costs';
import { ratesOn } from '@/lib/ltp-agent/config/costs';
import { closePosition, markPosition, openPosition, resolveExit, type Position } from '@/lib/ltp-agent/books';
import { parseStrategy } from '@/lib/ltp-agent/strategy';
import { istTs } from '@/lib/ltp/time';
import { makeChain } from '../support/ltp-chain';
import { withQuotes } from '../support/ltp-quotes';

const strategy = parseStrategy(readFileSync('strategies/ltp_v0.1.yaml', 'utf8'));
const U = 'NSE:NIFTY50-INDEX';
const DATE = '2026-10-12';
const snap = (hhmm: string, quotes: Parameters<typeof withQuotes>[1] = {}, spot = 24037) => withQuotes(makeChain({ spot, step: 50, ts: istTs(DATE, hhmm), expiry: '2026-10-13', strikes: [23700, 23900, 23950, 24000, 24050, 24100, 24200, 24250, 24400] }), quotes);
const opened = (p: ReturnType<typeof openPosition>): Position => { if ('skipped' in p) throw new Error(p.skipped); return p; };

describe('BUY book opens one lot of the at-the-money option', () => {
  const entry = snap('10:00', { CE24050: { ltp: 100, bid: 99.9, ask: 100.2 }, PE24050: { ltp: 90, bid: 89.9, ask: 90.2 } });
  it('long signal buys the ATM call at the ask plus one tick, short buys the ATM put', () => {
    const long = opened(openPosition('buy', { direction: 'long', underlying: U, anchorStrike: 23900 }, entry, strategy, DATE));
    expect(long.legs).toEqual([{ side: 'buy', optionSide: 'CE', strike: 24050, entryPrice: 100.25, quality: 'quote', lastLtp: 100 }]);
    expect(long.qty).toBe(65);
    const short = opened(openPosition('buy', { direction: 'short', underlying: U, anchorStrike: 24200 }, entry, strategy, DATE));
    expect(short.legs[0]).toMatchObject({ optionSide: 'PE', strike: 24050, entryPrice: 90.25 });
  });
  it('otm1 buys one strike out: the call above for a long, the put below for a short', () => {
    const s = { ...strategy, books: { ...strategy.books, buy: { strike: 'otm1' as const } } };
    const q = snap('10:00', { CE24100: { ltp: 70, bid: 69.9, ask: 70.1 }, PE24000: { ltp: 60, bid: 59.9, ask: 60.1 } });
    expect(opened(openPosition('buy', { direction: 'long', underlying: U, anchorStrike: 23900 }, q, s, DATE)).legs[0]).toMatchObject({ optionSide: 'CE', strike: 24100 });
    expect(opened(openPosition('buy', { direction: 'short', underlying: U, anchorStrike: 24200 }, q, s, DATE)).legs[0]).toMatchObject({ optionSide: 'PE', strike: 24000 });
  });
  it('a missing ask falls back to LTP plus 2% and the position says so', () => {
    const q = snap('10:00', { CE24050: { ltp: 100, bid: 99.9 } });
    const p = opened(openPosition('buy', { direction: 'long', underlying: U, anchorStrike: 23900 }, q, strategy, DATE));
    expect(p.legs[0]).toMatchObject({ entryPrice: 102, quality: 'ltp_fallback' });
    expect(p.fillQuality).toBe('ltp_fallback');
  });
  it('planned risk is the premium paid (the most a bought option can lose)', () => {
    const p = opened(openPosition('buy', { direction: 'long', underlying: U, anchorStrike: 23900 }, entry, strategy, DATE));
    expect(p.plannedRiskInr).toBeCloseTo(100.25 * 65, 6);
    expect(p.marginEstimate).toBeUndefined();
  });
  it('an ATM option with no quote and no LTP is a skip with a reason, not an invented fill', () => {
    const q = withQuotes(makeChain({ spot: 24037, step: 50, ts: istTs(DATE, '10:00'), expiry: '2026-10-13', strikes: [23900, 24200] }), { CE23900: { ltp: null } });
    expect(openPosition('buy', { direction: 'long', underlying: U, anchorStrike: 23900 }, q, strategy, DATE)).toEqual({ skipped: 'no_option' });
  });
});

describe('SELL book is a hedged credit spread', () => {
  const entry = snap('10:00', { PE23900: { ltp: 50, bid: 49.9, ask: 50.2 }, PE23700: { ltp: 20, bid: 19.8, ask: 20.1 }, CE24200: { ltp: 55, bid: 54.9, ask: 55.2 }, CE24400: { ltp: 25, bid: 24.8, ask: 25.1 } });
  it('long signal sells the support PE at the bid minus a tick and buys the PE four strikes lower at the ask plus a tick', () => {
    const p = opened(openPosition('sell', { direction: 'long', underlying: U, anchorStrike: 23900 }, entry, strategy, DATE));
    expect(p.legs.map((l) => [l.side, l.optionSide, l.strike, l.entryPrice])).toEqual([['sell', 'PE', 23900, 49.85], ['buy', 'PE', 23700, 20.15]]);
  });
  it('short signal mirrors it on the call side: sell the resistance CE, buy the CE four strikes higher', () => {
    const p = opened(openPosition('sell', { direction: 'short', underlying: U, anchorStrike: 24200 }, entry, strategy, DATE));
    expect(p.legs.map((l) => [l.side, l.optionSide, l.strike])).toEqual([['sell', 'CE', 24200], ['buy', 'CE', 24400]]);
  });
  it('margin is an estimate: (width - credit) x lot = (200 - 29.7) x 65 = 11069.5, and so is the planned risk', () => {
    const p = opened(openPosition('sell', { direction: 'long', underlying: U, anchorStrike: 23900 }, entry, strategy, DATE));
    expect(p.marginEstimate).toEqual({ inr: 11069.5, estimate: true });
    expect(p.plannedRiskInr).toBeCloseTo(11069.5, 6);
  });
  it('a missing hedge quote skips the trade; it does not invent a hedge', () => {
    const q = snap('10:00', { PE23900: { ltp: 50, bid: 49.9, ask: 50.2 }, PE23700: { ltp: null } });
    expect(openPosition('sell', { direction: 'long', underlying: U, anchorStrike: 23900 }, q, strategy, DATE)).toEqual({ skipped: 'no_hedge_quote' });
  });
  it('a hedge width wider than the chain skips for the same reason', () => {
    const s = { ...strategy, books: { ...strategy.books, sell: { hedge_width: 8 } } };
    expect(openPosition('sell', { direction: 'long', underlying: U, anchorStrike: 23900 }, entry, s, DATE)).toEqual({ skipped: 'no_hedge_quote' });
  });
});

describe('closing a position books gross, charges, net and the metrics', () => {
  it('BUY: bought 100.25, sold at the bid 120 minus a tick = 119.95; gross 1280.50; net = gross minus charges; R = net / planned risk', () => {
    const open = opened(openPosition('buy', { direction: 'long', underlying: U, anchorStrike: 23900 }, snap('10:00', { CE24050: { ltp: 100, bid: 99.9, ask: 100.2 } }), strategy, DATE));
    let p = markPosition(open, snap('10:05', { CE24050: { ltp: 90 } }, 24010));
    p = markPosition(p, snap('10:10', { CE24050: { ltp: 120 } }, 24070));
    const t = closePosition(p, snap('10:25', { CE24050: { ltp: 120, bid: 120, ask: 120.2 } }, 24070), 'target', strategy);
    expect(t.grossPnl).toBeCloseTo((119.95 - 100.25) * 65, 6);
    const charges = chargesFor([{ side: 'buy', price: 100.25, qty: 65 }, { side: 'sell', price: 119.95, qty: 65 }], ratesOn(DATE, 'NSE'));
    expect(t.charges).toEqual(charges);
    expect(t.netPnl).toBeCloseTo(t.grossPnl - charges.total, 6);
    expect(t.rMultiple).toBeCloseTo(t.netPnl / open.plannedRiskInr, 6);
    expect(t).toMatchObject({ exitReason: 'target', holdingMinutes: 25, maeSpot: 27, mfeSpot: 33, fillQuality: 'quote', book: 'buy', direction: 'long' });
    expect(t.maeInr).toBeCloseTo(10.25 * 65, 6); // worst mark: option at 90
    expect(t.mfeInr).toBeCloseTo((120 - 100.25) * 65, 6);
  });
  it('SELL: sold 49.85 / bought 20.15, then bought back 30.25 and sold the hedge 9.95; gross (19.6 - 10.2) x 65 = 611', () => {
    const open = opened(openPosition('sell', { direction: 'long', underlying: U, anchorStrike: 23900 }, snap('10:00', { PE23900: { ltp: 50, bid: 49.9, ask: 50.2 }, PE23700: { ltp: 20, bid: 19.8, ask: 20.1 } }), strategy, DATE));
    const t = closePosition(open, snap('10:30', { PE23900: { ltp: 30, bid: 29.9, ask: 30.2 }, PE23700: { ltp: 10, bid: 10, ask: 10.3 } }), 'time', strategy);
    expect(t.grossPnl).toBeCloseTo(611, 6);
    expect(t.charges.total).toBe(chargesFor([{ side: 'sell', price: 49.85, qty: 65 }, { side: 'buy', price: 20.15, qty: 65 }, { side: 'buy', price: 30.25, qty: 65 }, { side: 'sell', price: 9.95, qty: 65 }], ratesOn(DATE, 'NSE')).total);
    expect(t.exitReason).toBe('time');
    expect(t.marginEstimate).toEqual({ inr: 11069.5, estimate: true });
  });
  it('a leg with no quote at exit uses its last known LTP plus the fallback percent and is marked ltp_fallback', () => {
    const open = opened(openPosition('buy', { direction: 'long', underlying: U, anchorStrike: 23900 }, snap('10:00', { CE24050: { ltp: 100, bid: 99.9, ask: 100.2 } }), strategy, DATE));
    const t = closePosition(open, snap('10:20', { CE24050: { ltp: 110 } }), 'data_gap', strategy);
    expect(t.fillQuality).toBe('ltp_fallback');
    expect(t.exitReason).toBe('data_gap');
    expect(t.legs[0].exitPrice).toBeCloseTo(110 * 0.98, 6);
  });
});

describe('stop and target in the same minute: the stop is booked', () => {
  const plan = { stop: 24000, target: 24100, direction: 'long' as const };
  it('a long reads target only when only the target is crossed, stop only when only the stop is', () => {
    expect(resolveExit(24050, 24110, plan)).toBe('target');
    expect(resolveExit(24050, 23990, plan)).toBe('stop');
    expect(resolveExit(24050, 24060, plan)).toBeNull();
  });
  it('both crossed inside one step books the stop', () => {
    expect(resolveExit(23950, 24110, plan)).toBe('stop');
    expect(resolveExit(24110, 23950, plan)).toBe('stop');
  });
  it('a short is the mirror: stop above, target below', () => {
    const short = { stop: 24100, target: 24000, direction: 'short' as const };
    expect(resolveExit(24050, 23990, short)).toBe('target');
    expect(resolveExit(24050, 24110, short)).toBe('stop');
    expect(resolveExit(24110, 23990, short)).toBe('stop');
  });
  it('with no previous spot, only the current spot is judged', () => {
    expect(resolveExit(null, 24110, plan)).toBe('target');
  });
});
