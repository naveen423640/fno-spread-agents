import type { CrossType } from '../core';
import { DEFAULT_FILTERS, type ExitRule, type SignalFilters } from './types';

export type GridSpec = Partial<{ stopPct: number[]; targetR: number[]; trailPct: number[]; entryTo: string[]; firstCrossOnly: boolean[]; skipBorderline: boolean[]; minDistancePct: number[] }>;

export type BacktestConfig = {
  universe: string; // nifty_it | fo | nifty500 | sector:<name> | custom:TCS,INFY ...
  from: string; to: string; // IST dates, inclusive
  source: 'fyers' | 'cache';
  filters: SignalFilters;
  exits: ExitRule[];
  squareoffAt: string; // every strategy is flat by this time (intraday only)
  instrument: 'futures' | 'option';
  slippageBps: number;
  capitalPerTrade: number | null;
  portfolio: { maxConcurrent: number | null; marginPct: number; marginCap: number | null };
  iv: { lookbackDays: number; floor: number; fallback: number };
  holdoutFraction: number;
  bootstrapIterations: number;
  randomRuns: number;
  seed: number;
  gainersLosersTopN: number;
  grid: GridSpec | null;
};

export const DEFAULT_EXITS: ExitRule[] = [
  { name: 'opposite-cross', opposite: true },
  { name: 'square-off-1515', squareoffAt: '15:15' },
  { name: 'stop-0.5-target-2R', stopPct: 0.5, targetR: 2 },
  { name: 'trail-0.4', trailPct: 0.4 },
  { name: 'first-hit-combo', opposite: true, stopPct: 0.5, targetR: 2, trailPct: 0.6 },
];

export const DEFAULT_CONFIG: BacktestConfig = {
  universe: 'nifty_it', from: '2026-08-01', to: '2026-10-09', source: 'cache',
  filters: DEFAULT_FILTERS, exits: DEFAULT_EXITS, squareoffAt: '15:15', instrument: 'futures', slippageBps: 2, capitalPerTrade: null,
  portfolio: { maxConcurrent: null, marginPct: 0.15, marginCap: null }, iv: { lookbackDays: 20, floor: 0.15, fallback: 0.3 },
  holdoutFraction: 0.3, bootstrapIterations: 2000, randomRuns: 200, seed: 42, gainersLosersTopN: 3, grid: null,
};

const TYPES: CrossType[] = ['close-cross', 'body-cross', 'gap-cross'];
const isDate = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`));
const isTime = (v: unknown): v is string => typeof v === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(v);
const num = (v: unknown, name: string, min: number, max: number): number => {
  if (typeof v !== 'number' || !Number.isFinite(v) || v < min || v > max) throw new Error(`${name} must be a number between ${min} and ${max}.`);
  return v;
};

// Merges a user's partial config over the defaults and rejects anything that could not run.
export function parseConfig(input: unknown): BacktestConfig {
  const raw = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
  const c: BacktestConfig = { ...DEFAULT_CONFIG, ...(raw as Partial<BacktestConfig>), filters: { ...DEFAULT_FILTERS, ...(raw.filters as object | undefined) }, portfolio: { ...DEFAULT_CONFIG.portfolio, ...(raw.portfolio as object | undefined) }, iv: { ...DEFAULT_CONFIG.iv, ...(raw.iv as object | undefined) } };
  if (!isDate(c.from) || !isDate(c.to) || c.from > c.to) throw new Error('from and to must be YYYY-MM-DD dates with from not after to.');
  if (typeof c.universe !== 'string' || !c.universe) throw new Error('universe is required.');
  if (c.source !== 'fyers' && c.source !== 'cache') throw new Error('source must be "fyers" or "cache".');
  if (c.instrument !== 'futures' && c.instrument !== 'option') throw new Error('instrument must be "futures" or "option".');
  if (!isTime(c.squareoffAt)) throw new Error('squareoffAt must be HH:MM.');
  if (!isTime(c.filters.entryFrom) || !isTime(c.filters.entryTo)) throw new Error('filters.entryFrom and filters.entryTo must be HH:MM.');
  if (!c.filters.types.every((t) => TYPES.includes(t)) || !c.filters.types.length) throw new Error(`filters.types must be a non-empty list of ${TYPES.join(', ')}.`);
  if (!c.filters.directions.every((d) => d === 'up' || d === 'down') || !c.filters.directions.length) throw new Error('filters.directions must be up and/or down.');
  num(c.slippageBps, 'slippageBps', 0, 500); num(c.holdoutFraction, 'holdoutFraction', 0, 0.9); num(c.bootstrapIterations, 'bootstrapIterations', 100, 20000); num(c.randomRuns, 'randomRuns', 0, 5000);
  if (c.capitalPerTrade !== null) num(c.capitalPerTrade, 'capitalPerTrade', 1, 1e9);
  if (!Array.isArray(c.exits) || !c.exits.length) throw new Error('exits must be a non-empty list of exit rules.');
  const names = new Set<string>();
  for (const e of c.exits) {
    if (!e.name || names.has(e.name)) throw new Error('every exit rule needs a unique name.');
    names.add(e.name);
    if (e.targetR !== undefined && e.stopPct === undefined) throw new Error(`exit "${e.name}": targetR needs stopPct.`);
    if (e.stopPct !== undefined) num(e.stopPct, `${e.name}.stopPct`, 0.01, 50);
    if (e.targetR !== undefined) num(e.targetR, `${e.name}.targetR`, 0.1, 50);
    if (e.trailPct !== undefined) num(e.trailPct, `${e.name}.trailPct`, 0.01, 50);
    if (e.squareoffAt !== undefined && !isTime(e.squareoffAt)) throw new Error(`exit "${e.name}": squareoffAt must be HH:MM.`);
  }
  // Intraday only: every rule is flat by the global square-off time unless it names an earlier one.
  c.exits = c.exits.map((e) => ({ ...e, squareoffAt: e.squareoffAt && e.squareoffAt < c.squareoffAt ? e.squareoffAt : c.squareoffAt }));
  if (c.grid) {
    const combos = Object.values(c.grid).reduce((n, list) => n * (list?.length || 1), 1);
    if (combos > 200) throw new Error(`The grid has ${combos} combinations; keep it to 200 or fewer.`);
  }
  return c;
}
