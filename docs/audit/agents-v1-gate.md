# Agent team v1 gate record (on-demand, single stock)

- **Date:** 2026-10-03
- **Branch:** `agent-team-v1` (cut from `phase-0-1`)
- **Plan:** `docs/superpowers/plans/2026-10-03-agent-team-v1.md`
- **Spec:** section 7 and Amendment A2 of `docs/superpowers/specs/2026-09-29-fno-spread-agents-design.md`

## 1. Headline

Agent team v1 is built and unit-tested with **fakes and recorded-style scripted replies only. No live LLM call has ever been made**, so nothing here shows that a real model produces output the schemas accept. Phase 1's real-data validation (Task 18) is also still not run. Do not treat any run result as evidence of edge: there is no signal engine yet.

## 2. Verification run on the final tree

| Check | Result |
|---|---|
| `npx vitest run` | 302 passed, 1 skipped (the oracle dump helper, skipped by design on a plain run) |
| `engine/.venv/Scripts/python -m pytest engine/tests -q` | 142 passed |
| `npx tsc --noEmit` | exit 0 |
| `npm run build` | "Build complete" |
| `npm run lint` | 29 errors, the same baseline as before, none in the new files |
| `tests/safety/*` | pass, including the new isolation test |
| Browser check (dev server, built-in browser) | Drill-down button opens the panel; a run ends "AI unavailable" with each analyst's reason; the only console error is the existing 401 from the FYERS chart (not connected) |
| API check with curl | `POST` returns 202 with a run id, 400 for an unknown symbol, `GET` returns 404 for an unknown run |

## 3. A2.7 test categories and where they are covered

| Category | Covered by |
|---|---|
| Schema validation | `lib/agents/schemas.test.ts` |
| Provider fallback | `lib/llm/client.test.ts` |
| Quota exhaustion | `lib/llm/limits.test.ts`, `lib/llm/client.test.ts`, orchestrator test "every call hits the quota" |
| Authority clamp (REDUCE cannot grow, DELAY only to 11:00) | `lib/agents/clamp.test.ts`, `schemas.test.ts`, orchestrator clamp test (also checks the stored outcome), `run-view.test.ts` (`describeVerdict` shows the clamped lots, not the model request) |
| Prompt injection | `lib/agents/untrusted.test.ts`, orchestrator injection test, `tests/agents-injection.test.ts` (a deliberately gullible model, including a case where a rejected report would otherwise carry the injected text into later prompts), `lib/agent-inputs/inputs.test.ts` |
| Caching | orchestrator tests (reuse for same symbol and day, no reuse for another day, live options data is never cached) |
| Partial analyst failure | orchestrator tests (bad JSON from one analyst, unavailable fundamentals). A missing required technical input stops the run before any analyst call (zero LLM requests asserted) |
| No token or env reachable from `lib/agents` | `tests/safety/agents-isolation.test.ts` |
| No LLM calls in unit tests | all LLM use is a fake `LlmClient` or a fake `fetch` |

Two guard tests were mutation-checked: adding `process.env` to a `lib/agents` file fails the isolation test, and removing both untrusted-text wrappers fails the injection test.

## 4. NOT verified (stated plainly)

