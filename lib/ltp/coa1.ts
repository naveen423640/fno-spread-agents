// C5 COA 1.0: the nine scenarios of (support status, resistance status), kept as a data table, not an if-chain. Display only: nothing is executed.
import type { ExtLevel, Extensions } from './extensions';
import type { Status } from './types';

export type Coa1Scenario = {
  number: number; // 1 to 9, as in the brief's table
  bias: string;
  top: string | null; // label of the top reversal (an Extensions level), null when there is none
  bottom: string | null;
  allowed: string[];
  tradable: boolean;
};

const row = (number: number, bias: string, top: string | null, bottom: string | null, allowed: string[], tradable = true): Coa1Scenario => ({ number, bias, top, bottom, allowed, tradable });
const WAIT = ['wait for a level to turn Strong'];

export const COA1_TABLE: Record<`${Status}|${Status}`, Coa1Scenario> = {
  'strong|strong': row(1, 'Both ways', 'EOR', 'EOS', ['long at EOS', 'short at EOR']),
  'strong|wtb': row(2, 'Bearish (support expected to break)', 'EOR', 'EOS-1', ['short at EOR', 'long only at EOS-1']),
  'strong|wtt': row(3, 'Bullish (resistance expected to break)', 'WTT-1', 'EOS', ['long at EOS', 'short only at WTT-1']),
  'wtb|strong': row(4, 'Bearish', 'EOR', 'WTB+1', ['short at EOR', 'long only at WTB+1']),
  'wtt|strong': row(5, 'Bullish', 'EOR+1', 'EOS', ['long at EOS', 'short only at EOR+1']),
  'wtb|wtb': row(6, 'Blood Bath (highly bearish)', 'EOR', null, ['no longs']),
  'wtt|wtt': row(7, 'Bull Run (highly bullish)', null, 'EOS', ['no shorts']),
  'wtb|wtt': row(8, 'Not tradable', null, null, WAIT, false),
  'wtt|wtb': row(9, 'Not tradable', null, null, WAIT, false),
};

export const selectCoa1 = (support: Status, resistance: Status): Coa1Scenario => COA1_TABLE[`${support}|${resistance}`];

const byLabel: Record<string, (e: Extensions) => ExtLevel | null> = {
  EOS: (e) => e.eos, EOR: (e) => e.eor, 'EOS-1': (e) => e.eosMinus[0], 'EOR+1': (e) => e.eorPlus[0], 'WTB+1': (e) => e.wtbPlus1, 'WTT-1': (e) => e.wttMinus1,
};

// The scenario's top and bottom reversal as extension levels. A label with no value (WTB+1 when the support is not WTB) gives null.
export function scenarioLevels(scenario: Coa1Scenario, ext: Extensions): { top: ExtLevel | null; bottom: ExtLevel | null } {
  const find = (label: string | null) => (label === null ? null : byLabel[label]?.(ext) ?? null);
  return { top: find(scenario.top), bottom: find(scenario.bottom) };
}

// What a reversal at each end is read as. Shown on screen only.
export const tradeMapping = (at: 'top' | 'bottom'): string[] => (at === 'bottom' ? ['buy CE', 'buy futures', 'sell PE'] : ['buy PE', 'sell futures', 'sell CE']);

// Touches of a level: each time the price comes within `tolerance` points of it after having been outside. Starting on the level counts once.
export function countHits(prices: number[], level: number | null, tolerance: number): number {
  if (level === null) return 0;
  let hits = 0;
  let inside = false;
  for (const p of prices) {
    const near = Math.abs(p - level) <= tolerance;
    if (near && !inside) hits += 1;
    inside = near;
  }
  return hits;
}

export const hitLabel = (hits: number): 'generally safe' | 'risk rising' | null => (hits <= 0 ? null : hits === 1 ? 'generally safe' : 'risk rising');
