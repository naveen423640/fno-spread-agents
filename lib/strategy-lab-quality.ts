import { calculateRiskMetrics, type PayoffLeg } from './strategy-payoff';
import type { FoRow } from './backtest/types';

export const LAB_ENGINE_VERSION = 'monthly-options-eod-v2';
export type QualityIssue = { date: string; code: string; message: string };
export function observedContract(row: FoRow | undefined, date: string, expiry: string, lotSize: number) {
  if (!row) return 'Missing contract';
  if (row.tradingDate !== date || row.expiryDate !== expiry) return 'Contract date mismatch';
  if (row.lotSize !== lotSize) return 'Lot size changed; corporate-action adjustment required';
  if (!Number.isFinite(row.close) || row.close < 0) return 'Invalid closing price';
  if (row.tradedVolume <= 0) return 'No trades reported';
  if (row.close === 0) return 'Zero closing mark; no executable price';
  return null;
}

export function validateStrategyLegs(strategy: string, legs: PayoffLeg[], lotSize: number) {
  calculateRiskMetrics(legs, lotSize);
  const k = legs.map((leg) => leg.strike);
  const valid = strategy === 'bull-call' || strategy === 'bull-put' || strategy === 'bear-call' || strategy === 'long-strangle' ? k[0] < k[1]
    : strategy === 'bear-put' ? k[0] > k[1]
    : strategy === 'butterfly' ? k[0] < k[1] && k[1] < k[2]
    : strategy === 'iron-condor' ? k[0] < k[1] && k[1] < k[2] && k[2] < k[3]
    : strategy === 'long-straddle' ? k[0] === k[1] : true;
  if (!valid) throw new Error('The selected strikes are not in the valid order for this strategy.');
  if (['bull-call', 'bear-put', 'bull-put', 'bear-call', 'iron-condor'].includes(strategy) && legs.some((leg) => leg.quantity !== legs[0].quantity)) {
    throw new Error('Use equal lots on every leg of this defined-risk spread.');
  }
  if (strategy === 'butterfly' && (legs[1].quantity !== legs[0].quantity * 2 || legs[2].quantity !== legs[0].quantity)) throw new Error('A butterfly requires a 1:2:1 lot ratio.');
  const premium = legs.reduce((sum, leg) => sum + leg.side * leg.quantity * leg.entryPrice, 0);
  if (['bull-call', 'bear-put'].includes(strategy)) {
    const width = Math.abs(k[0] - k[1]) * legs[0].quantity;
    if (premium <= 0 || premium >= width) throw new Error('Selected closes do not form a valid debit spread. Choose another traded strike pair.');
  }
  if (['bull-put', 'bear-call', 'iron-condor'].includes(strategy) && premium >= 0) throw new Error('This credit strategy must receive a net credit at entry.');
}

function normalCdf(value: number) {
  const sign = value < 0 ? -1 : 1, x = Math.abs(value) / Math.sqrt(2), t = 1 / (1 + 0.3275911 * x);
  const erf = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
  return 0.5 * (1 + sign * erf);
}
export function optionValue(spot: number, strike: number, years: number, volatility: number, type: 'CE' | 'PE') {
  if (years <= 0) return type === 'CE' ? Math.max(spot - strike, 0) : Math.max(strike - spot, 0);
  const rate = 0.065, sigmaRootT = Math.max(volatility, 0.0001) * Math.sqrt(years);
  const d1 = (Math.log(Math.max(spot, 0.01) / strike) + (rate + volatility * volatility / 2) * years) / sigmaRootT, d2 = d1 - sigmaRootT;
  return type === 'CE' ? spot * normalCdf(d1) - strike * Math.exp(-rate * years) * normalCdf(d2) : strike * Math.exp(-rate * years) * normalCdf(-d2) - spot * normalCdf(-d1);
}
export function impliedVolatility(price: number, spot: number, strike: number, years: number, type: 'CE' | 'PE'): number | null {
  if (![price, spot, strike, years].every(Number.isFinite) || price < 0 || spot <= 0 || strike <= 0 || years <= 0) return null;
  const lower = optionValue(spot, strike, years, 0.0001, type), upper = optionValue(spot, strike, years, 5, type);
  if (price < lower - 0.01 || price > upper + 0.01) return null;
  let low = 0.0001, high = 5;
  for (let i = 0; i < 70; i++) { const middle = (low + high) / 2; if (optionValue(spot, strike, years, middle, type) > price) high = middle; else low = middle; }
  const sigma = (low + high) / 2;
  return Math.abs(optionValue(spot, strike, years, sigma, type) - price) <= Math.max(0.01, price * 0.0001) ? sigma : null;
}
export function yearsToExpiry(date: string, expiryDate: string) {
  return Math.max(0, (Date.parse(`${expiryDate}T15:30:00+05:30`) - Date.parse(`${date}T15:30:00+05:30`)) / (365.25 * 86400000));
}