1. **No live LLM call.** The JSON-only reply contract, prompt wording, token limits and model quality are untested against any real model. A real model that wraps JSON in prose will fail the schema and the run ends `AI_UNAVAILABLE` by design (no repair retry). Expect that to happen often until prompts are tuned against a real provider.
2. **LLM providers.** A default list (Google Gemini, DeepSeek, xAI Grok, Anthropic) is committed in `lib/llm/defaults.ts` and used when `LLM_PROVIDERS` is unset; a provider with no key loaded is skipped. Base URLs, model names, limits and OpenAI-compatibility are from memory and unverified, and costs are set to 0 until real rates are filled in. `GET /api/agents/providers` reports which providers have a key loaded (true or false only). Previously: none chosen. Terms, limits and OpenAI-compatibility of any candidate are unchecked. `LLM_PROVIDERS` is a JSON env setting; with none configured every run ends `AI_UNAVAILABLE` ("no LLM provider configured").
3. **Quota and rate meters are in memory.** They reset on restart and are not shared across Worker instances, so the daily quota is not durable. A durable meter would be derived from the `llm_calls` table (follow-up).
4. **Google News RSS.** One live fetch worked locally (items came back). Its terms of use and long-term availability are unverified, and the headlines are third-party text.
5. **Fundamentals has no source.** The role always reports "no verified source yet".
6. **FYERS-backed inputs** (technical regime, option chain) were exercised only with fakes. No FYERS token was available in this session, so the live path from token to analyst input is untested here.
7. **Ban-list status** is reported as `unknown`; it is not wired to the Python engine.
8. **RSI and MACD** are not computed by the app; the technical analyst says so.
9. **Cloudflare Worker behaviour.** Background execution uses `waitUntil` from `cloudflare:workers` when present, otherwise a detached promise. Locally the detached promise worked (the run finished after the 202). The Worker path, request and CPU limits for multi-step runs, and `waitUntil` lifetimes are untested.
10. **D1 migrations.** The tables are created by `drizzle/0002_agent_team.sql`. Tests apply it to a `node:sqlite` fake. The dev server does not apply `drizzle/` itself, so this branch adds `npm run db:migrate:local` (idempotent) and it was applied to the local dev database. How the deploy host applies `drizzle/` was not checked.
11. **No daily batch, no Agents tab or verdict scoreboard, no button on tiles or the Regime tab, no "Team mode" in the existing chat.** Only the drill-down button and run view exist.
12. **Legacy OpenAI analyst** (`/api/market-assistant`, `/api/stock-assistant`) still calls OpenAI directly, outside the new cost log. Until it is routed through `lib/llm` or disabled, agent-versus-rules comparisons are not valid.
13. **Technical input and past dates.** The option chain is live only, so `options_oi` is unavailable for a past as-of date. News for a past date only includes items the feed still returns.
14. **The start route has no authentication.** It requires an `application/json` body and rejects cross-site browser fetches, and runs are capped per 24 hours from D1 (default 50, `AGENT_RUNS_PER_DAY`). Anyone who can reach the server can still start capped runs, and a run without a FYERS cookie falls back to the server's `FYERS_ACCESS_TOKEN` (the same behaviour as the existing routes). Put it behind the deployment's access control before any cloud deploy. `GET /api/agents/runs/:id` is also unauthenticated (ids are random UUIDs).
15. **Deferred review minors** (not fixed, listed in the ledger): a logging failure can re-spend on the next provider; no bounded wait for a rate-limit slot, so one run (about 8 calls) will fail on a provider limited to about 5 requests per minute; two simultaneous runs both miss the cache; quota can overshoot with parallel calls and a provider that omits usage records 0 tokens; the run view polls forever for a stuck run; 500 responses return raw error text; a few weak tests (`tests/migrate-local.test.ts` second case, `lib/llm/config.test.ts` key-leak case).
16. **Paper capital and slippage** answers are still pending, so there is no code-calculated lot size; runs use `calculatedLots` only if the caller supplies it.

## 5. Status of the A2.9 consistency points

| # | Point | Status |
|---|---|---|
| 1 | Order versus the main phases | Open. Agent team v1 was built before Phase 2; decide the order for the daily batch |
| 2 | Candidates before a signal engine | Open. The run view says it is exploratory and not evidence of edge |
| 3 | Token isolation | Settled in code: gatherers live in `lib/agent-inputs`, pass plain as-of-stamped objects, and a test guards `lib/agents` |
| 4 | Two databases (D1 versus DuckDB) and the verdict hand-off | Open |
| 5 | Migrations | Partly settled: a migration file, a schema, a local apply script; deploy application unverified (item 10 above) |
| 6 | Existing OpenAI analyst | Open (item 12 above) |
| 7 | Scheduler for the agent step | Open |
| 8 | Phase 0 audit items | Free-provider terms and Indian data-source checks remain open |

## 6. Rulings made while building (full list also in the final message)

- `hashPrompt` is async (Web Crypto); replay fixtures are built in the tests instead of a committed hash-keyed file.
- The analyst cache stores the report together with its sources so a reused report keeps valid source ids.
- The service creates the run row before returning 202; the orchestrator creates it only if missing.
- The run view has no separate "trader" phase because debate rounds are configurable.
- An `AI_UNAVAILABLE` run stores its reason as a `run` step so the UI can show it.
- The authority clamp result (applied lots, counterfactual) is stored with the verdict and shown instead of the model's own request.
- The option chain is never cached (live data cannot be reused across as-of dates) and its payload carries the live retrieval time.
- Gap lines in later prompts carry fixed categories only, never model- or feed-written text.
- The start route has a same-origin/JSON guard and a per-day run cap, but no authentication (item 14 above).

## 7. Recommendation

Keep this branch as a working skeleton and, before any further feature, run one controlled live test: pick one free provider, set `LLM_PROVIDERS`, connect FYERS, and run the team on a single stock to see whether real replies pass the schemas. That single run decides whether the prompts need rework. Do not build the daily batch or the Agents tab until it has been done.
