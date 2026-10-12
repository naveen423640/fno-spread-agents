// C4 reversal values and the EOS / EOR family. LTP Calculator does not publish how EOS and EOR are calculated, so the calculation is a
// pluggable PROXY: every value carries the method that produced it and is labelled as a proxy. Pure.
import type { Levels, SideLevel } from './levels';
import type { SideStatus } from './strength';
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

export const EXTENSION_METHODS: ExtensionMethod[] = [writerBreakeven, timeValueOnly];

export type ExtLevel = { label: string; strike: number; value: number | null; method: string; isProxy: true };
export type Extensions = { eos: ExtLevel; eor: ExtLevel; eosMinus: ExtLevel[]; eorPlus: ExtLevel[]; wtbPlus1: ExtLevel | null; wttMinus1: ExtLevel | null };

const level = (s: Snapshot, method: ExtensionMethod, name: string, strike: number, side: Side): ExtLevel => ({
  label: `${name} (proxy: ${method.label})`, strike, value: method.reversal(s, strike, side), method: method.id, isProxy: true,
});

// The strike where the weakness is: the second-highest strike of the weak metric that decided the status (the larger pct if both did).
function weakStrike(status: SideStatus, lv: SideLevel): number | null {
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
    eosMinus: [1, 2].map((n) => level(s, method, `EOS-${n}`, sup - n * step, 'PE')),
    eorPlus: [1, 2].map((n) => level(s, method, `EOR+${n}`, res + n * step, 'CE')),
    wtbPlus1: wtb === null ? null : level(s, method, 'WTB+1', wtb + step, 'PE'),
    wttMinus1: wtt === null ? null : level(s, method, 'WTT-1', wtt - step, 'CE'),
  };
}
