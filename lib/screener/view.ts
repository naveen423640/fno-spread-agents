import { DEFAULT_PARAMS, validateParams, type ScreenerParams } from './config';
import { DEFAULT_RULES, validateRules, type RuleSet } from './rules';
import type { VariantView } from './service';
import type { ScanRow } from './types';

// Pure helpers for the Screener tab (filters, saved settings, job state, backtest wording). No React, no network.

// 'ALL' means no filter; sector is 'ALL' or a sector name.
export type Filters = { side: 'ALL' | ScanRow['side']; sector: string; status: 'ALL' | ScanRow['status'] };
export const DEFAULT_FILTERS: Filters = { side: 'ALL', sector: 'ALL', status: 'ALL' };

export function filterRows(rows: ScanRow[], filters: Filters): ScanRow[] {
  return rows.filter((r) => (filters.side === 'ALL' || r.side === filters.side) && (filters.sector === 'ALL' || r.sector === filters.sector) && (filters.status === 'ALL' || r.status === filters.status));
}

export const sectorsOf = (rows: ScanRow[]): string[] => [...new Set(rows.map((r) => r.sector))].sort();

export const paramsEqual = (a: ScreenerParams, b: ScreenerParams) => JSON.stringify(a) === JSON.stringify(b);

export const SETTINGS_KEY = 'fno-screener-settings-v1';

// Settings live in this browser only. Storage can be missing, blocked or hold stale data, so every path falls back to the defaults.
export function loadSettings(storage: Pick<Storage, 'getItem'> | null): ScreenerParams {
  try {
    const raw = storage?.getItem(SETTINGS_KEY);
    if (!raw) return DEFAULT_PARAMS;
    const checked = validateParams(JSON.parse(raw));
    return checked.ok ? checked.value : DEFAULT_PARAMS;
  } catch {
    return DEFAULT_PARAMS;
  }
}

export function saveSettings(storage: Pick<Storage, 'setItem'> | null, params: ScreenerParams): boolean {
  try {
    if (!storage) return false;
    storage.setItem(SETTINGS_KEY, JSON.stringify(params));
    return true;
  } catch {
    return false;
  }
}

export type JobPhase = 'idle' | 'running' | 'done' | 'login' | 'failed';
export function jobPhase(job: { status: 'running' | 'done' | 'login_required' | 'failed' } | null): JobPhase {
  if (!job) return 'idle';
  return job.status === 'login_required' ? 'login' : job.status;
}

export function halvesVerdict(variant: VariantView): string {
  const { firstHalf, secondHalf } = variant;
  if (!firstHalf || !secondHalf || firstHalf.n === 0 || secondHalf.n === 0 || firstHalf.expectancyR === undefined || secondHalf.expectancyR === undefined) return 'too few trades to split';
  return firstHalf.expectancyR > 0 && secondHalf.expectancyR > 0 ? 'positive in both halves' : 'not positive in both halves';
}

export function variantNotes(variant: VariantView, minTrades: number): string[] {
  const notes: string[] = [];
  if (variant.lowSample) notes.push(`Fewer than ${minTrades} trades (${variant.tradeCount}): too few to trust.`);
  if (variant.stats.expectancyR !== undefined && variant.stats.expectancyR <= 0) notes.push('No positive edge in this variant.');
  return notes;
}

export const RULES_KEY = 'fno-screener-rules-v1';

// Custom rules are kept in this browser only; anything missing, blocked or invalid falls back to the disabled default.
export function loadRules(storage: Pick<Storage, 'getItem'> | null): RuleSet {
  try {
    const raw = storage?.getItem(RULES_KEY);
    if (!raw) return DEFAULT_RULES;
    const checked = validateRules(JSON.parse(raw));
    return checked.ok ? checked.value : DEFAULT_RULES;
  } catch {
    return DEFAULT_RULES;
  }
}

export function saveRules(storage: Pick<Storage, 'setItem'> | null, rules: RuleSet): boolean {
  try {
    if (!storage) return false;
    storage.setItem(RULES_KEY, JSON.stringify(rules));
    return true;
  } catch {
    return false;
  }
}

// A result from before custom rules existed has no rules; that means the reference rules.
export const rulesEqual = (a: RuleSet | undefined, b: RuleSet | undefined) => JSON.stringify(a ?? DEFAULT_RULES) === JSON.stringify(b ?? DEFAULT_RULES);

export function rulesLabel(rules: RuleSet | undefined): string {
  return rules?.enabled ? `Your rules (${rules.bull.length} bull, ${rules.bear.length} bear)` : 'Reference rules';
}
