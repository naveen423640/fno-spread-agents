# Markov Regime Tab Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a display-only "Markov regime" tab that labels each session Bull / Sideways / Bear for one F&O stock, builds the transition matrix, and shows n-step forecasts, a signal score and a rule decision.

**Architecture:** Pure, I/O-free maths in `lib/regime/` (labels, matrix, stationary, forecast, decision, validation, one `analyzeRegime` orchestrator). A thin data layer fetches daily FYERS candles. A `GET /api/regime` route validates parameters, fetches, analyses and returns JSON. A client component renders it with Recharts. Nothing touches the other tabs.

**Tech Stack:** TypeScript, Next-style app on `vinext`, Recharts 3.8, Vitest 5, existing FYERS history integration (`fyersCredentials`).

**Spec:** the brief in the conversation ("Build task: Markov regime tab"), `tests/fixtures/regime-fixture.json` (maths source of truth), `docs/design/markov-regime-tab-mockup.dc.html` and `Markov regime tab.pdf` (layout only; numbers are synthetic).

## Global Constraints

- Display and analysis only. No orders, spreads, backtests, agents, Paperclip, Python engine, or changes to the other tabs.
- No FYERS order endpoints. Never read or print `.env*` secrets.
- State order in all maths, matrices and vectors is `[Bear, Sideways, Bull]`. Rows = from, columns = to.
- Method `vol`: `r_t = ln(C_t/C_{t-1})`; `σ_t` = sample std (ddof = 1) of `r` over sessions `t-60 … t-1` (excludes day t); `z_t = ln(C_t/C_{t-w}) / (σ_t·√w)`; Bull if `z > +1.0`, Bear if `z < -1.0`, else Sideways; strict comparisons; label `null` when `t < w` or `t < 61`.
- Method `fixed`: `p_t = C_t/C_{t-w} - 1` (simple return); Bull if `p > 0.05`, Bear if `p < -0.05`, else Sideways; strict; `null` when `t < w`. Never label warm-up days Sideways.
- Windows `∈ {10, 20, 40, 60}`, methods `∈ {vol, fixed}`, horizons `∈ {1, 5, 10}`.
- Matrix: count `label(t-1) → label(t)` where both are defined; row-normalise; an empty row stays all zeros with a UI warning.
- Stationary: least-squares solution of `π(P − I) = 0`, `Σπ = 1`, within 1e-9 of the fixture.
- Forecast: row of `Pⁿ` for the last label, `n ∈ {1, 5, 10}`. Score = `P(Bull) − P(Bear)`. Decision: `score ≥ +θ` → "Long candidate"; `score ≤ −θ` → "Short candidate"; else "No trade". `θ` from config, default `0.20`, labelled "placeholder, fixed in development".
- Fewer than 252 defined labels → show "Not enough history"; no matrix, forecast or decision.
- With as-of date `T`, use only closes on or before `T`. A test proves appending future closes changes nothing.
- Daily closes from the existing FYERS history integration, at least 2 years. Split/bonus adjustment must be checked with evidence, not assumed. If not adjusted, flag any `|ln(C_t/C_{t-1})| > 0.25` as a possible corporate action with a warning banner and the dates.
- Missing token / missing data / stale data → clear error or stale state. Never fabricated values.
- Header says "last close" when the market is shut, not "FYERS live".
- UI: Recharts (price line with `ReferenceArea` regime bands and the window box; metric panel with dashed threshold lines), 3×3 matrix with 1-step / n-step toggle and today's row highlighted, long-run mix bars, forecast-path chart, recent-changes list, caveats box. Real `<button>` / `<label>` elements, keyboard-accessible, colour plus text labels.
- Tests live in `lib/regime/*.test.ts` and must pass fixture parity for all 8 cases (labels and counts exact; probabilities within 1e-9).
- Report anything unverified as unverified.

## Decisions taken (please confirm or change at plan approval)

1. **Display order:** the mockup shows Bull, Sideways, Bear; the maths is `[Bear, Sideways, Bull]`. Compute in maths order; a view helper reorders for display, with tests pinning both.
2. **Today's candle:** a daily FYERS candle for today is partial while the market is open. Drop it unless it is a trading weekday and past 15:30 IST.
3. **Empty row for today's state:** if the last label's row has no observed transitions, the forecast is unavailable ("no transitions observed from this state"); the decision is "No trade" with that reason, never a fake zero score.
4. **Stale rule:** stale when the newest candle is older than the last completed weekday session. There is no holiday list yet, so the UI says "possibly stale".
5. **Missing days:** labels use session index, so a gap silently widens a window. Gaps longer than 7 calendar days are reported as a warning; labels are not altered.
6. **Unsorted input is sorted; duplicate dates are rejected.**
7. **Test location:** add `lib/**/*.test.ts` to the vitest include list, as the brief requires.
8. **Live verification uses option B:** you add `FYERS_ACCESS_TOKEN` to `.env.local` in `fno-spread-agents` and restart the dev server. I never read that file. FYERS tokens expire daily, so the token needs refreshing each day it is used.

## Review Focus

- Today's still-forming candle at 10:00 IST is treated as a completed close. Expected: it is dropped and the as-of date is the previous completed session. Owner: Task 6.
- The last label's transition row is empty (state seen once, at the end). Expected: forecast unavailable with an explanation, not "score 0 → No trade". Owner: Task 4.
- A flat price series (σ = 0). Expected: label undefined, no `NaN`/`Infinity` in any output. Owner: Task 2.
- A newly listed stock with fewer than 313 sessions of history. Expected: "Not enough history", no matrix. Owner: Task 4.
- Expired or missing FYERS token while the tab is open. Expected: a clear "Connect FYERS" state (HTTP 401 from the route), no stale numbers from the previous stock. Owner: Task 7 and Task 9.

## File Structure

| File | Responsibility |
|---|---|
| `lib/regime/types.ts` | `STATES`, `Label`, `Method`, window/horizon lists, `Candle`, `RegimeInputError` |
| `lib/regime/config.ts` | thresholds, `θ`, minimum labels, corporate-action threshold |
| `lib/regime/validate.ts` | candle validation, as-of truncation, gap and corporate-action detection |
| `lib/regime/labels.ts` | `labelSeries` for both methods |
| `lib/regime/matrix.ts` | counts, row-normalise, matrix power, time share |
| `lib/regime/stationary.ts` | least-squares stationary distribution |
| `lib/regime/forecast.ts` | `forecastRow`, `signalScore`, `forecastPath` |
| `lib/regime/decision.ts` | `decide` |
| `lib/regime/analyze.ts` | `analyzeRegime` orchestrator, `RegimeAnalysis` type |
| `lib/regime/view.ts` | display helpers: run-length bands, display order, formatting |
| `lib/regime/params.ts` | `parseRegimeParams` (query validation) |
| `lib/regime/fyers-daily.ts` | chunked daily-candle fetch, epoch → IST date, drop incomplete candle |
| `lib/regime/api-types.ts` | `RegimeResponse` shared by route and UI |
| `lib/market-session.ts` (modify) | `lastCompletedSession(now)` helper |
| `app/api/regime/route.ts` | `GET /api/regime` |
| `app/markov-regime.tsx` | the tab UI |
| `app/page.tsx` (modify) | add the tab button and render branch |
| `vitest.config.ts` (modify) | include `lib/**/*.test.ts` |
| `scripts/probe-fyers-adjustment.mjs` | evidence probe for the split/bonus question |
| `docs/verification/markov/` | evidence: adjustment findings, screenshots, review notes |

---

### Task 0: Baseline and test wiring

**Files:**
- Modify: `vitest.config.ts`
- Commit: `docs/design/markov-regime-tab-mockup.dc.html`, `tests/fixtures/regime-fixture.json`

**Interfaces:**
- Produces: `npx vitest run` picks up both `tests/**/*.test.ts` and `lib/**/*.test.ts`.

- [ ] **Step 1: Confirm the baseline exists**

Run: `git -c safe.directory='*' log --oneline | tail -1`
Expected: `ed49b10 Baseline: untouched copy of fno-heatmap-cloud`. (Commits already exist, so no new baseline is needed.)

- [ ] **Step 2: Confirm tests and app run**

Run: `npx vitest run` → Expected: all existing tests pass (17 at plan time).
Run: `curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/` → Expected: `200` (start `npm run dev` first if not running).

- [ ] **Step 3: Extend the vitest include list**

In `vitest.config.ts` change the include line to:

```ts
  test: { environment: 'node', include: ['tests/**/*.test.ts', 'lib/**/*.test.ts'] },
```

- [ ] **Step 4: Commit inputs and config**

```bash
git add vitest.config.ts docs/design tests/fixtures
git commit -m "chore: add regime mockup and fixture; run lib tests in vitest"
```

---

### Task 1: Types, config and input validation

**Files:**
- Create: `lib/regime/types.ts`, `lib/regime/config.ts`, `lib/regime/validate.ts`
- Test: `lib/regime/validate.test.ts`

**Interfaces:**
- Produces:
  - `STATES: readonly ['Bear','Sideways','Bull']`, `type State`, `type Label = State | null`, `type Method`, `type LabelWindow = 10|20|40|60`, `type Horizon = 1|5|10`, `WINDOWS`, `METHODS`, `HORIZONS`, `type Matrix = number[][]`, `type Candle = { date: string; close: number }`, `class RegimeInputError extends Error`.
  - `REGIME_CONFIG`.
  - `validateCandles(input: Candle[]): Candle[]` (sorted copy; throws `RegimeInputError` on duplicate date, bad date, non-positive or non-finite close).
  - `truncateAsOf(candles: Candle[], asOf: string): Candle[]`.
  - `findGaps(candles: Candle[], maxCalendarDays?: number): { from: string; to: string; days: number }[]`.
  - `flagPossibleCorporateActions(candles: Candle[], threshold?: number): { date: string; previousClose: number; close: number; logReturn: number }[]`.

- [ ] **Step 1: Write the failing test** `lib/regime/validate.test.ts`

```ts
import { describe, expect, it } from 'vitest';

import { RegimeInputError } from './types';
import { findGaps, flagPossibleCorporateActions, truncateAsOf, validateCandles } from './validate';

const c = (date: string, close: number) => ({ date, close });

describe('validateCandles', () => {
  it('sorts unsorted input ascending by date', () => {
    const out = validateCandles([c('2026-01-03', 3), c('2026-01-01', 1), c('2026-01-02', 2)]);
    expect(out.map((x) => x.date)).toEqual(['2026-01-01', '2026-01-02', '2026-01-03']);
  });

  it('does not mutate its input', () => {
    const input = [c('2026-01-02', 2), c('2026-01-01', 1)];
    validateCandles(input);
    expect(input[0].date).toBe('2026-01-02');
  });

  it('rejects duplicate dates', () => {
    expect(() => validateCandles([c('2026-01-01', 1), c('2026-01-01', 2)])).toThrow(RegimeInputError);
  });

  it('rejects non-positive, NaN and infinite closes', () => {
    for (const bad of [0, -5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => validateCandles([c('2026-01-01', bad)])).toThrow(RegimeInputError);
    }
  });

  it('rejects malformed dates', () => {
    expect(() => validateCandles([c('01/01/2026', 1)])).toThrow(RegimeInputError);
  });
});

describe('truncateAsOf', () => {
  it('keeps only closes on or before the as-of date', () => {
    const out = truncateAsOf([c('2026-01-01', 1), c('2026-01-02', 2), c('2026-01-03', 3)], '2026-01-02');
    expect(out.map((x) => x.date)).toEqual(['2026-01-01', '2026-01-02']);
  });
});

describe('findGaps', () => {
  it('reports gaps longer than the limit and ignores normal weekends', () => {
    const gaps = findGaps([c('2026-01-02', 1), c('2026-01-05', 1), c('2026-01-20', 1)], 7);
    expect(gaps).toEqual([{ from: '2026-01-05', to: '2026-01-20', days: 15 }]);
  });
});

describe('flagPossibleCorporateActions', () => {
  it('flags a >0.25 log move in either direction and lists the date', () => {
    const flags = flagPossibleCorporateActions([c('2026-01-01', 100), c('2026-01-02', 20), c('2026-01-03', 21), c('2026-01-04', 90)]);
    expect(flags.map((f) => f.date)).toEqual(['2026-01-02', '2026-01-04']);
    expect(flags[0].logReturn).toBeCloseTo(Math.log(0.2), 10);
  });

  it('does not flag a move of exactly the threshold', () => {
    const close = 100 * Math.exp(0.25);
    expect(flagPossibleCorporateActions([c('2026-01-01', 100), c('2026-01-02', close)])).toEqual([]);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run lib/regime/validate.test.ts`
