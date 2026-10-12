// C4 reversal values and the EOS / EOR family. LTP Calculator does not publish how EOS and EOR are calculated, so the calculation is a
// pluggable PROXY: every value carries the method that produced it and is labelled as a proxy. Pure.
import type { Levels, SideLevel } from './levels';
import type { SideStatus } from './strength';
import { istTs } from './time';
import { valueAt, type Metric, type Side, type Snapshot } from './types';

export interface ExtensionMethod {
  id: string;
  label: string;
  reversal(s: Snapshot, strike: number, side: Side): number | null;
}

// Default: where a writer of the option at this strike breaks even. Put side: strike minus the put's LTP. Call side: strike plus the call's LTP.
export const writerBreakeven: ExtensionMethod = {
  id: 'writer_breakeven',
  label: 'writer breakeven',
  reversal(s, strike, side) {
    const ltp = valueAt(s, strike, side, 'ltp');
    if (ltp === null) return null;
    return side === 'PE' ? strike - ltp : strike + ltp;
  },
};

// Same shape, but only the extrinsic (time) part of the premium is used. A premium below intrinsic value is a data glitch, so it gives null.
export const timeValueOnly: ExtensionMethod = {
  id: 'time_value_only',
  label: 'time value only',
  reversal(s, strike, side) {
    const ltp = valueAt(s, strike, side, 'ltp');
    if (ltp === null) return null;
    const intrinsic = side === 'PE' ? Math.max(strike - s.spot, 0) : Math.max(s.spot - strike, 0);
    const timeValue = ltp - intrinsic;
    if (timeValue < 0) return null;
    return side === 'PE' ? strike - timeValue : strike + timeValue;
  },
};

// Fitted to the real tool (captured 2026-10-12 about 10:30 IST, NIFTY): its extension is almost the same distance from every strike near the
// money, about a tenth of the one-sigma move left to expiry (spot x implied volatility x sqrt(time)), with the strike's own implied volatility
// backed out of its LTP. Calls sit a little further out than puts. Within about 1 point on 14 captured strikes with delta above 0.1; far out of
// the money the real tool's values shrink in a way this does not copy. Still a PROXY: the calculation is not published. Black-Scholes with zero
// interest, time measured to 15:30 IST on the expiry date.
const IV_MOVE_FRACTION: Record<Side, number> = { CE: 0.1065, PE: 0.0879 };
const YEAR_SECONDS = 365 * 86_400;
const normalCdf = (x: number): number => {
  const t = 1 / (1 + 0.2316419 * Math.abs(x));
  const tail = 0.3989423 * Math.exp((-x * x) / 2) * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
  return x > 0 ? 1 - tail : tail;
};
function impliedVol(spot: number, strike: number, years: number, ltp: number, side: Side): number | null {
  const price = (sigma: number) => {
    const root = sigma * Math.sqrt(years);
    const d1 = (Math.log(spot / strike) + 0.5 * sigma * sigma * years) / root;
    const d2 = d1 - root;
    return side === 'CE' ? spot * normalCdf(d1) - strike * normalCdf(d2) : strike * normalCdf(-d2) - spot * normalCdf(-d1);
  };
  let lo = 0.01;
  let hi = 3;
  if (ltp < price(lo) || ltp > price(hi)) return null; // below intrinsic value, or an impossible premium
  for (let i = 0; i < 60; i += 1) { const mid = (lo + hi) / 2; if (price(mid) > ltp) hi = mid; else lo = mid; }
  return (lo + hi) / 2;
}

export const ivMove: ExtensionMethod = {
  id: 'iv_move',
  label: 'IV move',
  reversal(s, strike, side) {
    const ltp = valueAt(s, strike, side, 'ltp');
    if (ltp === null || !(s.spot > 0)) return null;
    const years = (istTs(s.expiry, '15:30') - s.ts) / YEAR_SECONDS;
    if (!(years > 0)) return null;
    const sigma = impliedVol(s.spot, strike, years, ltp, side);
    if (sigma === null) return null;
    const move = IV_MOVE_FRACTION[side] * s.spot * sigma * Math.sqrt(years);
    return side === 'PE' ? strike - move : strike + move;
  },
};

export const EXTENSION_METHODS: ExtensionMethod[] = [ivMove, writerBreakeven, timeValueOnly];

export type ExtLevel = { label: string; strike: number; value: number | null; method: string; isProxy: true };
export type Extensions = { eos: ExtLevel; eor: ExtLevel; eosPlus1: ExtLevel; eorMinus1: ExtLevel; eosMinus: ExtLevel[]; eorPlus: ExtLevel[]; wtbPlus1: ExtLevel | null; wttMinus1: ExtLevel | null };

const level = (s: Snapshot, method: ExtensionMethod, name: string, strike: number, side: Side): ExtLevel => ({
  label: `${name} (proxy: ${method.label})`, strike, value: method.reversal(s, strike, side), method: method.id, isProxy: true,
});

// The strike where the weakness is: the second-highest strike of the weak metric that decided the status (the larger pct if both did).
export function weakStrike(status: SideStatus, lv: SideLevel): number | null {
  const candidates = (['volume', 'oi'] as Metric[])
    .filter((m) => status.byMetric[m].weak && status.byMetric[m].direction === status.status)
    .sort((a, b) => (status.byMetric[b].pct ?? 0) - (status.byMetric[a].pct ?? 0));
  const pick = candidates.length ? (candidates[0] === 'volume' ? lv.byVolume : lv.byOi) : null;
  return pick?.secondStrike ?? null;
}

// EOS = put-side reversal at the support strike; EOR = call-side reversal at the resistance strike; EOS-n and EOR+n step n strikes outward.
// WTB+1 (support WTB) = put-side reversal one step above the weak strike; WTT-1 (resistance WTT) = call-side reversal one step below it.
export function extensionLevels(s: Snapshot, levels: Levels, support: SideStatus, resistance: SideStatus, method: ExtensionMethod): Extensions {
  const step = s.step;
  const sup = levels.support.strike;
  const res = levels.resistance.strike;
  const wtb = support.status === 'wtb' ? weakStrike(support, levels.support) : null;
  const wtt = resistance.status === 'wtt' ? weakStrike(resistance, levels.resistance) : null;
  return {
    eos: level(s, method, 'EOS', sup, 'PE'),
    eor: level(s, method, 'EOR', res, 'CE'),
    eosPlus1: level(s, method, 'EOS+1', sup + step, 'PE'),
    eorMinus1: level(s, method, 'EOR-1', res - step, 'CE'),
    eosMinus: [1, 2].map((n) => level(s, method, `EOS-${n}`, sup - n * step, 'PE')),
    eorPlus: [1, 2].map((n) => level(s, method, `EOR+${n}`, res + n * step, 'CE')),
    wtbPlus1: wtb === null ? null : level(s, method, 'WTB+1', wtb + step, 'PE'),
    wttMinus1: wtt === null ? null : level(s, method, 'WTT-1', wtt - step, 'CE'),
  };
}
