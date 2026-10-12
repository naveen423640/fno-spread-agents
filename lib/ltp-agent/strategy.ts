// The versioned strategy: a zod schema, the few fields the reviewer may change (with bounds), and diff validation. Pure.
import { parse } from 'yaml';
import { z } from 'zod';

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'must be HH:MM');
const sides = z.object({ long: z.boolean(), short: z.boolean() }).strict();
const scenarioKeys = ['1', '2', '3', '4', '5', '6', '7', '8', '9'] as const;

export const strategySchema = z.object({
  version: z.string().regex(/^\d+\.\d+$/, 'must look like 0.1'),
  name: z.string().min(1),
  scenarios_traded: z.object(Object.fromEntries(scenarioKeys.map((k) => [k, sides])) as Record<(typeof scenarioKeys)[number], typeof sides>).strict(),
  block_scenarios: z.array(z.number().int().min(1).max(9)),
  entry_profile: z.enum(['risky', 'moderate']),
  setups_enabled: z.object({ coa1_reversal: z.boolean(), nine_twenty: z.boolean(), soc: z.boolean(), end_of_diversion: z.boolean(), risky_tug: z.boolean().default(false) }).strict(), // settings added later default to off, so a version saved before them keeps the behaviour it always had
  touch_tolerance_pts: z.number().positive(),
  window: z.object({ start: hhmm, end: hhmm, nine_twenty_start: hhmm }).strict(),
  max_hit_number: z.number().int().min(1),
  require_coa2_agree: z.boolean(),
  block_on_opposing_soc: z.boolean(),
  graph_consistent_required: z.boolean().default(false), // skip a signal when the live scenario and the knowledge graph disagree
  decide_by_graph: z.boolean().default(false), // which sides may be traded comes from the mind-map outcome (a top gives shorts, a bottom gives longs), not from the first-level scenario number
  stop_rule: z.enum(['nine_twenty', 'next_level']),
  stop_buffer_pts: z.number().nonnegative(),
  time_exit: hhmm,
  exit_on_level_shift: z.boolean(),
  risk: z.object({ max_trades_per_day: z.number().int().min(1), max_concurrent: z.number().int().min(1), daily_loss_cap_inr: z.number().positive() }).strict(),
  books: z.object({ buy: z.object({ strike: z.enum(['atm', 'otm1']) }).strict(), sell: z.object({ hedge_width: z.number().int().min(1).max(10) }).strict() }).strict(),
  fills: z.object({ slippage_ticks: z.number().nonnegative(), tick: z.number().positive(), fallback_slippage_pct: z.number().nonnegative() }).strict(),
}).strict();

export type Strategy = z.infer<typeof strategySchema>;

type Bound = { min: number; max: number; integer?: boolean } | { values: readonly (string | boolean)[] };
// Dotted paths into the strategy. Everything not listed here is off limits to the reviewer.
export const TUNABLE_FIELDS: Record<string, Bound> = {
  touch_tolerance_pts: { min: 1, max: 15 },
  max_hit_number: { min: 1, max: 5, integer: true },
  stop_buffer_pts: { min: 0, max: 30 },
  require_coa2_agree: { values: [true, false] },
  exit_on_level_shift: { values: [true, false] },
  entry_profile: { values: ['risky', 'moderate'] },
  'window.start': { values: ['09:30', '09:45', '10:00'] },
  'window.end': { values: ['13:30', '14:00', '14:30', '14:45'] },
  'risk.max_trades_per_day': { min: 1, max: 5, integer: true },
  'books.sell.hedge_width': { min: 2, max: 8, integer: true },
};

export function parseStrategy(text: string): Strategy {
  const result = strategySchema.safeParse(parse(text));
  if (!result.success) throw new Error(`Invalid strategy: ${result.error.issues.map((i) => `${i.path.join('.') || '(file)'}: ${i.message}`).join('; ')}`);
  return result.data;
}

export type DiffCheck = { ok: true } | { ok: false; reason: string };

export function validateDiff(diff: Record<string, unknown>): DiffCheck {
  const entries = Object.entries(diff);
  if (!entries.length) return { ok: false, reason: 'the diff is empty' };
  for (const [path, value] of entries) {
    const bound = TUNABLE_FIELDS[path];
    if (!bound) return { ok: false, reason: `${path} is not a tunable field` };
    if ('values' in bound) {
      if (!bound.values.includes(value as string | boolean)) return { ok: false, reason: `${path} must be one of ${bound.values.join(', ')}` };
    } else {
      if (typeof value !== 'number' || !Number.isFinite(value)) return { ok: false, reason: `${path} must be a number` };
      if (value < bound.min || value > bound.max) return { ok: false, reason: `${path} must be between ${bound.min} and ${bound.max}` };
      if (bound.integer && !Number.isInteger(value)) return { ok: false, reason: `${path} must be a whole number` };
    }
  }
  return { ok: true };
}

export function applyDiff(strategy: Strategy, diff: Record<string, unknown>): Strategy {
  const check = validateDiff(diff);
  if (!check.ok) throw new Error(`Invalid diff: ${check.reason}`);
  const next = structuredClone(strategy) as Record<string, unknown>;
  for (const [path, value] of Object.entries(diff)) {
    const keys = path.split('.');
    let node = next;
    for (const key of keys.slice(0, -1)) node = node[key] as Record<string, unknown>;
    node[keys[keys.length - 1]] = value;
  }
  return strategySchema.parse(next);
}

// The value at a dotted path such as "window.start".
export function getPath(strategy: Strategy, path: string): unknown {
  return path.split('.').reduce<unknown>((node, key) => (node as Record<string, unknown> | undefined)?.[key], strategy);
}
