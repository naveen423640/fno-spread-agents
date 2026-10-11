import type { ScreenerParams } from './config';
import type { IndRow } from './types';

// User-defined bull and bear rules for the Screener. A rule compares one field with a number, a range, or another field times a
// multiplier. Rules on one side combine with AND. A "filter" must pass; a "trigger" is the confirmation: if every filter passes and every
// trigger passes the row is a SIGNAL, if only a trigger fails it is a WATCH (the same meaning as the reference rules).
// referenceRules() writes the built-in rules in this format; a test proves it gives identical scan results.

export const FIELDS = ['open', 'high', 'low', 'close', 'volume', 'prevHigh', 'prevLow', 'sma20', 'sma50', 'sma200', 'rsi', 'rsVsNifty', 'volRatio', 'hv20', 'hvPctile'] as const;
export type Field = (typeof FIELDS)[number];
export const OPS = ['>', '>=', '<', '<=', 'between'] as const;
export type Op = (typeof OPS)[number];
export const ROLES = ['filter', 'trigger'] as const;
export type Role = (typeof ROLES)[number];

export const FIELD_LABEL: Record<Field, string> = {
  open: 'Open',
  high: 'High',
  low: 'Low',
  close: 'Close',
  volume: 'Volume',
  prevHigh: 'Previous day high',
  prevLow: 'Previous day low',
  sma20: '20-day SMA',
  sma50: '50-day SMA',
  sma200: '200-day SMA',
  rsi: 'RSI(14)',
  rsVsNifty: 'Relative strength vs Nifty, 63-day (%)',
  volRatio: 'Volume ÷ 20-day average volume',
  hv20: '20-day realised volatility, annualised (%)',
  hvPctile: 'Realised-volatility percentile (0 to 1)',
};

export type Right = { kind: 'value'; value: number } | { kind: 'between'; low: number; high: number } | { kind: 'field'; field: Field; multiplier: number };
export type Condition = { left: Field; op: Op; right: Right; role: Role };
export type RuleSet = { enabled: boolean; bull: Condition[]; bear: Condition[] };

export const DEFAULT_RULES: RuleSet = { enabled: false, bull: [], bear: [] };
export const MAX_RULES_PER_SIDE = 20;

// Values are presented in the units a person types: relative strength and volatility in percent.
export function fieldValue(row: IndRow, field: Field): number {
  switch (field) {
    case 'rsVsNifty': return row.rs63 * 100;
    case 'hv20': return row.hv20 * 100;
    case 'hvPctile': return row.hvPct;
    default: return row[field];
  }
}

function passes(row: IndRow, cond: Condition): boolean {
  const left = fieldValue(row, cond.left);
  const { right } = cond;
  if (cond.op === 'between') return right.kind === 'between' && left >= right.low && left <= right.high;
  const target = right.kind === 'value' ? right.value : right.kind === 'field' ? fieldValue(row, right.field) * right.multiplier : Number.NaN;
  switch (cond.op) {
    case '>': return left > target;
    case '>=': return left >= target;
    case '<': return left < target;
    default: return left <= target;
  }
}

// SIGNAL: every filter and every trigger passes. WATCH: every filter passes but a trigger does not. Otherwise null. No rules, no candidates.
export function evaluateSide(row: IndRow, conditions: Condition[]): 'SIGNAL' | 'WATCH' | null {
  if (!conditions.length) return null;
  if (!conditions.filter((c) => c.role === 'filter').every((c) => passes(row, c))) return null;
  return conditions.filter((c) => c.role === 'trigger').every((c) => passes(row, c)) ? 'SIGNAL' : 'WATCH';
}

// True when every rule on the side (filters and triggers) passes: the backtest enters on these rows.
export const allPass = (row: IndRow, conditions: Condition[]): boolean => conditions.length > 0 && conditions.every((c) => passes(row, c));

// ---------------------------------------------------------------- validation

export type RulesResult = { ok: true; value: RuleSet } | { ok: false; error: string };

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const hasOnly = (o: Record<string, unknown>, keys: string[]) => Object.keys(o).every((k) => keys.includes(k));

function validateRight(op: Op, right: unknown): Right | string {
  if (!isObject(right)) return 'each rule needs a value, a range or a field to compare with';
  if (right.kind === 'between') {
    if (!hasOnly(right, ['kind', 'low', 'high'])) return 'a range has only low and high';
    if (op !== 'between') return 'a range can only be used with "between"';
    if (!finite(right.low) || !finite(right.high) || right.low >= right.high) return 'a range needs two numbers with low below high';
    return { kind: 'between', low: right.low, high: right.high };
  }
  if (op === 'between') return '"between" needs a range';
  if (right.kind === 'value') {
    if (!hasOnly(right, ['kind', 'value'])) return 'a value rule has only a value';
    if (!finite(right.value)) return 'the value must be a finite number';
    return { kind: 'value', value: right.value };
  }
  if (right.kind === 'field') {
    if (!hasOnly(right, ['kind', 'field', 'multiplier'])) return 'a field comparison has only a field and a multiplier';
    if (!(FIELDS as readonly unknown[]).includes(right.field)) return `unknown field "${String(right.field)}"`;
    if (!finite(right.multiplier) || right.multiplier <= 0) return 'the multiplier must be a number above zero';
    return { kind: 'field', field: right.field as Field, multiplier: right.multiplier };
  }
  return 'each rule needs a value, a range or a field to compare with';
}

