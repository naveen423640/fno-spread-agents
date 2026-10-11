// Turns a raw price round trip into rupees: slippage, lot size, instrument and costs. Futures-style trades trade the underlying's
// price. Option trades are MODELLED with Black-Scholes, because expired option candles are not available.
import { estimateRoundTripCosts, defaultExecution } from '../../options-costs';
import { monthlyExpiry } from '../../screener/symbols';
import { bs } from '../../screener/backtest';
import { futuresRoundTripCosts, type CostBreakdown } from './costs';
import { strikeStepNear } from './symbol-master';
import type { RawTrade } from './types';

export type InstrumentKind = 'futures' | 'option';

export type PricingContext = {
  kind: InstrumentKind;
  slippageBps: number;
  capitalPerTrade: number | null; // rupees per trade; null means one lot
  lots: Map<string, number>; // underlying ticker -> lot size
  strikes: Map<string, number[]>; // underlying ticker -> listed strikes near the money
  closes: Map<string, Map<string, number>>; // symbol -> IST day -> daily close, for realised volatility
  iv: { lookbackDays: number; floor: number; fallback: number };
  riskFreeRate: number;
  fallbackLot: number | null; // used when the symbol master has no lot size; null drops the trade
};

export type PricedTrade = RawTrade & {
  ticker: string; instrument: InstrumentKind; modelled: boolean;
  lot: number; lots: number; qty: number;
  entryFill: number; exitFill: number; // the prices actually paid and received, after slippage (premiums for options)
  notional: number; grossPnl: number; costs: CostBreakdown | { total: number }; netPnl: number; netPct: number;
  option?: { type: 'CE' | 'PE'; strike: number; step: number; entryPremium: number; exitPremium: number; iv: number; ivSource: 'realised' | 'fallback' };
};

export const DEFAULT_IV = { lookbackDays: 20, floor: 0.15, fallback: 0.3 };
const tickerOf = (symbol: string) => symbol.replace(/^NSE:/, '').replace(/-EQ$/, '');
const roundTick = (v: number) => Math.round(v / 0.05) * 0.05;

// Annualised volatility from the last `lookback` daily closes before `day`; null with fewer than 10 returns.
export function realisedVol(closes: Map<string, number> | undefined, day: string, lookback: number): number | null {
  if (!closes) return null;
  const series = [...closes.entries()].filter(([d]) => d < day).sort(([a], [b]) => a.localeCompare(b)).slice(-(lookback + 1)).map(([, c]) => c);
  if (series.length < 11) return null;
  const returns = series.slice(1).map((c, i) => Math.log(c / series[i]));
  const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
  const variance = returns.reduce((a, b) => a + (b - mean) ** 2, 0) / (returns.length - 1);
  return Math.sqrt(variance) * Math.sqrt(252);
}

const daysBetween = (a: string, b: string) => (Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000;
const sessionFraction = (t: number) => {
  const minutes = new Date((t + 19_800) * 1000).getUTCHours() * 60 + new Date((t + 19_800) * 1000).getUTCMinutes();
  return Math.min(1, Math.max(0, (minutes - (9 * 60 + 15)) / 375));
};

export function priceTrade(raw: RawTrade, ctx: PricingContext): PricedTrade | null {
  const ticker = tickerOf(raw.symbol);
  const lot = ctx.lots.get(ticker) ?? ctx.fallbackLot;
  if (!lot) return null;
  const slip = ctx.slippageBps / 10_000;
  const dir = raw.direction;

  if (ctx.kind === 'futures') {
    const lots = ctx.capitalPerTrade ? Math.max(1, Math.floor(ctx.capitalPerTrade / (raw.entryPrice * lot))) : 1;
    const qty = lots * lot;
    const entryFill = raw.entryPrice * (1 + dir * slip);
    const exitFill = raw.exitPrice * (1 - dir * slip);
    const grossPnl = dir * (exitFill - entryFill) * qty;
    const costs = futuresRoundTripCosts({ entryFill, exitFill, qty, direction: dir, date: raw.day });
    const notional = raw.entryPrice * qty;
    return { ...raw, ticker, instrument: 'futures', modelled: false, lot, lots, qty, entryFill, exitFill, notional, grossPnl, costs, netPnl: grossPnl - costs.total, netPct: ((grossPnl - costs.total) / notional) * 100 };
  }

  // One strike out of the money: a call one step above the at-the-money strike after an up-cross, a put one step below after a down-cross.
  const step = strikeStepNear(ctx.strikes.get(ticker) ?? [], raw.entryPrice) ?? null;
  if (!step) return null;
  const atm = Math.round(raw.entryPrice / step) * step;
  const type = dir === 1 ? 'CE' : 'PE';
  const strike = dir === 1 ? atm + step : atm - step;
  const realised = realisedVol(ctx.closes.get(raw.symbol), raw.day, ctx.iv.lookbackDays);
  const iv = Math.max(ctx.iv.floor, realised ?? ctx.iv.fallback);
  const expiry = monthlyExpiry(raw.day);
  const left = (t: number) => Math.max(0.0005, (daysBetween(raw.day, expiry) - sessionFraction(t)) / 365);
  const call = type === 'CE';
  const entryPremium = Math.max(0.05, roundTick(bs(raw.entryPrice, strike, left(raw.entryT), iv, call, ctx.riskFreeRate)));
  const exitPremium = Math.max(0.05, roundTick(bs(raw.exitPrice, strike, left(raw.exitT), iv, call, ctx.riskFreeRate)));
  const lots = ctx.capitalPerTrade ? Math.max(1, Math.floor(ctx.capitalPerTrade / (entryPremium * lot))) : 1;
  const qty = lots * lot;
  const entryFill = entryPremium * (1 + slip); // the buyer pays up on the way in and receives less on the way out
  const exitFill = Math.max(0, exitPremium * (1 - slip));
  const grossPnl = (exitFill - entryFill) * qty;
  const costs = estimateRoundTripCosts([{ optionType: type, strike, side: 1, quantity: lots, entryPrice: entryFill }], lot, [exitFill], raw.day, raw.day, { ...defaultExecution, slippagePerUnit: 0 });
  const notional = entryFill * qty;
  return {
    ...raw, ticker, instrument: 'option', modelled: true, lot, lots, qty, entryFill, exitFill, notional, grossPnl, costs, netPnl: grossPnl - costs.total, netPct: ((grossPnl - costs.total) / notional) * 100,
    option: { type, strike, step, entryPremium, exitPremium, iv, ivSource: realised === null ? 'fallback' : 'realised' },
  };
}