Expected: FAIL (cannot resolve `./types` / `./validate`).

- [ ] **Step 3: Implement**

`lib/regime/types.ts`:

```ts
export const STATES = ['Bear', 'Sideways', 'Bull'] as const;
export type State = (typeof STATES)[number];
export type Label = State | null;
export type Method = 'vol' | 'fixed';
export const METHODS = ['vol', 'fixed'] as const;
export const WINDOWS = [10, 20, 40, 60] as const;
export type LabelWindow = (typeof WINDOWS)[number];
export const HORIZONS = [1, 5, 10] as const;
export type Horizon = (typeof HORIZONS)[number];
export type Matrix = number[][];
export type Candle = { date: string; close: number };

export class RegimeInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RegimeInputError';
  }
}
```

`lib/regime/config.ts`:

```ts
export const REGIME_CONFIG = {
  theta: 0.2, // placeholder, fixed in development
  minLabels: 252,
  volLookback: 60,
  volThreshold: 1.0,
  fixedThreshold: 0.05,
  corporateActionLogMove: 0.25,
  gapCalendarDays: 7,
  recentChanges: 8,
  forecastPathSteps: 10,
} as const;
```

`lib/regime/validate.ts`:

```ts
import { REGIME_CONFIG } from './config';
import { RegimeInputError, type Candle } from './types';

const DAY_MS = 86_400_000;

export function validateCandles(input: Candle[]): Candle[] {
  const seen = new Set<string>();
  for (const candle of input) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(candle.date)) throw new RegimeInputError(`Invalid date "${candle.date}".`);
    if (!Number.isFinite(candle.close) || candle.close <= 0) throw new RegimeInputError(`Invalid close for ${candle.date}.`);
    if (seen.has(candle.date)) throw new RegimeInputError(`Duplicate date ${candle.date}.`);
    seen.add(candle.date);
  }
  return [...input].sort((a, b) => a.date.localeCompare(b.date));
}

export function truncateAsOf(candles: Candle[], asOf: string): Candle[] {
  return candles.filter((candle) => candle.date <= asOf);
}

function daysBetween(from: string, to: string) {
  return Math.round((new Date(`${to}T00:00:00Z`).getTime() - new Date(`${from}T00:00:00Z`).getTime()) / DAY_MS);
}

export function findGaps(candles: Candle[], maxCalendarDays: number = REGIME_CONFIG.gapCalendarDays) {
  const gaps: { from: string; to: string; days: number }[] = [];
  for (let i = 1; i < candles.length; i += 1) {
    const days = daysBetween(candles[i - 1].date, candles[i].date);
    if (days > maxCalendarDays) gaps.push({ from: candles[i - 1].date, to: candles[i].date, days });
  }
  return gaps;
}

export function flagPossibleCorporateActions(candles: Candle[], threshold: number = REGIME_CONFIG.corporateActionLogMove) {
  const flags: { date: string; previousClose: number; close: number; logReturn: number }[] = [];
  for (let i = 1; i < candles.length; i += 1) {
    const logReturn = Math.log(candles[i].close / candles[i - 1].close);
    if (Math.abs(logReturn) > threshold) flags.push({ date: candles[i].date, previousClose: candles[i - 1].close, close: candles[i].close, logReturn });
  }
  return flags;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run lib/regime/validate.test.ts` → Expected: PASS (9 tests). If the exact-threshold test fails because of floating point, compare with a close computed as `100 * Math.exp(0.25)` and keep the strict `>`; do not loosen the rule.

- [ ] **Step 5: Commit**

```bash
git add lib/regime
git commit -m "feat(regime): types, config and input validation"
```

---

### Task 2: Labelling (both methods)

**Files:**
- Create: `lib/regime/labels.ts`
- Test: `lib/regime/labels.test.ts`

**Interfaces:**
- Consumes: `Label`, `Method`, `LabelWindow`, `REGIME_CONFIG`.
- Produces: `labelSeries(closes: number[], window: LabelWindow, method: Method): { labels: Label[]; metric: (number | null)[] }`. `metric` is `z` for `vol`, `p` for `fixed`, `null` where the label is undefined.

- [ ] **Step 1: Write the failing test** `lib/regime/labels.test.ts`

```ts
import { describe, expect, it } from 'vitest';

import fixture from '@/tests/fixtures/regime-fixture.json';

import { labelSeries } from './labels';
import type { LabelWindow, Method } from './types';

describe('labelSeries against the fixture', () => {
  for (const item of fixture.cases) {
    it(`labels exactly for window ${item.window} / ${item.method}`, () => {
      const { labels } = labelSeries(fixture.closes, item.window as LabelWindow, item.method as Method);
      expect(labels).toEqual(item.labels);
    });
  }
});

describe('labelSeries rules', () => {
  const rising = Array.from({ length: 120 }, (_, i) => 100 * 1.001 ** i);

  it('fixed: undefined before t = window, and never Sideways by default in warm-up', () => {
    const { labels } = labelSeries(rising, 10, 'fixed');
    expect(labels.slice(0, 10).every((l) => l === null)).toBe(true);
    expect(labels[10]).not.toBeNull();
  });

  it('vol: undefined before t = 61 even when the window is small', () => {
    const { labels } = labelSeries(rising, 10, 'vol');
    expect(labels.slice(0, 61).every((l) => l === null)).toBe(true);
  });

  it('vol: excludes day t from sigma (a jump on day t does not shrink its own z)', () => {
    const base = Array.from({ length: 80 }, (_, i) => 100 + (i % 2 === 0 ? 0.5 : -0.5));
    const jump = [...base, 130];
    const { metric } = labelSeries(jump, 10, 'vol');
    const t = jump.length - 1;
    const returns = base.slice(1).map((c, i) => Math.log(c / base[i]));
    const window60 = returns.slice(returns.length - 60);
    const mean = window60.reduce((a, b) => a + b, 0) / 60;
    const sigma = Math.sqrt(window60.reduce((s, v) => s + (v - mean) ** 2, 0) / 59);
    expect(metric[t]).toBeCloseTo(Math.log(130 / jump[t - 10]) / (sigma * Math.sqrt(10)), 10);
  });

  it('uses strict comparisons at the fixed thresholds', () => {
    const closes = [...Array(10).fill(100), 105];
    expect(labelSeries(closes, 10, 'fixed').labels[10]).toBe('Sideways');
    const down = [...Array(10).fill(100), 95];
    expect(labelSeries(down, 10, 'fixed').labels[10]).toBe('Sideways');
    const bull = [...Array(10).fill(100), 105.01];
    expect(labelSeries(bull, 10, 'fixed').labels[10]).toBe('Bull');
  });

  it('flat prices: vol labels stay undefined and no metric is NaN or Infinity', () => {
    const flat = Array(200).fill(100);
    const vol = labelSeries(flat, 20, 'vol');
    expect(vol.labels.every((l) => l === null)).toBe(true);
    expect(vol.metric.every((m) => m === null)).toBe(true);
    const fixed = labelSeries(flat, 20, 'fixed');
    expect(fixed.metric.filter((m) => m !== null).every((m) => Number.isFinite(m as number))).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run lib/regime/labels.test.ts` → Expected: FAIL (`./labels` missing).

- [ ] **Step 3: Implement** `lib/regime/labels.ts`

```ts
import { REGIME_CONFIG } from './config';
import type { Label, LabelWindow, Method } from './types';

function sampleStd(values: number[]) {
  const n = values.length;
  const mean = values.reduce((sum, value) => sum + value, 0) / n;
  return Math.sqrt(values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (n - 1));
}

export function labelSeries(closes: number[], window: LabelWindow, method: Method) {
  const labels: Label[] = Array(closes.length).fill(null);
  const metric: (number | null)[] = Array(closes.length).fill(null);
  const logReturns = closes.map((close, i) => (i === 0 ? Number.NaN : Math.log(close / closes[i - 1])));
  const lookback = REGIME_CONFIG.volLookback;

  for (let t = 0; t < closes.length; t += 1) {
    if (t < window) continue;
    if (method === 'fixed') {
      const p = closes[t] / closes[t - window] - 1;
      metric[t] = p;
      labels[t] = p > REGIME_CONFIG.fixedThreshold ? 'Bull' : p < -REGIME_CONFIG.fixedThreshold ? 'Bear' : 'Sideways';
      continue;
    }
    if (t < lookback + 1) continue;
    const sigma = sampleStd(logReturns.slice(t - lookback, t));
    if (!Number.isFinite(sigma) || sigma <= 0) continue;
    const z = Math.log(closes[t] / closes[t - window]) / (sigma * Math.sqrt(window));
    metric[t] = z;
    labels[t] = z > REGIME_CONFIG.volThreshold ? 'Bull' : z < -REGIME_CONFIG.volThreshold ? 'Bear' : 'Sideways';
  }
  return { labels, metric };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run lib/regime/labels.test.ts` → Expected: PASS, including all 8 fixture label cases. If a fixture case differs, stop and investigate with `superpowers:systematic-debugging`; do not change the maths to fit.

- [ ] **Step 5: Commit**

```bash
git add lib/regime/labels.ts lib/regime/labels.test.ts
git commit -m "feat(regime): vol and fixed labelling with fixture parity"
```

---

### Task 3: Matrix, stationary distribution, forecast, decision

**Files:**
- Create: `lib/regime/matrix.ts`, `lib/regime/stationary.ts`, `lib/regime/forecast.ts`, `lib/regime/decision.ts`
- Test: `lib/regime/maths.test.ts`