function validateSide(name: string, list: unknown): Condition[] | string {
  if (!Array.isArray(list)) return `${name} rules must be a list`;
  if (list.length > MAX_RULES_PER_SIDE) return `${name} rules are limited to ${MAX_RULES_PER_SIDE}`;
  const out: Condition[] = [];
  for (const [index, item] of list.entries()) {
    const where = `${name} rule ${index + 1}`;
    if (!isObject(item) || !hasOnly(item, ['left', 'op', 'right', 'role'])) return `${where} is malformed`;
    if (!(FIELDS as readonly unknown[]).includes(item.left)) return `${where}: unknown field "${String(item.left)}"`;
    if (!(OPS as readonly unknown[]).includes(item.op)) return `${where}: unknown operator "${String(item.op)}"`;
    if (!(ROLES as readonly unknown[]).includes(item.role)) return `${where}: the role must be filter or trigger`;
    const right = validateRight(item.op as Op, item.right);
    if (typeof right === 'string') return `${where}: ${right}`;
    out.push({ left: item.left as Field, op: item.op as Op, right, role: item.role as Role });
  }
  return out;
}

export function validateRules(input: unknown): RulesResult {
  if (input === undefined) return { ok: true, value: DEFAULT_RULES };
  if (!isObject(input) || !hasOnly(input, ['enabled', 'bull', 'bear'])) return { ok: false, error: 'Rules must be an object with enabled, bull and bear.' };
  if (typeof input.enabled !== 'boolean') return { ok: false, error: 'enabled must be true or false.' };
  const bull = validateSide('Bull', input.bull);
  if (typeof bull === 'string') return { ok: false, error: bull };
  const bear = validateSide('Bear', input.bear);
  if (typeof bear === 'string') return { ok: false, error: bear };
  if (input.enabled && !bull.length && !bear.length) return { ok: false, error: 'Add at least one bull or bear rule, or turn custom rules off.' };
  return { ok: true, value: { enabled: input.enabled, bull, bear } };
}

// ---------------------------------------------------------------- wording

const num = (n: number) => String(Number(n.toFixed(4)));
const lowerFirst = (label: string) => label.replace(/^[A-Z][a-z]/, (m) => m.toLowerCase());
const OP_TEXT: Record<Exclude<Op, 'between'>, string> = { '>': 'is above', '>=': 'is at least', '<': 'is below', '<=': 'is at most' };

export function describeCondition(cond: Condition): string {
  const left = FIELD_LABEL[cond.left];
  const suffix = cond.role === 'trigger' ? ' (trigger)' : '';
  if (cond.op === 'between' && cond.right.kind === 'between') return `${left} is between ${num(cond.right.low)} and ${num(cond.right.high)} (inclusive)${suffix}`;
  const op = OP_TEXT[cond.op as Exclude<Op, 'between'>];
  if (cond.right.kind === 'value') return `${left} ${op} ${num(cond.right.value)}${suffix}`;
  if (cond.right.kind === 'field') {
    const right = lowerFirst(FIELD_LABEL[cond.right.field]);
    return `${left} ${op} ${cond.right.multiplier === 1 ? right : `${num(cond.right.multiplier)} × ${right}`}${suffix}`;
  }
  return `${left} ${op}${suffix}`;
}

// ---------------------------------------------------------------- the built-in rules, as custom rules

const field = (left: Field, op: Op, right: Right, role: Role = 'filter'): Condition => ({ left, op, right, role });
const vs = (f: Field, multiplier = 1): Right => ({ kind: 'field', field: f, multiplier });

export function referenceRules(p: ScreenerParams): { bull: Condition[]; bear: Condition[] } {
  const hv = field('hvPctile', '<=', { kind: 'value', value: p.hvPctMax });
  return {
    bull: [
      field('close', '>', vs('sma200')),
      field('sma50', '>', vs('sma200')),
      field('rsVsNifty', '>', { kind: 'value', value: 0 }),
      field('rsi', 'between', { kind: 'between', low: p.rsiBull[0], high: p.rsiBull[1] }),
      field('close', '<=', vs('sma20', p.nearMaUp)),
      field('close', '>=', vs('sma50', p.nearMaLo)),
      hv,
      field('close', '>', vs('prevHigh'), 'trigger'),
    ],
    bear: [
      field('close', '<', vs('sma200')),
      field('sma50', '<', vs('sma200')),
      field('rsVsNifty', '<', { kind: 'value', value: 0 }),
      field('rsi', 'between', { kind: 'between', low: p.rsiBear[0], high: p.rsiBear[1] }),
      field('close', '>=', vs('sma20', 2 - p.nearMaUp)),
      field('close', '<=', vs('sma50', 2 - p.nearMaLo)),
      hv,
      field('close', '<', vs('prevLow'), 'trigger'),
    ],
  };
}