**Interfaces:**
- Consumes: `Label`, `State`, `STATES`, `Matrix`, `REGIME_CONFIG`.
- Produces:
  - `countTransitions(labels: Label[]): number[][]`
  - `normalizeRows(counts: number[][]): { matrix: Matrix; emptyRows: number[] }`
  - `matrixPower(matrix: Matrix, n: number): Matrix`
  - `timeShare(labels: Label[]): number[]`
  - `stationaryDistribution(matrix: Matrix): number[] | null`
  - `forecastRow(matrix: Matrix, from: State, n: number): number[] | null` (null when `from`'s row is empty)
  - `signalScore(row: number[]): number` (`row[2] − row[0]`)
  - `forecastPath(matrix: Matrix, from: State, steps?: number): { step: number; probs: number[] }[]` (step 0 is the indicator row)
  - `type Decision = 'Long candidate' | 'Short candidate' | 'No trade'`, `decide(score: number, theta?: number): Decision`

- [ ] **Step 1: Write the failing test** `lib/regime/maths.test.ts`

```ts
import { describe, expect, it } from 'vitest';

import fixture from '@/tests/fixtures/regime-fixture.json';

import { decide } from './decision';
import { forecastPath, forecastRow, signalScore } from './forecast';
import { labelSeries } from './labels';
import { countTransitions, matrixPower, normalizeRows, timeShare } from './matrix';
import { stationaryDistribution } from './stationary';
import type { LabelWindow, Method, State } from './types';

const close = (a: number[] | null, b: number[], tol = 1e-9) => {
  expect(a).not.toBeNull();
  a!.forEach((value, i) => expect(Math.abs(value - b[i])).toBeLessThan(tol));
};

describe('maths against the fixture', () => {
  for (const item of fixture.cases) {
    describe(`window ${item.window} / ${item.method}`, () => {
      const { labels } = labelSeries(fixture.closes, item.window as LabelWindow, item.method as Method);
      const counts = countTransitions(labels);
      const { matrix } = normalizeRows(counts);

      it('counts exactly', () => expect(counts).toEqual(item.counts));
      it('matrix within 1e-9', () => item.matrix.forEach((row, i) => close(matrix[i], row)));
      it('stationary within 1e-9', () => close(stationaryDistribution(matrix), item.stationary));
      it('time share within 1e-9', () => close(timeShare(labels), item.timeShare));
      it('forecasts and scores within 1e-9', () => {
        for (const n of [1, 5, 10]) {
          const row = forecastRow(matrix, item.current as State, n);
          close(row, (item.forecast as Record<string, number[]>)[String(n)]);
          expect(Math.abs(signalScore(row!) - (item.score as Record<string, number>)[String(n)])).toBeLessThan(1e-9);
        }
      });
    });
  }
});

describe('matrix edge cases', () => {
  it('leaves an empty row as zeros and reports it', () => {
    const { matrix, emptyRows } = normalizeRows([[0, 0, 0], [1, 1, 0], [0, 0, 2]]);
    expect(matrix[0]).toEqual([0, 0, 0]);
    expect(matrix[1]).toEqual([0.5, 0.5, 0]);
    expect(emptyRows).toEqual([0]);
  });

  it('matrixPower(P, 0) is the identity and P^1 is P', () => {
    const P = [[0.5, 0.5, 0], [0.2, 0.6, 0.2], [0, 0.4, 0.6]];
    expect(matrixPower(P, 0)).toEqual([[1, 0, 0], [0, 1, 0], [0, 0, 1]]);
    expect(matrixPower(P, 1)).toEqual(P);
  });

  it('counts only consecutive pairs where both labels are defined', () => {
    expect(countTransitions([null, 'Bull', 'Bull', null, 'Bear', 'Bull'])).toEqual([[0, 0, 1], [0, 0, 0], [0, 0, 1]]);
  });

  it('forecastRow is null when the from-state row is empty; forecastPath starts at the indicator row', () => {
    const P = [[0, 0, 0], [0.5, 0.5, 0], [0, 0.5, 0.5]];
    expect(forecastRow(P, 'Bear', 5)).toBeNull();
    expect(forecastPath(P, 'Sideways', 2).map((s) => s.step)).toEqual([0, 1, 2]);
    expect(forecastPath(P, 'Sideways', 2)[0].probs).toEqual([0, 1, 0]);
  });

  it('stationaryDistribution returns null when the system is singular', () => {
    expect(stationaryDistribution([[0, 0, 0], [0, 0, 0], [0, 0, 0]])).toBeNull();
  });
});

describe('decide', () => {
  it('applies inclusive thresholds at theta', () => {
    expect(decide(0.2, 0.2)).toBe('Long candidate');
    expect(decide(-0.2, 0.2)).toBe('Short candidate');
    expect(decide(0.19, 0.2)).toBe('No trade');
    expect(decide(-0.19, 0.2)).toBe('No trade');
  });

  it('defaults theta to the configured 0.20', () => {
    expect(decide(0.25)).toBe('Long candidate');
    expect(decide(0.1)).toBe('No trade');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run lib/regime/maths.test.ts` → Expected: FAIL (modules missing).

- [ ] **Step 3: Implement**

`lib/regime/matrix.ts`:

```ts
import { STATES, type Label, type Matrix } from './types';

const index = (state: NonNullable<Label>) => STATES.indexOf(state);

export function countTransitions(labels: Label[]): number[][] {
  const counts = STATES.map(() => STATES.map(() => 0));
  for (let t = 1; t < labels.length; t += 1) {
    const from = labels[t - 1];
    const to = labels[t];
    if (from && to) counts[index(from)][index(to)] += 1;
  }
  return counts;
}

export function normalizeRows(counts: number[][]): { matrix: Matrix; emptyRows: number[] } {
  const emptyRows: number[] = [];
  const matrix = counts.map((row, i) => {
    const total = row.reduce((sum, value) => sum + value, 0);
    if (total === 0) {
      emptyRows.push(i);
      return row.map(() => 0);
    }
    return row.map((value) => value / total);
  });
  return { matrix, emptyRows };
}

function multiply(a: Matrix, b: Matrix): Matrix {
  return a.map((row) => b[0].map((_, j) => row.reduce((sum, value, k) => sum + value * b[k][j], 0)));
}

export function matrixPower(matrix: Matrix, n: number): Matrix {
  let result: Matrix = matrix.map((row, i) => row.map((_, j) => (i === j ? 1 : 0)));
  for (let step = 0; step < n; step += 1) result = multiply(result, matrix);
  return result;
}

export function timeShare(labels: Label[]): number[] {
  const counts = [0, 0, 0];
  for (const label of labels) if (label) counts[index(label)] += 1;
  const total = counts.reduce((sum, value) => sum + value, 0);
  return total === 0 ? counts : counts.map((value) => value / total);
}
```

`lib/regime/stationary.ts`:

```ts
import type { Matrix } from './types';

// Least squares for [P^T - I; 1 1 1] * pi = [0 0 0 1], solved through the 3x3 normal equations.
export function stationaryDistribution(matrix: Matrix): number[] | null {
  const rows: number[][] = [0, 1, 2].map((i) => [0, 1, 2].map((j) => matrix[j][i] - (i === j ? 1 : 0)));
  rows.push([1, 1, 1]);
  const target = [0, 0, 0, 1];
  const a = [0, 1, 2].map((i) => [0, 1, 2].map((j) => rows.reduce((sum, row) => sum + row[i] * row[j], 0)));
  const b = [0, 1, 2].map((i) => rows.reduce((sum, row, k) => sum + row[i] * target[k], 0));

  for (let col = 0; col < 3; col += 1) {
    let pivot = col;
    for (let r = col + 1; r < 3; r += 1) if (Math.abs(a[r][col]) > Math.abs(a[pivot][col])) pivot = r;
    if (Math.abs(a[pivot][col]) < 1e-12) return null;
    [a[col], a[pivot]] = [a[pivot], a[col]];
    [b[col], b[pivot]] = [b[pivot], b[col]];
    for (let r = col + 1; r < 3; r += 1) {
      const factor = a[r][col] / a[col][col];
      for (let c = col; c < 3; c += 1) a[r][c] -= factor * a[col][c];
      b[r] -= factor * b[col];
    }
  }
  const pi = [0, 0, 0];
  for (let r = 2; r >= 0; r -= 1) {
    let sum = b[r];
    for (let c = r + 1; c < 3; c += 1) sum -= a[r][c] * pi[c];
    pi[r] = sum / a[r][r];
  }
  return pi;
}
```

`lib/regime/forecast.ts`:

```ts
import { REGIME_CONFIG } from './config';
import { matrixPower } from './matrix';
import { STATES, type Matrix, type State } from './types';

export function forecastRow(matrix: Matrix, from: State, n: number): number[] | null {
  const start = STATES.indexOf(from);
  if (matrix[start].every((value) => value === 0)) return null;
  return matrixPower(matrix, n)[start];
}

export function signalScore(row: number[]): number {
  return row[2] - row[0];
}

export function forecastPath(matrix: Matrix, from: State, steps: number = REGIME_CONFIG.forecastPathSteps) {
  const start = STATES.indexOf(from);
  return Array.from({ length: steps + 1 }, (_, step) => ({ step, probs: matrixPower(matrix, step)[start] }));
}
```

`lib/regime/decision.ts`:

```ts
import { REGIME_CONFIG } from './config';

export type Decision = 'Long candidate' | 'Short candidate' | 'No trade';

export function decide(score: number, theta: number = REGIME_CONFIG.theta): Decision {
  if (score >= theta) return 'Long candidate';
  if (score <= -theta) return 'Short candidate';
  return 'No trade';
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run lib/regime/maths.test.ts` → Expected: PASS. The `stationary within 1e-9` cases are the risk: if any fails, replace the normal-equation solve with a Householder QR least-squares solve (still 3 unknowns); do not loosen the tolerance.

- [ ] **Step 5: Commit**

```bash
git add lib/regime
git commit -m "feat(regime): matrix, stationary, forecast and decision with fixture parity"
```

---

### Task 4: `analyzeRegime` orchestrator, edge cases, no-future-data proof

**Files:**
- Create: `lib/regime/analyze.ts`
- Test: `lib/regime/analyze.test.ts`

**Interfaces:**
- Consumes: everything from Tasks 1–3.
- Produces:

```ts
export type RegimeAnalysis = {
  asOf: string | null;            // date of the last session used
  sessions: number;
  window: LabelWindow; method: Method; horizon: Horizon; theta: number;
  dates: string[]; closes: number[]; labels: Label[]; metric: (number | null)[];
  definedLabels: number;
  insufficientHistory: boolean;
  current: State | null; runLength: number;
  windowMove: number | null;      // simple return over the window, C_t/C_{t-w} - 1
  metricNow: number | null;       // z (vol) or p (fixed)
  counts: number[][] | null; matrix: Matrix | null; emptyRows: number[];
  stationary: number[] | null; timeShare: number[] | null;
  forecast: Record<'1' | '5' | '10', number[] | null> | null;
  score: Record<'1' | '5' | '10', number | null> | null;
  forecastPath: { step: number; probs: number[] }[] | null;
  nStepMatrix: Matrix | null;     // P^horizon, all nine cells
  decision: Decision | null; decisionNote: string | null;
  recentChanges: { date: string; from: State; to: State }[];
  corporateActionFlags: ReturnType<typeof flagPossibleCorporateActions>;
  gaps: ReturnType<typeof findGaps>;
};
export function analyzeRegime(input: { candles: Candle[]; asOf: string; window: LabelWindow; method: Method; horizon: Horizon; theta?: number }): RegimeAnalysis;
```

- [ ] **Step 1: Write the failing test** `lib/regime/analyze.test.ts`

```ts
import { describe, expect, it } from 'vitest';

import fixture from '@/tests/fixtures/regime-fixture.json';

import { analyzeRegime } from './analyze';
import type { Candle, LabelWindow, Method } from './types';

const candles: Candle[] = fixture.dates.map((date, i) => ({ date, close: fixture.closes[i] }));
const last = fixture.dates.at(-1)!;

describe('analyzeRegime fixture parity (all 8 cases)', () => {
  for (const item of fixture.cases) {
    it(`window ${item.window} / ${item.method}`, () => {
      const result = analyzeRegime({ candles, asOf: last, window: item.window as LabelWindow, method: item.method as Method, horizon: 5 });
      expect(result.labels).toEqual(item.labels);
      expect(result.counts).toEqual(item.counts);
      expect(result.current).toBe(item.current);
      expect(result.insufficientHistory).toBe(false);
      result.matrix!.forEach((row, i) => row.forEach((v, j) => expect(Math.abs(v - item.matrix[i][j])).toBeLessThan(1e-9)));
      result.stationary!.forEach((v, i) => expect(Math.abs(v - item.stationary[i])).toBeLessThan(1e-9));
      expect(Math.abs(result.score!['5']! - (item.score as Record<string, number>)['5'])).toBeLessThan(1e-9);
      const currentIndex = ['Bear', 'Sideways', 'Bull'].indexOf(item.current);
      result.nStepMatrix![currentIndex].forEach((v, j) => expect(Math.abs(v - (item.forecast as Record<string, number[]>)['5'][j])).toBeLessThan(1e-9));
    });
  }
});

describe('no future data', () => {
  it('appending closes after the as-of date changes nothing', () => {
    const asOf = fixture.dates[330];
    const truncated = analyzeRegime({ candles: candles.slice(0, 331), asOf, window: 20, method: 'vol', horizon: 5 });
    const withFuture = analyzeRegime({ candles, asOf, window: 20, method: 'vol', horizon: 5 });
    expect(withFuture).toEqual(truncated);
  });

  it('an as-of date on a non-session day uses the last earlier session', () => {
    const result = analyzeRegime({ candles, asOf: '2099-01-01', window: 20, method: 'fixed', horizon: 1 });
    expect(result.asOf).toBe(last);
  });
});

describe('edge cases', () => {
  it('fewer than 252 defined labels: Not enough history, no matrix, forecast or decision', () => {
    const result = analyzeRegime({ candles: candles.slice(0, 251), asOf: fixture.dates[250], window: 10, method: 'vol', horizon: 5 });
    expect(result.definedLabels).toBeLessThan(252);
    expect(result.insufficientHistory).toBe(true);
    expect(result.matrix).toBeNull();
    expect(result.forecast).toBeNull();
    expect(result.decision).toBeNull();
  });

  it('exactly 252 defined labels is enough', () => {
    const result = analyzeRegime({ candles: candles.slice(0, 61 + 252), asOf: fixture.dates[61 + 251], window: 10, method: 'vol', horizon: 5 });
    expect(result.definedLabels).toBe(252);
    expect(result.insufficientHistory).toBe(false);
  });

  it('flat prices: no NaN anywhere and no decision', () => {
    const flat: Candle[] = fixture.dates.map((date) => ({ date, close: 100 }));
    const result = analyzeRegime({ candles: flat, asOf: last, window: 20, method: 'vol', horizon: 5 });
    expect(result.insufficientHistory).toBe(true);
    expect(JSON.stringify(result)).not.toMatch(/NaN|Infinity/);
  });

  it('empty row for the current state: forecast unavailable with an explanation, decision No trade', () => {
    // Long flat-then-jump series: the final state has never been left before.
    const series: Candle[] = [];
    const start = new Date('2024-01-01T00:00:00Z').getTime();
    for (let i = 0; i < 400; i += 1) {
      const date = new Date(start + i * 86_400_000).toISOString().slice(0, 10);
      series.push({ date, close: i < 399 ? 100 + (i % 3) * 0.1 : 200 });
    }
    const result = analyzeRegime({ candles: series, asOf: series.at(-1)!.date, window: 10, method: 'fixed', horizon: 5 });
    expect(result.current).toBe('Bull');
    expect(result.forecast?.['5']).toBeNull();
    expect(result.decision).toBe('No trade');
    expect(result.decisionNote).toMatch(/no transitions observed/i);
    expect(result.emptyRows).toContain(2);
  });

  it('unsorted input is sorted; duplicate dates throw', () => {
    const shuffled = [...candles].reverse();
    expect(analyzeRegime({ candles: shuffled, asOf: last, window: 20, method: 'fixed', horizon: 5 }).labels)
      .toEqual(analyzeRegime({ candles, asOf: last, window: 20, method: 'fixed', horizon: 5 }).labels);
    expect(() => analyzeRegime({ candles: [...candles, candles[0]], asOf: last, window: 20, method: 'fixed', horizon: 5 })).toThrow();
  });

  it('reports run length, recent changes, gaps and corporate-action flags', () => {
    const result = analyzeRegime({ candles, asOf: last, window: 10, method: 'vol', horizon: 5 });
    expect(result.runLength).toBeGreaterThanOrEqual(1);
    expect(result.recentChanges.length).toBeLessThanOrEqual(8);
    const jumped = candles.map((c, i) => (i === 300 ? { ...c, close: c.close * 0.2 } : c));
    const flagged = analyzeRegime({ candles: jumped, asOf: last, window: 10, method: 'vol', horizon: 5 });
    expect(flagged.corporateActionFlags.some((f) => f.date === fixture.dates[300])).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run lib/regime/analyze.test.ts` → Expected: FAIL (`./analyze` missing).

- [ ] **Step 3: Implement** `lib/regime/analyze.ts`

```ts
import { REGIME_CONFIG } from './config';
import { decide, type Decision } from './decision';
import { forecastPath, forecastRow, signalScore } from './forecast';
import { labelSeries } from './labels';
import { countTransitions, matrixPower, normalizeRows, timeShare } from './matrix';
import { stationaryDistribution } from './stationary';
import { STATES, type Candle, type Horizon, type Label, type LabelWindow, type Matrix, type Method, type State } from './types';
import { findGaps, flagPossibleCorporateActions, truncateAsOf, validateCandles } from './validate';

export type RegimeAnalysis = {
  asOf: string | null;
  sessions: number;
  window: LabelWindow;
  method: Method;
  horizon: Horizon;
  theta: number;
  dates: string[];
  closes: number[];
  labels: Label[];
  metric: (number | null)[];
  definedLabels: number;
  insufficientHistory: boolean;
  current: State | null;
  runLength: number;
  windowMove: number | null;
  metricNow: number | null;
  counts: number[][] | null;
  matrix: Matrix | null;
  emptyRows: number[];
  stationary: number[] | null;
  timeShare: number[] | null;
  forecast: Record<'1' | '5' | '10', number[] | null> | null;
  score: Record<'1' | '5' | '10', number | null> | null;
  forecastPath: { step: number; probs: number[] }[] | null;
  nStepMatrix: Matrix | null;
  decision: Decision | null;
  decisionNote: string | null;
  recentChanges: { date: string; from: State; to: State }[];
  corporateActionFlags: ReturnType<typeof flagPossibleCorporateActions>;
  gaps: ReturnType<typeof findGaps>;
};

export function analyzeRegime(input: { candles: Candle[]; asOf: string; window: LabelWindow; method: Method; horizon: Horizon; theta?: number }): RegimeAnalysis {
  const theta = input.theta ?? REGIME_CONFIG.theta;
  const candles = truncateAsOf(validateCandles(input.candles), input.asOf);
  const dates = candles.map((c) => c.date);
  const closes = candles.map((c) => c.close);
  const { labels, metric } = labelSeries(closes, input.window, input.method);
  const definedLabels = labels.filter((l) => l !== null).length;
  const insufficientHistory = definedLabels < REGIME_CONFIG.minLabels;
  const lastIndex = closes.length - 1;
  const current = lastIndex >= 0 ? labels[lastIndex] : null;

  let runLength = 0;
  if (current) for (let t = lastIndex; t >= 0 && labels[t] === current; t -= 1) runLength += 1;

  const recentChanges: RegimeAnalysis['recentChanges'] = [];
  for (let t = lastIndex; t >= 1 && recentChanges.length < REGIME_CONFIG.recentChanges; t -= 1) {
    const from = labels[t - 1];
    const to = labels[t];
    if (from && to && from !== to) recentChanges.push({ date: dates[t], from, to });
  }

  const base = {
    asOf: lastIndex >= 0 ? dates[lastIndex] : null,
    sessions: closes.length,
    window: input.window,
    method: input.method,
    horizon: input.horizon,
    theta,
    dates,
    closes,
    labels,
    metric,
    definedLabels,
    insufficientHistory,
    current,
    runLength,
    windowMove: lastIndex >= input.window ? closes[lastIndex] / closes[lastIndex - input.window] - 1 : null,
    metricNow: lastIndex >= 0 ? metric[lastIndex] : null,
    recentChanges,
    corporateActionFlags: flagPossibleCorporateActions(candles),
    gaps: findGaps(candles),
  };

  if (insufficientHistory) {
    return { ...base, counts: null, matrix: null, emptyRows: [], stationary: null, timeShare: null, forecast: null, score: null, forecastPath: null, nStepMatrix: null, decision: null, decisionNote: 'Not enough history' };
  }

  const counts = countTransitions(labels);
  const { matrix, emptyRows } = normalizeRows(counts);
  const shared = { ...base, counts, matrix, emptyRows, stationary: stationaryDistribution(matrix), timeShare: timeShare(labels) };

  if (!current) return { ...shared, forecast: null, score: null, forecastPath: null, nStepMatrix: matrixPower(matrix, input.horizon), decision: null, decisionNote: 'Current label is undefined' };

  const forecast = {} as Record<'1' | '5' | '10', number[] | null>;
  const score = {} as Record<'1' | '5' | '10', number | null>;
  for (const n of [1, 5, 10] as const) {
    const row = forecastRow(matrix, current, n);
    forecast[String(n) as '1' | '5' | '10'] = row;
    score[String(n) as '1' | '5' | '10'] = row ? signalScore(row) : null;
  }
  const chosen = score[String(input.horizon) as '1' | '5' | '10'];
  const unavailable = chosen === null;
  return {
    ...shared,
    forecast,
    score,
    forecastPath: unavailable ? null : forecastPath(matrix, current),
    nStepMatrix: matrixPower(matrix, input.horizon),
    decision: unavailable ? 'No trade' : decide(chosen, theta),
    decisionNote: unavailable ? `No transitions observed from ${current}; forecast unavailable.` : null,
  };
}

export { STATES };
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run lib/regime` → Expected: PASS for validate, labels, maths and analyze (the full regime suite). If the `toEqual` no-future test fails, find which field differs first; it means a computation is reading beyond the truncation.

- [ ] **Step 5: Commit**

```bash
git add lib/regime
git commit -m "feat(regime): analyzeRegime orchestrator with edge cases and no-future-data proof"
```

---

### Task 5: View helpers (display order, bands, formatting)

**Files:**
- Create: `lib/regime/view.ts`
- Test: `lib/regime/view.test.ts`

**Interfaces:**
- Produces:
  - `DISPLAY_ORDER: readonly ['Bull','Sideways','Bear']`
  - `toDisplayMatrix(matrix: number[][]): number[][]` (rows and columns reordered from `[Bear,Sideways,Bull]` to Bull, Sideways, Bear)
  - `regimeBands(dates: string[], labels: Label[]): { start: string; end: string; label: State }[]` (contiguous runs of the same defined label)
  - `formatPercent(value: number | null, digits?: number, signed?: boolean): string`

- [ ] **Step 1: Write the failing test** `lib/regime/view.test.ts`

```ts
import { describe, expect, it } from 'vitest';

import { DISPLAY_ORDER, formatPercent, regimeBands, toDisplayMatrix } from './view';

describe('toDisplayMatrix', () => {
  it('reorders [Bear,Sideways,Bull] rows and columns to Bull,Sideways,Bear', () => {
    const P = [[1, 2, 3], [4, 5, 6], [7, 8, 9]];
    expect(toDisplayMatrix(P)).toEqual([[9, 8, 7], [6, 5, 4], [3, 2, 1]]);
    expect(DISPLAY_ORDER).toEqual(['Bull', 'Sideways', 'Bear']);
  });
});

describe('regimeBands', () => {
  it('groups contiguous runs and skips undefined labels', () => {
    const dates = ['d1', 'd2', 'd3', 'd4', 'd5', 'd6'];
    expect(regimeBands(dates, [null, 'Bull', 'Bull', 'Sideways', 'Bull', null])).toEqual([
      { start: 'd2', end: 'd3', label: 'Bull' },
      { start: 'd4', end: 'd4', label: 'Sideways' },
      { start: 'd5', end: 'd5', label: 'Bull' },
    ]);
  });
});

describe('formatPercent', () => {
  it('formats with sign and shows a dash for null', () => {
    expect(formatPercent(0.1151, 2, true)).toBe('+11.51%');
    expect(formatPercent(-0.05, 1, true)).toBe('−5.0%');
    expect(formatPercent(0.2, 0)).toBe('20%');
    expect(formatPercent(null)).toBe('—');
  });
});
```

- [ ] **Step 2: Run to verify it fails** — `npx vitest run lib/regime/view.test.ts` → FAIL.

- [ ] **Step 3: Implement** `lib/regime/view.ts`

```ts
import type { Label, State } from './types';

export const DISPLAY_ORDER = ['Bull', 'Sideways', 'Bear'] as const;

export function toDisplayMatrix(matrix: number[][]): number[][] {
  const order = [2, 1, 0];
  return order.map((row) => order.map((col) => matrix[row][col]));
}

export function regimeBands(dates: string[], labels: Label[]) {
  const bands: { start: string; end: string; label: State }[] = [];
  labels.forEach((label, i) => {
    if (!label) return;
    const previous = bands.at(-1);
    if (previous && previous.label === label && previous.end === dates[i - 1]) previous.end = dates[i];
    else bands.push({ start: dates[i], end: dates[i], label });
  });
  return bands;
}

export function formatPercent(value: number | null, digits = 1, signed = false) {
  if (value === null || !Number.isFinite(value)) return '—';
  const text = Math.abs(value * 100).toFixed(digits);
  const sign = value < 0 ? '−' : signed ? '+' : '';
  return `${sign}${text}%`;
}
```

- [ ] **Step 4: Run to verify it passes** — `npx vitest run lib/regime/view.test.ts` → PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/regime/view.ts lib/regime/view.test.ts
git commit -m "feat(regime): view helpers for display order, bands and formatting"
```

---

### Task 6: Request parameters, completed-session rule and daily-candle fetch

**Files:**
- Create: `lib/regime/params.ts`, `lib/regime/fyers-daily.ts`, `lib/regime/api-types.ts`
- Modify: `lib/market-session.ts` (append `lastCompletedSession`)
- Test: `lib/regime/params.test.ts`, `lib/regime/fyers-daily.test.ts`, extend `tests/market-session.test.ts`

**Interfaces:**
- Consumes: `istDate`, `marketSession`, `previousTradingDate`, `isTradingDay` (export it) from `lib/market-session.ts`.
- Produces:
  - `parseRegimeParams(params: URLSearchParams, universe: ReadonlySet<string>): { ok: true; value: { symbol: string; window: LabelWindow; method: Method; horizon: Horizon; asOf: string | null } } | { ok: false; error: string }` (defaults: window 20, method `vol`, horizon 5).
  - `lastCompletedSession(now: Date, holidays?: ReadonlySet<string>): string` (today only when a trading weekday and at or after 15:30 IST, else `previousTradingDate`).
  - `chunkRanges(from: string, to: string, maxDays: number): { from: string; to: string }[]`
  - `epochToIstDate(epochSeconds: number): string`
  - `fetchDailyCandles(credentials: { clientId: string; accessToken: string }, symbol: string, from: string, to: string, fetchImpl?: typeof fetch): Promise<{ ok: true; candles: Candle[] } | { ok: false; status: 401 | 502; message: string }>`
  - `type RegimeResponse` (see Step 3).

- [ ] **Step 1: Write the failing tests**

`lib/regime/params.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import { parseRegimeParams } from './params';

const universe = new Set(['NSE:TCS-EQ', 'NSE:SBIN-EQ']);
const parse = (query: string) => parseRegimeParams(new URLSearchParams(query), universe);

describe('parseRegimeParams', () => {
  it('applies defaults', () => {
    expect(parse('symbol=NSE:TCS-EQ')).toEqual({ ok: true, value: { symbol: 'NSE:TCS-EQ', window: 20, method: 'vol', horizon: 5, asOf: null } });
  });

  it('accepts every allowed window, method and horizon', () => {
    for (const w of [10, 20, 40, 60]) for (const m of ['vol', 'fixed']) for (const h of [1, 5, 10]) {
      expect(parse(`symbol=NSE:TCS-EQ&window=${w}&method=${m}&horizon=${h}`).ok).toBe(true);
    }
  });

  it('rejects bad input', () => {
    for (const query of ['', 'symbol=NSE:NOPE-EQ', 'symbol=NSE:TCS-EQ&window=30', 'symbol=NSE:TCS-EQ&method=x', 'symbol=NSE:TCS-EQ&horizon=3', 'symbol=NSE:TCS-EQ&asOf=2026-13-40', 'symbol=NSE:TCS-EQ&asOf=yesterday']) {
      expect(parse(query).ok).toBe(false);
    }
  });

  it('accepts a valid asOf date', () => {
    expect(parse('symbol=NSE:TCS-EQ&asOf=2026-09-29')).toMatchObject({ ok: true, value: { asOf: '2026-09-29' } });
  });
});
```

`lib/regime/fyers-daily.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import { chunkRanges, epochToIstDate, fetchDailyCandles } from './fyers-daily';

const credentials = { clientId: 'client', accessToken: 'token' };
const jsonResponse = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

describe('chunkRanges', () => {
  it('splits a long range into consecutive chunks without overlap', () => {
    const chunks = chunkRanges('2024-01-01', '2026-01-01', 360);
    expect(chunks[0].from).toBe('2024-01-01');
    expect(chunks.at(-1)!.to).toBe('2026-01-01');
    for (let i = 1; i < chunks.length; i += 1) {
      const previousEnd = new Date(`${chunks[i - 1].to}T00:00:00Z`).getTime();
      expect(new Date(`${chunks[i].from}T00:00:00Z`).getTime() - previousEnd).toBe(86_400_000);
    }
  });
});

describe('epochToIstDate', () => {
  it('maps IST midnight and the previous UTC evening to the same India date', () => {
    expect(epochToIstDate(Date.parse('2026-09-28T18:30:00Z') / 1000)).toBe('2026-09-29');
    expect(epochToIstDate(Date.parse('2026-09-29T03:45:00Z') / 1000)).toBe('2026-09-29');
  });
});

describe('fetchDailyCandles', () => {
  it('merges chunks, converts epochs to IST dates and dedupes overlap', async () => {
    const calls: string[] = [];
    const fetchImpl = (async (url: URL | string) => {
      calls.push(String(url));
      return jsonResponse({ s: 'ok', candles: [[Date.parse('2026-09-28T18:30:00Z') / 1000, 1, 2, 0.5, 101.5, 10]] });
    }) as unknown as typeof fetch;
    const result = await fetchDailyCandles(credentials, 'NSE:TCS-EQ', '2024-01-01', '2026-01-01', fetchImpl);
    expect(result).toEqual({ ok: true, candles: [{ date: '2026-09-29', close: 101.5 }] });
    expect(calls.length).toBeGreaterThan(1);
    expect(calls[0]).toContain('resolution=');
  });

  it('maps a FYERS auth error (code -16) to 401', async () => {
    const fetchImpl = (async () => jsonResponse({ s: 'error', code: -16, message: 'Could not authenticate the user' }, 401)) as unknown as typeof fetch;
    expect(await fetchDailyCandles(credentials, 'NSE:TCS-EQ', '2026-01-01', '2026-02-01', fetchImpl)).toMatchObject({ ok: false, status: 401 });
  });

  it('maps other failures to 502 and never returns partial candles', async () => {
    const fetchImpl = (async () => jsonResponse({ s: 'error', message: 'boom' }, 500)) as unknown as typeof fetch;
    expect(await fetchDailyCandles(credentials, 'NSE:TCS-EQ', '2026-01-01', '2026-02-01', fetchImpl)).toMatchObject({ ok: false, status: 502 });
  });
});
```

Append to `tests/market-session.test.ts` (import `lastCompletedSession`):

```ts
describe('lastCompletedSession', () => {
  it('is the previous trading day while the market is open (today is still forming)', () => {
    expect(lastCompletedSession(new Date('2026-09-29T04:30:00Z'))).toBe('2026-09-28');
  });

  it('is today after 15:30 IST on a trading day', () => {
    expect(lastCompletedSession(new Date('2026-09-30T10:30:00Z'))).toBe('2026-09-30');
  });

  it('is the previous trading day just after midnight IST', () => {
    expect(lastCompletedSession(new Date('2026-09-29T18:31:00Z'))).toBe('2026-09-29');
  });

  it('is Friday over a weekend', () => {
    expect(lastCompletedSession(new Date('2026-09-27T06:00:00Z'))).toBe('2026-09-25');
  });
});
```

- [ ] **Step 2: Run to verify they fail** — `npx vitest run lib/regime/params.test.ts lib/regime/fyers-daily.test.ts tests/market-session.test.ts` → FAIL (modules / function missing).

- [ ] **Step 3: Implement**

In `lib/market-session.ts`: change `function isTradingDay` to `export function isTradingDay`, and append:

```ts
// The latest session whose daily candle is final: today only once it is a trading day past 15:30 IST.
export function lastCompletedSession(now: Date, holidays: ReadonlySet<string> = new Set()) {
  const today = istDate(now);
  return isTradingDay(today, holidays) && istMinuteOfDay(now) >= CLOSE_MINUTE ? today : previousTradingDate(now, holidays);
}
```

`lib/regime/params.ts`:

```ts
import { HORIZONS, METHODS, WINDOWS, type Horizon, type LabelWindow, type Method } from './types';

export type RegimeParams = { symbol: string; window: LabelWindow; method: Method; horizon: Horizon; asOf: string | null };

function validDate(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
}

export function parseRegimeParams(params: URLSearchParams, universe: ReadonlySet<string>): { ok: true; value: RegimeParams } | { ok: false; error: string } {
  const symbol = params.get('symbol') ?? '';
  if (!universe.has(symbol)) return { ok: false, error: 'Choose a stock from the F&O universe.' };
  const window = Number(params.get('window') ?? 20);
  if (!(WINDOWS as readonly number[]).includes(window)) return { ok: false, error: 'window must be 10, 20, 40 or 60.' };
  const method = params.get('method') ?? 'vol';
  if (!(METHODS as readonly string[]).includes(method)) return { ok: false, error: 'method must be vol or fixed.' };
  const horizon = Number(params.get('horizon') ?? 5);
  if (!(HORIZONS as readonly number[]).includes(horizon)) return { ok: false, error: 'horizon must be 1, 5 or 10.' };
  const asOf = params.get('asOf');
  if (asOf !== null && !validDate(asOf)) return { ok: false, error: 'asOf must be a valid YYYY-MM-DD date.' };
  return { ok: true, value: { symbol, window: window as LabelWindow, method: method as Method, horizon: horizon as Horizon, asOf } };
}
```

`lib/regime/fyers-daily.ts`:

```ts
import type { Candle } from './types';

// Assumptions to verify in Task 8: resolution code and the per-request range limit for daily candles.
export const DAILY_RESOLUTION = 'D';
export const DAILY_CHUNK_DAYS = 360;
const DAY_MS = 86_400_000;

const isoDate = (ms: number) => new Date(ms).toISOString().slice(0, 10);

export function chunkRanges(from: string, to: string, maxDays: number) {
  const chunks: { from: string; to: string }[] = [];
  const end = new Date(`${to}T00:00:00Z`).getTime();
  for (let start = new Date(`${from}T00:00:00Z`).getTime(); start <= end; start += (maxDays + 1) * DAY_MS) {
    chunks.push({ from: isoDate(start), to: isoDate(Math.min(start + maxDays * DAY_MS, end)) });
  }
  return chunks;
}

export function epochToIstDate(epochSeconds: number) {
  return new Date(epochSeconds * 1000).toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
}

type DailyResult = { ok: true; candles: Candle[] } | { ok: false; status: 401 | 502; message: string };

export async function fetchDailyCandles(credentials: { clientId: string; accessToken: string }, symbol: string, from: string, to: string, fetchImpl: typeof fetch = fetch): Promise<DailyResult> {
  const byDate = new Map<string, number>();
  for (const range of chunkRanges(from, to, DAILY_CHUNK_DAYS)) {
    const url = new URL('https://api-t1.fyers.in/data/history');
    for (const [key, value] of Object.entries({ symbol, resolution: DAILY_RESOLUTION, date_format: '1', range_from: range.from, range_to: range.to, cont_flag: '1' })) url.searchParams.set(key, value);
    const response = await fetchImpl(url, { headers: { Authorization: `${credentials.clientId}:${credentials.accessToken}`, Accept: 'application/json' }, cache: 'no-store' });
    const payload = await response.json().catch(() => null) as { s?: string; code?: number; message?: string; candles?: number[][] } | null;
    if (payload?.code === -16 || response.status === 401) return { ok: false, status: 401, message: payload?.message ?? 'FYERS rejected the access token.' };
    if (!response.ok || payload?.s !== 'ok' || !Array.isArray(payload.candles)) return { ok: false, status: 502, message: payload?.message ?? `FYERS history failed (${response.status}).` };
    for (const candle of payload.candles) byDate.set(epochToIstDate(candle[0]), candle[4]);
  }
  return { ok: true, candles: [...byDate.entries()].map(([date, close]) => ({ date, close })).sort((a, b) => a.date.localeCompare(b.date)) };
}
```

`lib/regime/api-types.ts`:

```ts
import type { RegimeAnalysis } from './analyze';

export type RegimeResponse = {
  symbol: string;
  analysis: RegimeAnalysis;
  dataSource: {
    provider: 'FYERS';
    resolution: 'daily';
    fetchedAt: string;
    lastCandleDate: string | null;
    expectedLastSession: string;
    stale: boolean;
    staleNote: string | null;
    adjustment: 'unverified' | 'adjusted' | 'unadjusted';
    adjustmentNote: string;
  };
};

export type RegimeErrorResponse = { error: string; code: 'NO_TOKEN' | 'TOKEN_REJECTED' | 'BAD_REQUEST' | 'NO_DATA' | 'UPSTREAM' };
```

- [ ] **Step 4: Run to verify they pass** — `npx vitest run` → all suites PASS.

- [ ] **Step 5: Commit**

```bash
git add lib tests
git commit -m "feat(regime): request validation, completed-session rule and daily candle fetch"
```

---

### Task 7: `GET /api/regime`

**Files:**
- Create: `app/api/regime/route.ts`
- Test: `lib/regime/route-logic.test.ts` (tests the pure `buildRegimeResponse` helper below)
- Create: `lib/regime/build-response.ts`

**Interfaces:**
- Consumes: `fyersCredentials(request)` from `lib/backtest/fyers-data.ts`, `parseRegimeParams`, `fetchDailyCandles`, `analyzeRegime`, `lastCompletedSession`, `marketSnapshot`.
- Produces: `buildRegimeResponse({ symbol, candles, params, now }): RegimeResponse | { error, code }` (pure: drops incomplete candles, picks the default as-of, computes staleness); the route wraps it with I/O.

- [ ] **Step 1: Write the failing test** `lib/regime/route-logic.test.ts`

```ts
import { describe, expect, it } from 'vitest';

import fixture from '@/tests/fixtures/regime-fixture.json';

import { buildRegimeResponse } from './build-response';
import type { Candle } from './types';

const candles: Candle[] = fixture.dates.map((date, i) => ({ date, close: fixture.closes[i] }));
const params = { symbol: 'NSE:TCS-EQ', window: 10 as const, method: 'vol' as const, horizon: 5 as const, asOf: null };

describe('buildRegimeResponse', () => {
  it('drops a still-forming candle for today while the market is open', () => {
    const now = new Date('2026-09-29T04:30:00Z'); // Tue 10:00 IST
    const withToday = [...candles.map((c) => ({ ...c })), { date: '2026-09-29', close: 999 }];
    const response = buildRegimeResponse({ candles: withToday, params, now });
    expect('analysis' in response && response.analysis.dates.includes('2026-09-29')).toBe(false);
  });

  it('keeps today\'s candle after 15:30 IST', () => {
    const now = new Date('2026-09-30T10:30:00Z'); // Wed 16:00 IST
    const withToday = [...candles, { date: '2026-09-30', close: 999 }];
    const response = buildRegimeResponse({ candles: withToday, params, now });
    expect('analysis' in response && response.analysis.dates.at(-1)).toBe('2026-09-30');
  });

  it('marks data stale when the newest candle is older than the last completed session', () => {
    const now = new Date('2026-09-29T04:30:00Z');
    const response = buildRegimeResponse({ candles, params, now });
    expect('dataSource' in response && response.dataSource.stale).toBe(true);
    expect('dataSource' in response && response.dataSource.staleNote).toMatch(/possibly stale/i);
  });

  it('honours an explicit as-of date and never uses later closes', () => {
    const response = buildRegimeResponse({ candles, params: { ...params, asOf: fixture.dates[300] }, now: new Date('2027-01-01T04:30:00Z') });
    expect('analysis' in response && response.analysis.asOf).toBe(fixture.dates[300]);
  });

  it('returns NO_DATA when there are no candles', () => {
    expect(buildRegimeResponse({ candles: [], params, now: new Date() })).toMatchObject({ code: 'NO_DATA' });
  });

  it('reports the adjustment status as unverified until Task 8 records evidence', () => {
    const response = buildRegimeResponse({ candles, params, now: new Date('2027-01-01T04:30:00Z') });
    expect('dataSource' in response && response.dataSource.adjustment).toBe('unverified');
  });
});
```

- [ ] **Step 2: Run to verify it fails** — `npx vitest run lib/regime/route-logic.test.ts` → FAIL.

- [ ] **Step 3: Implement**

`lib/regime/build-response.ts`:

```ts
import { lastCompletedSession } from '@/lib/market-session';

import { analyzeRegime } from './analyze';
import type { RegimeErrorResponse, RegimeResponse } from './api-types';
import type { RegimeParams } from './params';
import type { Candle } from './types';
import { validateCandles } from './validate';

// Set to 'adjusted' / 'unadjusted' only after Task 8 records evidence.
export const ADJUSTMENT_STATUS: RegimeResponse['dataSource']['adjustment'] = 'unverified';
export const ADJUSTMENT_NOTE = 'Split/bonus adjustment of FYERS daily history is unverified. Large one-day moves are flagged as possible corporate actions.';

export function buildRegimeResponse(input: { candles: Candle[]; params: RegimeParams; now: Date }): RegimeResponse | RegimeErrorResponse {
  const expected = lastCompletedSession(input.now);
  const completed = validateCandles(input.candles).filter((candle) => candle.date <= expected);
  if (!completed.length) return { error: 'FYERS returned no completed daily candles for this stock.', code: 'NO_DATA' };
  const asOf = input.params.asOf ?? expected;
  const analysis = analyzeRegime({ candles: completed, asOf, window: input.params.window, method: input.params.method, horizon: input.params.horizon });
  const lastCandleDate = completed.at(-1)!.date;
  const stale = lastCandleDate < expected;
  return {
    symbol: input.params.symbol,
    analysis,
    dataSource: {
      provider: 'FYERS',
      resolution: 'daily',
      fetchedAt: input.now.toISOString(),
      lastCandleDate,
      expectedLastSession: expected,
      stale,
      staleNote: stale ? `Newest candle is ${lastCandleDate}; expected ${expected}. Data is possibly stale (no exchange-holiday list is bundled yet).` : null,
      adjustment: ADJUSTMENT_STATUS,
      adjustmentNote: ADJUSTMENT_NOTE,
    },
  };
}
```

`app/api/regime/route.ts`:

```ts
import { fyersCredentials } from '@/lib/backtest/fyers-data';
import { marketSnapshot } from '@/lib/market-snapshot';
import { lastCompletedSession } from '@/lib/market-session';
import type { RegimeErrorResponse } from '@/lib/regime/api-types';
import { buildRegimeResponse } from '@/lib/regime/build-response';
import { fetchDailyCandles } from '@/lib/regime/fyers-daily';
import { parseRegimeParams } from '@/lib/regime/params';
import { RegimeInputError } from '@/lib/regime/types';

const universe = new Set(marketSnapshot.map((stock) => stock.symbol));
const HISTORY_DAYS = 800; // about 3.3 years of calendar time, comfortably over the 313 sessions needed

function json(body: unknown, status = 200) {
  return Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
}

const fail = (error: string, code: RegimeErrorResponse['code'], status: number) => json({ error, code } satisfies RegimeErrorResponse, status);

export async function GET(request: Request) {
  const parsed = parseRegimeParams(new URL(request.url).searchParams, universe);
  if (!parsed.ok) return fail(parsed.error, 'BAD_REQUEST', 400);
  const credentials = fyersCredentials(request);
  if (!credentials) return fail('Connect FYERS to load daily prices.', 'NO_TOKEN', 401);

  const now = new Date();
  const latest = lastCompletedSession(now);
  const to = parsed.value.asOf && parsed.value.asOf < latest ? parsed.value.asOf : latest;
  const from = new Date(new Date(`${to}T00:00:00Z`).getTime() - HISTORY_DAYS * 86_400_000).toISOString().slice(0, 10);
  const history = await fetchDailyCandles(credentials, parsed.value.symbol, from, to);
  if (!history.ok) return history.status === 401 ? fail(history.message, 'TOKEN_REJECTED', 401) : fail(history.message, 'UPSTREAM', 502);

  try {
    const response = buildRegimeResponse({ candles: history.candles, params: parsed.value, now });
    return 'error' in response ? fail(response.error, response.code, response.code === 'NO_DATA' ? 404 : 400) : json(response);
  } catch (error) {
    if (error instanceof RegimeInputError) return fail(error.message, 'UPSTREAM', 502);
    throw error;
  }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run` → all PASS. Run `npx tsc --noEmit` → exit 0.
Smoke (no token): `curl -s "http://localhost:3000/api/regime?symbol=NSE:TCS-EQ"` → `{"error":"Connect FYERS...","code":"NO_TOKEN"}` with status 401; `curl -s "http://localhost:3000/api/regime?symbol=NSE:TCS-EQ&window=30"` → 400 `BAD_REQUEST`.

- [ ] **Step 5: Commit**

```bash
git add app/api/regime lib/regime
git commit -m "feat(regime): GET /api/regime with validation, staleness and token handling"
```

---

### Task 8: Answer the FYERS split/bonus adjustment question with evidence

**Files:**
- Create: `scripts/probe-fyers-adjustment.mjs`, `docs/verification/markov/fyers-adjustment-evidence.md`
- Modify: `lib/regime/build-response.ts` (`ADJUSTMENT_STATUS` / `ADJUSTMENT_NOTE`), and `lib/regime/route-logic.test.ts` (the "unverified" test)

**Prerequisite (yours):** `FYERS_ACCESS_TOKEN` is in `.env.local` and the dev server was restarted. Check with `curl -s localhost:3000/api/regime?symbol=NSE:TCS-EQ` (must no longer return `NO_TOKEN`). I never read the file.

**Method:** the NSE bhavcopy close is the *unadjusted* actual close on that date. If FYERS's close for the same old date differs materially, FYERS is adjusted for that stock. Compare every stock in the universe, then confirm the mismatching names are ones with real corporate actions since.

- [ ] **Step 1: Write the probe** `scripts/probe-fyers-adjustment.mjs`

```js
// Usage: node scripts/probe-fyers-adjustment.mjs <YYYY-MM-DD old session> [baseUrl]
// Compares FYERS daily close (via /api/regime) with the NSE bhavcopy close (via /api/market?date=) for every stock.
const [date, base = 'http://localhost:3000'] = process.argv.slice(2);
if (!/^\d{4}-\d{2}-\d{2}$/.test(date ?? '')) throw new Error('Pass an old session date, e.g. 2025-03-12');

const nse = await (await fetch(`${base}/api/market?date=${date}`)).json();
if (!nse.stocks) throw new Error(`NSE bhavcopy unavailable for ${date}: ${nse.error}`);
const rows = [];
for (const stock of nse.stocks) {
  await new Promise((resolve) => setTimeout(resolve, 350));
  const res = await fetch(`${base}/api/regime?symbol=${encodeURIComponent(stock.symbol)}&window=10&method=fixed&horizon=1`);
  const body = await res.json();
  if (!res.ok) { rows.push({ ticker: stock.ticker, error: body.code ?? res.status }); if (res.status === 401) break; continue; }
  const index = body.analysis.dates.indexOf(date);
  if (index < 0) { rows.push({ ticker: stock.ticker, error: 'date missing in FYERS history' }); continue; }
  const fyers = body.analysis.closes[index];
  rows.push({ ticker: stock.ticker, nseClose: stock.price, fyersClose: fyers, ratio: fyers / stock.price });
}
const compared = rows.filter((r) => r.ratio !== undefined);
const mismatched = compared.filter((r) => Math.abs(r.ratio - 1) > 0.005).sort((a, b) => a.ratio - b.ratio);
console.log(JSON.stringify({ date, stocks: nse.stocks.length, compared: compared.length, errors: rows.filter((r) => r.error), mismatched }, null, 2));
```

- [ ] **Step 2: Run it for an old session**

Pick a session at least 15 months back so recent splits/bonuses fall after it, for example 15 months before today. Run: `node scripts/probe-fyers-adjustment.mjs 2025-06-10 > docs/verification/markov/probe-raw.json` (it makes about 210 calls; allow several minutes).
Expected: JSON with `compared` near 210. Read `mismatched`.

- [ ] **Step 3: Interpret the evidence**

- If several stocks show `ratio` far from 1 and they are names with known splits or bonuses after the probe date (verify each against the NSE corporate-actions page or the exchange announcement, quoting the source), FYERS daily history **is adjusted**. Record: ticker, NSE close, FYERS close, ratio, and the corporate action with its source.
- If every ratio is within 0.5% across the universe while some stocks are known to have had actions since that date, FYERS is **not adjusted**.
- If no stock in the universe had an action since the probe date, the probe is inconclusive; move the probe date back and repeat.

- [ ] **Step 4: Write the evidence file** `docs/verification/markov/fyers-adjustment-evidence.md` with: the date probed, counts, the mismatch table, the verified corporate actions and their sources, the conclusion (adjusted / unadjusted / inconclusive) and its limits. Report anything not verified as unverified.

- [ ] **Step 5: Update the code to match the evidence**

Set `ADJUSTMENT_STATUS` and `ADJUSTMENT_NOTE` in `lib/regime/build-response.ts` to the evidenced value (`'adjusted'` / `'unadjusted'`; leave `'unverified'` if inconclusive). Update the "adjustment status" test in `lib/regime/route-logic.test.ts` to expect the same value. Keep the ±0.25 corporate-action banner in every case.

- [ ] **Step 6: Run and commit**

Run: `npx vitest run` → PASS.

```bash
git add scripts docs/verification lib/regime
git commit -m "docs(regime): evidence for FYERS daily-history adjustment; record status in the API"
```

---

### Task 9: The "Markov regime" tab UI

**Files:**
- Create: `app/markov-regime.tsx`
- Modify: `app/page.tsx` (tab button + render branch)

**Interfaces:**
- Consumes: `RegimeResponse` / `RegimeErrorResponse`, `regimeBands`, `toDisplayMatrix`, `DISPLAY_ORDER`, `formatPercent`, `marketSnapshot`, `REGIME_CONFIG`, Recharts.
- Produces: `MarkovRegime()` default-less named export rendering the tab.

The UI logic is exercised through the view-helper tests; the component itself is verified with `tsc`, `lint`, and the live sweep in Task 11 (there is no jsdom in this project).

- [ ] **Step 1: Implement** `app/markov-regime.tsx`

```tsx
'use client';

import { useEffect, useMemo, useState } from 'react';
import { CartesianGrid, Line, LineChart, ReferenceArea, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';

import { marketSnapshot } from '@/lib/market-snapshot';
import type { RegimeErrorResponse, RegimeResponse } from '@/lib/regime/api-types';
import { REGIME_CONFIG } from '@/lib/regime/config';
import { HORIZONS, METHODS, STATES, WINDOWS, type Horizon, type LabelWindow, type Method, type State } from '@/lib/regime/types';
import { DISPLAY_ORDER, formatPercent, regimeBands, toDisplayMatrix } from '@/lib/regime/view';

const COLOR: Record<State, { text: string; band: string; pill: string }> = {
  Bull: { text: '#1a7f4b', band: '#cfe7da', pill: '#e3f2ea' },
  Bear: { text: '#b42318', band: '#f5d6d2', pill: '#fbe7e4' },
  Sideways: { text: '#475569', band: '#eceff3', pill: '#eef1f5' },
};
const METHOD_LABEL: Record<Method, string> = { vol: 'Vol-adjusted z ±1', fixed: 'Fixed ±5% (repo)' };
const CHART_SESSIONS = 250;

type LoadState = { kind: 'idle' } | { kind: 'loading' } | { kind: 'error'; message: string; code?: string } | { kind: 'data'; data: RegimeResponse };

function Pill({ label }: { label: State | null }) {
  if (!label) return <span className="rounded-full border px-2.5 py-0.5 text-xs font-semibold">Undefined</span>;
  return <span className="rounded-full px-2.5 py-0.5 text-xs font-semibold" style={{ background: COLOR[label].pill, color: COLOR[label].text }}>{label}</span>;
}

function Choice<T extends string | number>({ legend, name, options, value, onChange, render }: { legend: string; name: string; options: readonly T[]; value: T; onChange: (value: T) => void; render: (option: T) => string }) {
  return (
    <fieldset className="grid gap-1">
      <legend className="text-xs text-muted-foreground">{legend}</legend>
      <div className="flex rounded-lg bg-muted p-0.5">
        {options.map((option) => (
          <label key={String(option)} className={`cursor-pointer rounded-md px-3 py-1.5 text-sm has-[:focus-visible]:ring-2 ${option === value ? 'bg-background font-semibold shadow-sm' : 'text-muted-foreground'}`}>
            <input type="radio" className="sr-only" name={name} checked={option === value} onChange={() => onChange(option)} />
            {render(option)}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

function Card({ title, children, note }: { title: string; children: React.ReactNode; note?: string }) {
  return (
    <section className="grid content-start gap-3 rounded-2xl border bg-card p-4">
      <h3 className="text-sm font-semibold">{title}</h3>
      {children}
      {note && <p className="text-xs text-muted-foreground">{note}</p>}
    </section>
  );
}

export function MarkovRegime() {
  const [ticker, setTicker] = useState('TCS');
  const [window, setWindow] = useState<LabelWindow>(20);
  const [method, setMethod] = useState<Method>('vol');
  const [horizon, setHorizon] = useState<Horizon>(5);
  const [asOf, setAsOf] = useState('');
  const [matrixStep, setMatrixStep] = useState<'1' | 'n'>('1');
  const [state, setState] = useState<LoadState>({ kind: 'idle' });

  const symbol = useMemo(() => marketSnapshot.find((stock) => stock.ticker === ticker.trim().toUpperCase())?.symbol ?? null, [ticker]);

  useEffect(() => {
    if (!symbol) {
      setState({ kind: 'error', message: 'Choose a stock from the F&O universe.' });
      return;
    }
    const controller = new AbortController();
    setState({ kind: 'loading' });
    const query = new URLSearchParams({ symbol, window: String(window), method, horizon: String(horizon) });
    if (asOf) query.set('asOf', asOf);
    fetch(`/api/regime?${query}`, { cache: 'no-store', signal: controller.signal })
      .then(async (response) => {
        const body = await response.json() as RegimeResponse | RegimeErrorResponse;
        if (!response.ok || 'error' in body) setState({ kind: 'error', message: 'error' in body ? body.error : 'Unable to load regime data.', code: 'code' in body ? body.code : undefined });
        else setState({ kind: 'data', data: body });
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) setState({ kind: 'error', message: error instanceof Error ? error.message : 'Unable to load regime data.' });
      });
    return () => controller.abort();
  }, [symbol, window, method, horizon, asOf]);

  return (
    <div className="grid gap-4">
      <header className="grid gap-1">
        <p className="text-xs font-semibold tracking-wide text-muted-foreground">REGIME LAB</p>
        <h2 className="text-xl font-semibold">Markov Regime Detector</h2>
        <p className="text-sm text-muted-foreground">Labels each session Bull / Sideways / Bear from the rolling window, then estimates what tends to follow. Display and analysis only; it does not place orders.</p>
      </header>

      <section aria-label="Controls" className="flex flex-wrap items-end gap-6 rounded-2xl border bg-card p-4">
        <label className="grid gap-1 text-xs text-muted-foreground">F&O stock
          <input list="regime-stocks" value={ticker} onChange={(event) => setTicker(event.target.value)} className="h-10 w-44 rounded-lg border bg-background px-3 text-sm text-foreground" placeholder="Search ticker" />
          <datalist id="regime-stocks">{marketSnapshot.map((stock) => <option key={stock.symbol} value={stock.ticker}>{stock.name}</option>)}</datalist>
        </label>
        <Choice legend="Label window (sessions)" name="regime-window" options={WINDOWS} value={window} onChange={setWindow} render={String} />
        <Choice legend="Labelling method" name="regime-method" options={METHODS} value={method} onChange={setMethod} render={(option) => METHOD_LABEL[option]} />
        <Choice legend="Forecast horizon" name="regime-horizon" options={HORIZONS} value={horizon} onChange={setHorizon} render={(option) => `n = ${option}`} />
        <label className="grid gap-1 text-xs text-muted-foreground">As of (close)
          <input type="date" value={asOf} onChange={(event) => setAsOf(event.target.value)} className="h-10 rounded-lg border bg-background px-3 text-sm text-foreground" />
        </label>
      </section>

      {state.kind === 'loading' && <p role="status" className="text-sm text-muted-foreground">Loading daily prices…</p>}
      {state.kind === 'error' && (
        <div role="alert" className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
          {state.message}{state.code === 'NO_TOKEN' || state.code === 'TOKEN_REJECTED' ? ' Use Connect FYERS on the heat map, then reload this tab.' : ''}
        </div>
      )}
      {state.kind === 'data' && <RegimeResult data={state.data} matrixStep={matrixStep} onMatrixStep={setMatrixStep} />}
    </div>
  );
}

function RegimeResult({ data, matrixStep, onMatrixStep }: { data: RegimeResponse; matrixStep: '1' | 'n'; onMatrixStep: (step: '1' | 'n') => void }) {
  const { analysis: a, dataSource } = data;
  const thresholdLabel = a.method === 'vol' ? `z vs threshold ±${REGIME_CONFIG.volThreshold.toFixed(1)}` : `move vs threshold ±${(REGIME_CONFIG.fixedThreshold * 100).toFixed(0)}%`;
  const rows = useMemo(() => a.dates.map((date, i) => ({ date, close: a.closes[i], metric: a.metric[i] })).slice(-CHART_SESSIONS), [a]);
  const bands = useMemo(() => regimeBands(a.dates, a.labels).filter((band) => band.end >= rows[0]?.date), [a, rows]);
  const windowStart = a.dates[Math.max(0, a.dates.length - 1 - a.window)];
  const threshold = a.method === 'vol' ? REGIME_CONFIG.volThreshold : REGIME_CONFIG.fixedThreshold;
  const displayMatrix = a.matrix ? toDisplayMatrix(matrixStep === 'n' && a.nStepMatrix ? a.nStepMatrix : a.matrix) : null;
  const displayCounts = a.counts ? toDisplayMatrix(a.counts) : null;
  const currentRow = a.current ? DISPLAY_ORDER.indexOf(a.current) : -1;
  const chosenScore = a.score?.[String(a.horizon) as '1' | '5' | '10'] ?? null;
  const chosenRow = a.forecast?.[String(a.horizon) as '1' | '5' | '10'] ?? null;

  return (
    <>
      {dataSource.stale && dataSource.staleNote && <div role="alert" className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">{dataSource.staleNote}</div>}
      {a.corporateActionFlags.length > 0 && (
        <div role="alert" className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
          Possible corporate action: a one-day move larger than {REGIME_CONFIG.corporateActionLogMove} in log terms on {a.corporateActionFlags.map((f) => f.date).join(', ')}. Labels around these dates may be distorted.
        </div>
      )}
      {a.gaps.length > 0 && <div role="alert" className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">Missing sessions: gaps longer than {REGIME_CONFIG.gapCalendarDays} days before {a.gaps.map((g) => g.to).join(', ')}. Windows count sessions, so they span these gaps.</div>}
      <p className="text-xs text-muted-foreground">FYERS daily closes, last session {dataSource.lastCandleDate}. {dataSource.adjustmentNote}</p>

      <div className="grid gap-4 md:grid-cols-4">
        <Card title="Current regime" note={a.runLength ? `for ${a.runLength} sessions in a row` : undefined}>
          <div className="flex items-center gap-2 text-2xl font-semibold" style={{ color: a.current ? COLOR[a.current].text : undefined }}>{a.current ?? 'Undefined'}</div>
        </Card>
        <Card title={`${a.window}-session move`} note={a.metricNow === null ? undefined : `${a.method === 'vol' ? `z = ${a.metricNow >= 0 ? '+' : '−'}${Math.abs(a.metricNow).toFixed(2)}` : formatPercent(a.metricNow, 1, true)} ${thresholdLabel}`}>
          <div className="text-2xl font-semibold">{formatPercent(a.windowMove, 2, true)}</div>
        </Card>
        <Card title={`Signal score (n = ${a.horizon})`} note={chosenRow ? `P(Bull) ${chosenRow[2].toFixed(2)} · P(Bear) ${chosenRow[0].toFixed(2)}` : undefined}>
          <div className="text-2xl font-semibold">{a.insufficientHistory || chosenScore === null ? '—' : `${chosenScore >= 0 ? '+' : '−'}${Math.abs(chosenScore).toFixed(2)}`}</div>
        </Card>
        <Card title="Rule decision" note={`θ = ${a.theta.toFixed(2)} placeholder · fixed in development`}>
          <div className="text-2xl font-semibold">{a.decision ?? '—'}</div>
          {a.decisionNote && <p className="text-xs text-muted-foreground">{a.decisionNote}</p>}
        </Card>
      </div>

      <Card title="Price with regime ribbon" note={`Last ${Math.min(CHART_SESSIONS, a.dates.length)} sessions. Background colour = label on the ${a.window}-session window; outlined box = window behind today's label.`}>
        <ul className="flex gap-4 text-xs" aria-label="Regime colour key">
          {STATES.slice().reverse().map((s) => <li key={s} className="flex items-center gap-1.5"><span className="inline-block size-3 rounded-sm border" style={{ background: COLOR[s].band }} />{s}</li>)}
        </ul>
        <div className="h-72" role="img" aria-label={`Price chart with Bull, Sideways and Bear bands, currently ${a.current ?? 'undefined'}`}>
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={rows} margin={{ left: 4, right: 12, top: 8, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} />
              {bands.map((band) => <ReferenceArea key={`${band.start}-${band.label}`} x1={band.start < rows[0].date ? rows[0].date : band.start} x2={band.end} fill={COLOR[band.label].band} fillOpacity={0.7} ifOverflow="hidden" />)}
              <ReferenceArea x1={windowStart < rows[0].date ? rows[0].date : windowStart} x2={rows.at(-1)?.date} stroke="#0b3f73" strokeWidth={1.5} fill="none" />
              <XAxis dataKey="date" minTickGap={48} tick={{ fontSize: 11 }} />
              <YAxis domain={['auto', 'auto']} tick={{ fontSize: 11 }} width={56} />
              <Tooltip />
              <Line dataKey="close" stroke="#0f172a" dot={false} strokeWidth={1.6} isAnimationActive={false} name="Close" />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </Card>

      <Card title={a.method === 'vol' ? `z-score of the ${a.window}-session move (vs prior ${REGIME_CONFIG.volLookback} sessions)` : `${a.window}-session simple return`}>
        <div className="h-44" role="img" aria-label="Metric series with dashed threshold lines">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={rows} margin={{ left: 4, right: 12, top: 8, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="date" minTickGap={48} tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} width={56} />
              <Tooltip />
              <ReferenceLine y={threshold} stroke="#1a7f4b" strokeDasharray="5 4" label={{ value: `+${threshold} Bull`, fontSize: 11 }} />
              <ReferenceLine y={-threshold} stroke="#b42318" strokeDasharray="5 4" label={{ value: `−${threshold} Bear`, fontSize: 11 }} />
              <Line dataKey="metric" stroke="#0b3f73" dot={false} strokeWidth={1.6} connectNulls={false} isAnimationActive={false} name={a.method === 'vol' ? 'z' : 'return'} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </Card>

      {a.insufficientHistory ? (
        <div role="status" className="rounded-xl border p-4 text-sm">Not enough history: {a.definedLabels} labelled sessions, minimum {REGIME_CONFIG.minLabels}. No matrix, forecast or decision is shown.</div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          <Card title="Transition matrix" note={`Built from ${a.definedLabels} labelled sessions before the as-of date (minimum ${REGIME_CONFIG.minLabels}). Highlighted row = today's regime. Diagonal = how sticky each regime is.`}>
            <fieldset className="flex gap-2"><legend className="sr-only">Matrix horizon</legend>
              {(['1', 'n'] as const).map((step) => (
                <label key={step} className={`cursor-pointer rounded-md border px-3 py-1 text-xs ${matrixStep === step ? 'bg-muted font-semibold' : ''}`}>
                  <input type="radio" className="sr-only" name="matrix-step" checked={matrixStep === step} onChange={() => onMatrixStep(step)} />
                  {step === '1' ? '1-step' : `${a.horizon}-step`}
                </label>
              ))}
            </fieldset>
            {a.emptyRows.length > 0 && <p role="alert" className="text-xs text-amber-900">No observed transitions from {a.emptyRows.map((i) => STATES[i]).join(', ')}; that row is all zeros.</p>}
            <table className="w-full border-collapse text-sm">
              <caption className="sr-only">Row = today, column = next session</caption>
              <thead><tr><th scope="col" className="p-1 text-left text-xs text-muted-foreground">From ↓ / To →</th>{DISPLAY_ORDER.map((s) => <th key={s} scope="col" className="p-1 text-xs" style={{ color: COLOR[s].text }}>{s}</th>)}</tr></thead>
              <tbody>
                {DISPLAY_ORDER.map((from, i) => (
                  <tr key={from} className={i === currentRow ? 'bg-muted/60' : ''} aria-current={i === currentRow ? 'true' : undefined}>
                    <th scope="row" className="p-1 text-left text-xs" style={{ color: COLOR[from].text }}>{from}{i === currentRow ? ' (today)' : ''}</th>
                    {DISPLAY_ORDER.map((to, j) => {
                      return <td key={to} className="p-1 text-center"><div className="font-medium">{formatPercent(displayMatrix![i][j], 1)}</div>{matrixStep === '1' && <div className="text-[10px] text-muted-foreground">{displayCounts![i][j]} days</div>}</td>;
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>

          <Card title="Long-run mix" note="Stationary distribution vs the time actually spent in each state.">
            {[{ name: 'Long-run (stationary)', values: a.stationary }, { name: 'Time actually spent', values: a.timeShare }].map((row) => (
              <div key={row.name} className="grid gap-1">
                <div className="text-xs text-muted-foreground">{row.name}</div>
                {row.values ? (
                  <div className="flex h-7 overflow-hidden rounded-md text-[11px] font-semibold" role="img" aria-label={`${row.name}: ${DISPLAY_ORDER.map((s) => `${s} ${formatPercent(row.values![STATES.indexOf(s)], 0)}`).join(', ')}`}>
                    {DISPLAY_ORDER.map((s) => { const v = row.values![STATES.indexOf(s)]; return <div key={s} className="flex items-center justify-center" style={{ width: `${Math.max(0, v) * 100}%`, background: COLOR[s].band, color: COLOR[s].text }}>{v >= 0.08 ? `${s} ${formatPercent(v, 0)}` : ''}</div>; })}
                  </div>
                ) : <p className="text-xs">Unavailable</p>}
              </div>
            ))}
          </Card>

          <Card title={`Forecast path from ${a.current ?? 'undefined'}`} note="Probability of each state after k sessions (row of the matrix power).">
            {a.forecastPath ? (
              <div className="h-52" role="img" aria-label="Forecast probabilities by number of sessions ahead">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={a.forecastPath.map((p) => ({ step: p.step, Bear: p.probs[0], Sideways: p.probs[1], Bull: p.probs[2] }))} margin={{ left: 4, right: 12, top: 8, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} />
                    <XAxis dataKey="step" tick={{ fontSize: 11 }} />
                    <YAxis domain={[0, 1]} tick={{ fontSize: 11 }} width={40} />
                    <Tooltip formatter={(value) => formatPercent(Number(value), 1)} />
                    {STATES.map((s) => <Line key={s} dataKey={s} stroke={COLOR[s].text} dot={false} strokeWidth={2} isAnimationActive={false} />)}
                  </LineChart>
                </ResponsiveContainer>
              </div>
            ) : <p className="text-xs">Forecast unavailable{a.decisionNote ? `: ${a.decisionNote}` : '.'}</p>}
          </Card>

          <Card title="Recent regime changes">
            {a.recentChanges.length === 0 ? <p className="text-xs">No changes in the labelled history.</p> : (
              <ul className="grid gap-1 text-sm">
                {a.recentChanges.map((change) => <li key={change.date} className="flex items-center justify-between border-b py-1"><span>{change.date}</span><span className="flex items-center gap-1.5"><Pill label={change.from} /> → <Pill label={change.to} /></span></li>)}
              </ul>
            )}
          </Card>
        </div>
      )}

      <Card title="Caveats">
        <ul className="list-disc pl-5 text-xs text-muted-foreground">
          <li>Labels come from the past window, so a label is a description, not a prediction. The matrix only counts how labels followed each other.</li>
          <li>The transition matrix assumes tomorrow depends only on today's label. Real markets do not guarantee that.</li>
          <li>θ = {a.theta.toFixed(2)} is a placeholder, fixed in development. Nothing here places or recommends an order.</li>
          <li>{dataSource.adjustmentNote}</li>
        </ul>
      </Card>
    </>
  );
}
```

- [ ] **Step 2: Wire the tab into `app/page.tsx`**

Change `useState<'heatmap' | 'backtest' | 'strategy-lab'>` to include `'markov-regime'`. Import `import { MarkovRegime } from '@/app/markov-regime';` and an icon (`Activity` from `lucide-react`; confirm it exists with `tsc`). Add after the 6-month button:

```tsx
<Button size="sm" variant={activeSurface === 'markov-regime' ? 'secondary' : 'ghost'} onClick={() => setActiveSurface('markov-regime')}><Activity />Markov regime</Button>
```

and extend the render chain so `activeSurface === 'markov-regime' ? <MarkovRegime /> :` comes before the existing branches.

- [ ] **Step 3: Verify**

Run: `npx tsc --noEmit` → exit 0. Run: `npm run lint` and confirm no *new* errors in `app/markov-regime.tsx` or the touched lines of `app/page.tsx` (the 29 baseline errors stay as they are). Run: `npx vitest run` → PASS. Open the tab with no token: it must show the "Connect FYERS" message, not blank data.

- [ ] **Step 4: Commit**

```bash
git add app/markov-regime.tsx app/page.tsx lib/regime
git commit -m "feat(regime): Markov regime tab UI"
```

---

### Task 10: Code review

- [ ] **Step 1:** Invoke `superpowers:requesting-code-review` over the range from `87ce8fe` (last commit before this feature) to HEAD, with this plan and the brief as the requirements.
- [ ] **Step 2:** Record findings in `docs/verification/markov/code-review.md`. Fix Critical and Important findings one at a time, test first, re-running `npx vitest run` and `npx tsc --noEmit` after each. Note any finding left unfixed and why.
- [ ] **Step 3: Commit** `git add -A && git commit -m "fix(regime): address code review findings"`.

---

### Task 11: Live verification (needs the token from option B)

**Files:**
- Create: `docs/verification/markov/screenshots/*.png`, `docs/verification/markov/sweep.md`

- [ ] **Step 1: Confirm the token works**

Run: `curl -s "http://localhost:3000/api/regime?symbol=NSE:TCS-EQ&window=20&method=vol&horizon=5" | python -c "import sys,json; d=json.load(sys.stdin); print(d.get('code') or d['analysis']['current'], d.get('dataSource',{}).get('lastCandleDate'))"`
Expected: a current label and last candle date; if `NO_TOKEN`/`TOKEN_REJECTED`, refresh the token and restart the dev server (tokens expire daily).

- [ ] **Step 2: API sweep for 3 real F&O stocks** (for example TCS, SBIN, RELIANCE) **× 2 methods × 4 windows = 24 calls**, at horizons 1, 5 and 10 for each. For each response check: HTTP 200, `matrix` rows sum to 1 (or 0 for an empty row, listed in `emptyRows`), `stationary` sums to 1, `labels.length === closes.length`, no `NaN`, `dataSource.lastCandleDate` equals the last completed session (or `stale` is true with a note), and record `current`, `score`, `decision`, `corporateActionFlags`. Save the table to `docs/verification/markov/sweep.md`. Any unexpected value is investigated with `superpowers:systematic-debugging`, not adjusted.

- [ ] **Step 3: UI screenshots** — open `localhost:3000`, click "Markov regime", and for each of the 3 stocks and both methods capture a screenshot at each of the 4 windows (24 images) saved as `docs/verification/markov/screenshots/<ticker>-<method>-w<window>.png`. Also capture: the no-token state, an insufficient-history state (choose an as-of date about one year after the first available candle), the corporate-action banner (if any stock in the universe has flags), and the keyboard-only path (Tab through the controls; radios switch with arrow keys).

- [ ] **Step 4: Header label** — with the market shut, confirm the shared header reads "FYERS last close" (not "FYERS live") while on the Markov regime tab; save a screenshot.

- [ ] **Step 5: Existing tabs** — click Market heat map (live and historical), Options payoff test (build one spread), and 6-month strategy test (page loads; do not start a run). Record pass/fail for each in `sweep.md`.

- [ ] **Step 6: Commit** `git add docs/verification && git commit -m "docs(regime): live verification sweep and screenshots"`.

---

### Task 12: Final verification

- [ ] **Step 1:** Run fresh and paste the output in the final report: `npx vitest run` (all suites, including the 8 fixture-parity cases), `npx tsc --noEmit` (expect exit 0), `npm run build` (expect exit 0), `npm run lint` (report the count; no new errors from this feature).
- [ ] **Step 2:** Re-read the brief line by line against `docs/verification/markov/` and produce a checklist: each requirement → evidence path, or "unverified" with the reason.
- [ ] **Step 3:** Confirm no order endpoint was added: `grep -rnE "orders|place_order|cancel_order|modify_order|exit_positions" app lib --include=*.ts --include=*.tsx` returns nothing new; confirm `.env*` is untracked with `git ls-files | grep -c "^\.env"` → `0`.
- [ ] **Step 4:** Report anything unverified as unverified, then hand off with `superpowers:finishing-a-development-branch`.

---

## Self-review

- **Spec coverage:** labels/matrix/stationary/forecast/score/decision/minimum history/as-of truncation (Tasks 2–4); validation, missing days, duplicates, unsorted, flat prices, empty row, <252 labels, future-data test (Tasks 1, 2, 4); data source, adjustment evidence, corporate-action flags, stale and missing-token states (Tasks 6–8); header label (Task 11, using the existing `describeLiveFeed`); API parameters and payload (Task 7; `nStepMatrix` added in Task 4); UI and accessibility (Task 9); review, evidence and existing-tab checks (Tasks 10–12). Each gap the brief leaves open is listed under "Decisions taken".
- **n-step matrix:** `analyzeRegime` returns the full `nStepMatrix` (P^horizon), checked against the fixture forecast row for the current state (Task 4), and the UI toggle uses it for all nine cells.
- **Unverified until executed:** FYERS daily resolution code `D`, the 360-day chunk limit, the epoch-to-IST-date mapping for daily candles, and the adjustment status. Task 8 and Task 11 resolve them; until then they are assumptions.
