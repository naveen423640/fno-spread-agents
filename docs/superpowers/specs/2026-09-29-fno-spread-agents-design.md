# Design Spec: F&O Signal → Debit Spread Paper-Trading System with India-Adapted Agent Team

- **Date:** 2026-09-29
- **Status:** Draft for user review
- **Place in repo:** `docs/superpowers/specs/2026-09-29-fno-spread-agents-design.md`
- **Real-money trading:** DISABLED. Any future live trading needs a separate, explicit user approval, current broker and regulatory checks, and agreed capital limits.

---

## 0. Existing base app (audited 2026-09-29)

The system **extends the user's existing app, "NSE F&O Heat Map"** (source: `fno-heatmap-cloud`, copied to `fno-spread-agents`, no git history carried over). Findings below were verified by reading the code.

**Stack and layout**
- App: Next.js-style, run through `vinext`, deployed to Cloudflare Workers; React 19, Recharts, shadcn, Tailwind 4; lint/format with oxlint/oxfmt.
- Storage: Cloudflare D1 (SQLite) via `env.DB`. The backtest schema is created inline in `lib/backtest/repository.ts`, separately from the drizzle migrations.
- Tests: none. No test files, no test framework, no test script.
- FYERS token: HTTP-only cookie. Secrets live in `.env*` (never read or printed).

**Tabs**

| Tab / feature | Verified behaviour | Planned role |
|---|---|---|
| Market heat map | Static embedded 210-stock list (`lib/market-snapshot.ts`, dated 2026-08-31) + FYERS live quotes; historical mode reads NSE bhavcopy | Market overview page (reuse) |
| Options payoff test | 10 strategy types built from NSE bhavcopy option rows; reports stored in D1 | Reference for the spread builder (adapt) |
| Stock drill-down | 5-min price and OI charts | Trade explanation view (reuse) |
| AI market analyst | OpenAI chat with FYERS quote/option-chain tools; unstructured and unsourced | Starting point only; the agent team is new (build new) |
| 6-month strategy test | Reconstructs the last 6 completed monthly cycles; per cycle takes the top 50 stocks by prior-day option traded value (point-in-time, lot sizes from the archive); builds a bull call and a bear put for every stock with **no signal**; enters at the first-day daily open; exits at 80% target or T-1 close; no stop; R:R minimum 2; flat user-entered slippage and costs; 10 result tables | Reference implementation / test oracle for the Python engine |

**Order paths:** none. The only FYERS calls are OAuth and data reads (`history`, `quotes`, `options-chain-v3`). `EXECUTION_MODE` and `LIVE_EXECUTION_ENABLED` do not exist yet and are added in Phase 0.

**Checks resolved**
1. *Universe:* the live heat map uses a static list, not point-in-time. The 6-month test builds a point-in-time universe per cycle. **Resolved in Phase 0:** historical heat-map mode also filters by the static `marketSnapshot` list (`app/api/market/route.ts`, `fetchHistorical`); replacing it with a dated universe is Phase 1 (`docs/audit/phase0-gate.md`, 0.1).
2. *"FYERS live" label:* confirmed bug. `app/api/market/route.ts` hardcodes `source: 'FYERS live'` and sets `asOf` to the fetch time, with no market-hours or quote-timestamp check. **Fixed** in commit `d085cbd` (`docs/audit/phase0-gate.md`, 0.2).
3. *Date mismatch:* confirmed cause. `app/page.tsx` hardcodes `useState('2026-08-31')` and the snapshot date is hardcoded to match. **Fixed** in commit `a279b47` (`docs/audit/phase0-gate.md`, 0.3).
4. *Real order paths:* none found.
5. *Reuse:* see the classification below.

**Component classification**

| Spec component | Verdict |
|---|---|
| NSE archive fetch/parse | Adapt (options only today; no futures rows, ban list, corporate actions or holiday calendar; trading days found by probing for 404s) |
| Point-in-time universe and lot sizes | Reuse the method; rebuild in the new store with `available_timestamp` |
| Signal engine, strategy YAML and plug-ins | Build new |
| Spread builder | Adapt as reference only (ATM to next strike, R:R fixed at 2, no sizing or expiry logic) |
| Costs (`lib/options-costs.ts`) | Adapt: dated rates exist, but their source is unverified; the engine ignores them and uses a flat number |
| Exits | Adapt (target and forced exit exist; no low-probability, results-date or 3-day rule; exits at T-1) |
| Risk engine, paper broker, ledger, agent team, Paperclip | Build new |
| Dashboard shell, heat map, payoff and OI views | Reuse |
| Backtest results dashboard | Adapt (tied to one result format) |

Reuse decisions in sections 3-10 follow this table.

## 1. Goal and success criteria

**Goal:** find out, honestly, whether a trend + open-interest (OI) signal on NSE stock futures, traded as option debit spreads, has an edge after all Indian costs. Also find out whether an India-adapted agent team (role structure adapted from TradingAgents, built in TypeScript) improves results after AI costs.

**Success means the system answers these questions credibly:**
1. Does trend + OI pick direction better than chance on futures?
2. Do debit spreads built from that signal make money after costs, including at 2× slippage?
3. Does trend + OI beat trend-only?
4. Do the agents' vetoes, reductions and delays improve net results after AI costs, in forward paper trading?

Concluding "no edge" is a valid, successful outcome. No profit is promised or assumed.

## 2. Operating mandate (user-confirmed)

| Item | Decision |
|---|---|
| Capital (future real; used for paper) | ₹5–25 lakh. The paper account is set to one value in this range, chosen in Phase 0. |
| Experience | Experienced, including F&O |
| Signal instrument | NSE stock futures (near month, rolled before expiry) |
| Strategy | **Customizable** via building blocks in config + Python plug-ins. Trend + OI (`trend_oi_v0.1`) is the default first strategy. |
| Traded instrument | Stock option **debit vertical spreads** (bull call / bear put) |
| Credit spreads | OFF. Allowed later only as a separately registered experiment that must show its own edge. |
| Universe | All stocks F&O-eligible **on each date** that pass the options liquidity filter. Point-in-time list and lot sizes. |
| Horizon | Swing: entry after signal; hold until target, early-exit rule, or pre-expiry exit |
| Broker | FYERS, for **data only**. No order-placing code exists. |
| Budget | No fixed amount. Free tiers across multiple LLM providers; paid LLM spend defaults to ₹0. |
| Deployment | **Local only for Phases 1-4.** The dashboard runs locally and reads the engine through a local read-only API. Cloud deployment of the dashboard is deferred and out of scope until after Phase 6. |
| Notifications | Dashboard only (for now) |

## 3. Architecture

```
NSE daily archives (history) + FYERS (live quotes, paper mode)
  → 1 Data store (validated, point-in-time, versioned; DuckDB + Parquet)
  → 2 Signal engine (trend + OI)            [deterministic]
  → 3 Spread builder (strikes, liquidity, R:R, size) [deterministic]
  → 4 Agent team (TypeScript, in the app; Amendment A2) → verdict
  → 5 Risk engine (limits; final gate)      [deterministic, agents cannot modify]
  → 6 Paper broker + single ledger (fills, costs, P&L)
  → 7 Dashboard (local web page)
```

- **Repository layout (approved):** `fno-spread-agents` keeps the existing TypeScript app as the dashboard and adds a new Python `engine/` package (DuckDB + Parquet, ledger, strategy plug-ins, agent team). The existing TypeScript backtest is a reference implementation and test oracle, not the production engine. The engine runs locally. In Phases 1-4 the dashboard also runs locally and reads engine output through a **local read-only API** (bound to localhost, GET only, no endpoint that writes to the ledger or places or cancels anything). The dashboard never writes to the engine. Cloud deployment is deferred.
- Backtest, replay and paper trading all run **the same code for steps 2, 3, 5 and 6**. Only the data source differs.
- Every data record carries `effective_date`, `publication/available_timestamp` and `retrieval_timestamp`. A decision may only read data available before its decision time.
- One ledger is the source of truth, with one logical writer for order and position transitions.

### 3.1 Engine-side FYERS authentication

The app keeps the FYERS token in a browser cookie. The engine cannot use that, so it has its own auth, data-only:
- **Storage:** the engine keeps its FYERS app credentials and access token in a local file outside the repository and outside the browser (path from an environment variable, file permissions restricted to the user). The token is never written to the database, logs, experiment records or LLM prompts, and is never sent to the dashboard.
- **Obtaining a token:** a manual, user-run login step (FYERS OAuth) that writes the token file. The engine never logs in on its own or stores the user's password or PIN.
- **Expiry:** the token's expiry time is recorded when it is stored. The engine checks it at start-up and before each scheduled step. A token within 30 minutes of expiry is reported as `EXPIRING` on the dashboard.
- **Missing, expired or rejected token:**
  - new entries are blocked;
  - data-dependent steps that need live quotes are skipped and marked stale;
  - an incident is recorded once (not repeated per call);
  - the dashboard shows "FYERS token needed";
  - exits are still evaluated with the last valid data and are flagged stale, never filled from fabricated prices.
- **Scope:** the token is used only for data endpoints. The test in section 10 asserts the engine never references a FYERS order endpoint.
- The token lifetime is documented as daily (2FA once per trading day; no unattended refresh) and has not been observed. See section 12 item 1 and `docs/audit/04-fyers.md`.

### 3.2 Oracle parity with the existing 6-month test

The Python engine must reproduce the existing TypeScript 6-month strategy test (`lib/backtest/daily-engine.ts`) before any new strategy is trusted.
- A built-in config `legacy_six_month_v1` mirrors the old rules: the last 6 completed monthly cycles, top 50 stocks by prior-day option traded value, both a bull call and a bear put for every stock, entry at the first trading day's open, ATM long leg and the nearest qualifying short strike, R:R minimum 2, 80% target, no stop, forced exit at the T-1 close, flat per-leg slippage and round-trip costs.
- For the same input archives, the engine's trades and result tables must match the TypeScript output. The comparison uses a fixed data snapshot and is recorded as an experiment.
- Any discrepancy is **investigated and explained**, not assumed to be a bug in either implementation. Each is classified as engine bug, oracle bug, or deliberate difference, and recorded.
- Phase 1 exit gate includes parity on the data layer; the Phase 2/3 gate includes parity on trades and tables.

## 4. Trading rules — default strategy `trend_oi_v0.1` (fixed before any testing)

These are the default values. Everything in sections 4.1–4.3 can be changed per strategy (see 4.5). The risk limits in section 5 cannot.

### 4.1 Direction signal (futures)
- **Long:** futures close above its 20-day and 50-day averages, **and** long buildup (price ↑, OI ↑ over the lookback).
- **Short:** below both averages, **and** short buildup (price ↓, OI ↑).
- **No trade** if trend and OI disagree, the stock is on the F&O ban list, or a results announcement falls before the planned exit.
- The OI lookback length is fixed in the development period and recorded in the experiment log.

### 4.2 Spread construction
- Bull call spread for long signals, bear put spread for short signals. Buy near the money, sell further OTM.
- Expiry: current month; next month if fewer than about 15 calendar days remain.
- Both legs must pass the liquidity filter: minimum OI, minimum volume and a maximum bid-ask spread. Thresholds are fixed in development.
- Maximum profit must be at least 1.5× the debit paid.
- Size = floor(per-trade loss budget ÷ (debit × lot size)). If the result is 0, there is no trade.

### 4.3 Exits (checked at each scheduled review)
1. **Target:** spread value ≥ 80% of maximum profit.
2. **Low probability:** estimated probability of finishing beyond breakeven at expiry < **5%**. It uses the underlying price, days to expiry and implied volatility (live quotes in paper; estimated from closes in backtests). Results are also reported at 10% and 15% for sensitivity only.
3. **Results announcement:** exit before it.
4. **Expiry:** exit at least 3 trading days before expiry (replaces the existing backtest's T-1 exit; needs an NSE holiday calendar). This is a **hard rule** because stock options are physically settled.

There is no fixed stop-loss. Sizing assumes the full debit can be lost.

### 4.4 Fills
- **Backtest:** closing prices plus conservative per-leg slippage. Everything is re-run at 2× slippage.
- **Paper:** live FYERS bid and ask. Buy legs fill at the ask, sell legs at the bid.
- Backtest and paper fills are labelled separately on the dashboard.

### 4.5 Strategy customization

**Format:** a strategy is a versioned YAML file with three parts: `signal`, `spread` and `exits`. Example:

```yaml
id: trend_oi
version: 0.1
signal:
  long:  all: [futures_above_sma(20), futures_above_sma(50), oi_buildup(long, lookback=3)]
  short: all: [futures_below_sma(20), futures_below_sma(50), oi_buildup(short, lookback=3)]
  exclude: [on_ban_list, results_before_exit]
spread: {type: debit_vertical, expiry_min_days: 15, min_reward_risk: 1.5}
exits:  {target_pct_max_profit: 80, min_prob_profit: 5, exit_days_before_expiry: 3, exit_before_results: true}
```

**Building blocks:**
- A library of tested conditions: moving averages, OI buildup types, RSI, MACD, breakouts, momentum and so on.
- Conditions combine with `all` / `any` / `not`.

**Plug-ins:**
- A new kind of condition or strategy is a Python class implementing a fixed interface. It receives only point-in-time data up to the decision time and returns candidates.
- Each plug-in needs unit tests and a leakage test before it can be used.

**Validation:**
- The config is checked against a schema at load time.
- Unknown blocks, missing fields, or anything that tries to set risk limits are rejected.

**Guardrails:**
- Every saved version is registered as an experiment (EXP-###) before testing.
- Open paper trades finish under the version they entered with. Changes apply to new trades only.
- Each version gets one run on the final test period. The dashboard shows the total number of versions tried, because many variants tried means lower confidence in the best one.
- Multiple strategies can run side by side in paper, each with its own P&L, all subject to the shared risk limits.
- A dashboard strategy editor is a later phase, not the first build.

## 5. Risk limits (code-enforced; agents cannot change)

| Limit | Value |
|---|---|
| Maximum loss per trade (full debit) | 1% of capital. Sensitivity also reported at 0.5% and 2%. |
| Open positions | ≤ 5 |
| Positions per sector | ≤ 2 |
| Monthly loss | 10%, then new entries pause until the next month |
| Loss from peak | 20%, then new entries pause until the user reviews |
| Exclusions | Ban-list stocks, illiquid strikes |
| Expiry guard | Alert if any position is open inside the 3-trading-day window |

## 6. Costs

- Per leg: brokerage, STT, exchange transaction charges, SEBI fees, GST, stamp duty.
- Rates live in a **dated config file** (today they are hardcoded in `lib/options-costs.ts`; that module is moved to config and its rates re-verified, and are "documented-untested" until then) verified against official sources (NSE, government, FYERS) in Phase 0. Each historical date uses the rate that applied on that date. No rates are taken from memory.
- AI and running costs are tracked separately. The dashboard reports trading P&L after costs, operating costs, and the **net** of both.

## 7. Agent team (built in TypeScript inside the app; see Amendment A2)

> **Amended 2026-10-03 (A2):** the agent team is built in TypeScript inside this app, not as a pinned Python fork of TradingAgents. TradingAgents (Apache-2.0) is a reference for role structure and prompts only. Where this section and A2 differ, A2 wins. The fork-specific lines below are struck through in meaning: "the fork is pinned" no longer applies; the roles, authority, constraints and Paperclip notes still do unless A2 changes them.

**Structure (role structure adapted from the TradingAgents repo):**
1. **Analyst team (in parallel):**
   - Fundamentals: financials, shareholding, promoter pledges.
   - Sentiment: Indian news and filing tone, since StockTwits and Reddit have weak Indian coverage.
   - News: Indian and global news, macro, NSE/BSE announcements.
   - Technical: MACD, RSI, plus our futures trend and OI data.
2. **Researcher team:** bull and bear debate, which starts after all analyst reports are in.
3. **Trader agent:** writes the proposal, including suggested timing and size.
4. **Risk team + portfolio manager:** the final verdict.

**Authority: veto or scale down only.** The portfolio manager outputs one of:
- `APPROVE`: the code-calculated size is used.
- `REDUCE`: fewer spreads, rounded down. With only 1 spread, the choice is APPROVE or VETO.
- `DELAY`: move from the 9:30 window to the 11:00 window, and no later.
- `VETO`: no trade.

Every verdict requires sourced reasons in a validated schema. The risk engine can only accept or shrink a verdict. The counterfactual (full size, on time) is always recorded.

**Constraints:**
- The team runs only on candidates that pass steps 2 and 3.
- It has no broker credentials and no order tools.
- External content is treated as untrusted data.
- ~~The fork is pinned to a recorded commit.~~ (A2: no fork. The prompt set and model are versioned and recorded per run instead; any prompt text adapted from TradingAgents keeps its Apache-2.0 notice.)
- No decision-log or reflection memory feeds back into prompts during evaluation (A2.5).
- Model, prompt, sources and output are stored for every call. One model is pinned per experiment.
- On LLM failure or quota exhaustion, the candidate is marked `AI_UNAVAILABLE` and the rules pipeline continues.

**Paperclip (orchestration only):**
- Runs the scheduled agent routines, tracks per-agent budgets and cost, keeps the audit trail, and provides pause/stop for agents.
- Never touches the signal, spread, risk, ledger or broker code.
- Verdicts are written to our database, which is authoritative.
- Bound to localhost, with telemetry disabled.
- Our own cost log is kept as a backup.
- Introduced only after the rules engine and paper trading work.

**Existing OpenAI analyst:** the app's current AI analyst (`/api/market-assistant`, `/api/stock-assistant`) calls OpenAI directly and is not part of the agent team. During agent evaluation (Phases 5-6) it must be either (a) routed through the same AI-cost tracker with its model, tokens and cost logged, or (b) disabled. Until one of these is done, agent-versus-rules comparisons are not valid. The decision defaults to disabled.

## 8. Daily schedule (IST, trading days)

| Time | Step | Done by |
|---|---|---|
| 07:45 | Reconcile ledger; load data and ban list; build candidates | Code |
| | Agent team review → verdicts | Agents |
| | Publish plan | Code |
| 09:30 | First entry window (live-quote checks) | Code |
| 11:00 | Position review + last entry window | Code |
| 13:00 | Position review | Code |
| | Midday summary | Agent summary |
| 14:45 | Verify positions and simulated orders; reconcile | Code |
| 15:15 | Pre-close check | Code |
| ~16:00 | Detailed after-close report | Code + agent summary |

Exits are evaluated at every review. The earlier 14:15 flattening step was removed at the user's request.

## 9. Evaluation

1. **Direction study:** trend + OI accuracy on futures forward returns. Stop or rethink if there's no signal.
2. **Historical spread backtest**, compared against:
   - cash (no trading);
   - NIFTY 50 buy-and-hold (a yardstick only, not traded);
   - trend-only spreads;
   - trend + OI spreads.
3. **Forward paper trading:** rules-only vs agent-assisted, running side by side. **The agents are tested in forward paper only**, because historical LLM runs leak future knowledge.

- **Periods**, fixed before any result is viewed: development (oldest), validation (middle), final test (most recent ~12 months, used once), then forward paper.
- **Metrics:**
  - net return after costs;
  - maximum drawdown;
  - trade count;
  - win rate, average win and average loss;
  - expectancy and profit factor;
  - costs as a share of profit;
  - bootstrap confidence ranges;
  - results at 2× slippage.
- **Pre-registered gates:**
  - Trend + OI proceeds to paper only if final-test expectancy is > 0 at 2× slippage **and** it beats trend-only.
  - The agents are kept only if, after ≥ 3 months **and** ≥ 40 paper trades, the agent-assisted net result (after AI costs) beats rules-only.
- **Trial count:** the number of strategy versions tested is reported with every result.
- **Experiment registry:** every run (EXP-###) records hypothesis, parameters, data version, code commit, result and conclusion. Failures are kept.

## 10. Reliability and controls

| Event | Behaviour |
|---|---|
| Stale or missing data | Block new entries; mark valuations stale; record incident; never fabricate prices or fills |
| FYERS disconnect | Reconnect with backoff; no fills while disconnected |
| Restart | Reload ledger, reconcile, catch up on prices before acting |
| Duplicate or out-of-order events | Idempotent handling; no double counting |
| LLM or Paperclip down | Rules pipeline continues; agent steps logged as unavailable |

- **Controls:** pause new entries; cancel pending simulated orders; close all paper positions; stop the system.
- **Test tooling:** Phase 0 adds `vitest` (TypeScript) and `pytest` (engine); the app has neither today.
- **Safety:** `EXECUTION_MODE=paper`, `LIVE_EXECUTION_ENABLED=false`. No order-placement code exists, and a test asserts that no FYERS order endpoint is referenced or called. Secrets stay in a local `.env` and are never sent to an LLM.
- **Dashboard pages:** Today, Trades, Performance, Agents (verdict outcomes and cost by agent/provider/model), Incidents, Experiments.

## 11. Phases and gates

Each gate records a short CEO / CFO / CTO finding and a decision: continue, repair, simplify or stop.

| Phase | Scope | Gate |
|---|---|---|
| 0 | **Status: done pending user items (2026-10-03; see `docs/audit/phase0-gate.md`, section 8).** **First step: `git init` and commit the untouched copy as the baseline** (done: `ed49b10`). Then: codebase audit (done, section 0); verification audit (section 12); add test runners and the no-order-endpoint test; add `EXECUTION_MODE` / `LIVE_EXECUTION_ENABLED`; fix the hardcoded "FYERS live" label and the hardcoded 2026-08-31 date; revise this spec | All assumptions classified: verified / documented-untested / needs adaptation / unsupported |
| 1 | **Status: built; real-data validation (Task 18) pending user decisions (2026-10-03; see `docs/audit/phase1-gate.md`).** Data foundation: NSE F&O history, point-in-time universe, lot sizes, ban list, calendar, corporate actions; replace the static 210-stock heat-map universe with a dated universe; engine-side FYERS auth (section 3.1) | Leakage and integrity tests pass; data-layer oracle parity (section 3.2) |
| 2 | Strategy engine (config building blocks + plug-in interface + schema validation) and direction study for `trend_oi_v0.1` | Signal shows direction value, or stop/rethink |
| 3 | Spread builder, costs, risk engine, paper broker, ledger, historical backtest | Pre-registered backtest gate; oracle parity of trades and tables for `legacy_six_month_v1` |
| 4 | Live paper trading with FYERS data, schedule, reliability, dashboard | Fault-injection tests pass; clean multi-day run |
| 5 | Agent team (TypeScript, A2: v1 may be built earlier, see A2.8) + Paperclip decision + side-by-side forward paper | Agents run within free quotas with valid schemas |
| 6 | Forward evaluation (≥ 3 months, ≥ 40 trades) and readiness review | Evidence report; live trading still OFF |

## 12. Open items for Phase 0 (not assumed)

1. **FYERS:** auth flow, **token lifetime and refresh rules** (how long a token lasts, whether it can be refreshed without a manual login, what the engine sees when it expires), historical depth, **expired futures and options history availability**, WebSocket behaviour, reconnects, rate limits, symbol mapping.
   - **Phase 0 result** (`docs/audit/04-fyers.md`, documented, not observed; probe pending user): token valid for one trading day with a manual 2FA login each day (refresh-token sessions withdrawn from 2026-04-01); expiry codes -8, -15, -16, -17 and HTTP 401 (the "-22" in `lib/regime/fyers-daily.ts` appears in no source); daily history 366 days per request; limits 10/s, 200/min; expired-contract history undocumented.
2. NSE archive coverage and format eras for F&O daily data, including OI. Confirm from real bhavcopy that futures (`STF`) rows carry usable OI; the current parser only reads stock-option rows.
   - The existing preflight code records `EXPIRED_OPTION_HISTORY_UNAVAILABLE` as a failure mode, so treat FYERS expired-contract history as unproven until tested.
   - Which tickers historical heat-map mode uses: resolved, the static list (section 0).
   - **Phase 0 result** (`docs/audit/01-nse-archives.md`): `STF` rows carry usable OI (verified); the UDiFF archive works from 2024-01-01; the bhavcopy publication-time rule is **22:30 IST** (measured file times, max 22:16 IST; the earlier 19:00 IST assumption was contradicted; pending user approval); the ban list is `fo_secban_{DDMMYYYY}.csv`, published the evening before the trade date (forward-looking, so the bhavcopy rule does not apply to it), with a one-line `NIL` form when no stock is banned.
3. Current Indian cost rates and their change dates.
4. Legally and reliably accessible Indian sources for news, filings, fundamentals and results calendars.
5. ~~TradingAgents fork~~ (A2: no fork). Instead: which free LLM providers to use and their current terms and limits; the Apache-2.0 notice for any adapted prompt text; Indian data sources (item 4).
6. Paperclip on the user's OS (the documented service install covers Linux/macOS), plus its Node/pnpm requirements.
7. The paper capital value, and the slippage assumption per leg.
8. Current SEBI and broker requirements for any **future** personal API trading. Informational only; not needed for paper trading.

## 13. Out of scope (for now)

- Real-money execution.
- Intraday trading, index options, credit spreads (except as a later experiment), and HFT.
- OpenBB: no verified Indian point-in-time provider; AGPL licence. It can be revisited if a specific data need appears.
- Notifications beyond the dashboard.
- A dashboard strategy editor (later phase).

---

# Spec Amendment A2: Agent Team Built in TypeScript Inside the App

- **Date:** 2026-10-03
- **Amends:** section 7 (agent team) and section 11 (phases)
- **Status:** Approved by user (build approach). Detailed design to be confirmed in writing-plans.
- **Replaces:** "TradingAgents pinned Python fork". TradingAgents (Apache-2.0) becomes a **reference** for role structure and prompts only. Keep its licence notice on any adapted prompt text.
- **Unchanged:**
  - authority is veto / reduce / delay only;
  - agents are evaluated in forward paper trading only;
  - no broker credentials or order tools for agents;
  - code-enforced risk limits;
  - paper-only mode.

## A2.1 Placement

- `lib/agents/`: role definitions, prompts, zod output schemas and the orchestrator.
- `lib/llm/`: an OpenAI-compatible client with a provider list (free tiers first), fallback order, per-provider rate limiting, and a token and cost log.
- **API:**
  - `POST /api/agents/runs` starts a run (symbol, as-of, candidate) and returns a run id;
  - `GET /api/agents/runs/:id` returns status, step outputs and the verdict.
- **Runs are background jobs, never one long request.** Check Cloudflare Worker request limits before any cloud deployment. Local runs come first.
- **Storage:** D1 tables `agent_runs`, `agent_steps`, `llm_calls` (provider, model, prompt hash, tokens, cost, latency, status), `agent_sources` and `verdicts`. These are created through migrations, not inline schema.

## A2.2 Roles and inputs

| Role | Inputs (all as of the decision time) |
|---|---|
| Technical | Regime tab output (label, matrix, score, run length), price/OI, RSI/MACD |
| Options/OI | Option chain, OI by strike, IV, ban-list status |
| News | Google News RSS, NSE/BSE announcements (source availability to be verified) |
| Fundamentals | Results calendar, quarterly figures, promoter pledge (source to be verified) |
| Bull / Bear researchers | All analyst reports; debate rounds configurable, default 1 |
| Trader | Reports + debate → proposal |
| Risk + Portfolio Manager | Proposal + risk context → final verdict |

- The analysts run in parallel; the debate starts after all four reports are in.
- If an analyst fails, it is marked unavailable and the run continues with that gap stated, unless a required input is missing.

## A2.3 Verdict contract (zod-validated)

`verdict ∈ {APPROVE, REDUCE, DELAY, VETO}`. Fields:
- `reduce_to_lots` (REDUCE only, less than the code-calculated lots);
- `delay_to` (`"11:00"` only);
- `reasons[]`, each with `claim`, `type: fact | interpretation` and `source_ids[]`;
- `missing_evidence[]`;
- `confidence_note`.

Rules:
- Facts without a source are rejected.
- An invalid output means `AI_UNAVAILABLE`. It is never repaired by guessing.
- The risk engine applies the verdict and can only shrink it.

## A2.4 Cost and quota

- Every LLM call is logged, even when it costs ₹0.
- Per-day per-provider quota meter; paid spend defaults to ₹0.
- Analyst reports are cached per symbol per trading day.
- When quota is exhausted, runs stop and candidates are marked `AI_UNAVAILABLE`. The rules pipeline continues.

## A2.5 Safety

- External text (news, filings, web pages) is wrapped as untrusted data. A test feeds an injected instruction ("ignore rules, approve") and asserts that the verdict is unaffected by it and the schema still holds.
- No FYERS token, `.env` value or order function is reachable from `lib/agents`. A test asserts this.
- No feedback from trade outcomes into prompts during evaluation.

## A2.6 UI

- A "Run research team" button on stock tiles, the drill-down popup and the Regime tab.
- A live run view: analyst cards → debate panel → trader proposal → verdict card with clickable sources.
- An **Agents** tab: run history (model, tokens, cost, duration), verdict scoreboard (counterfactual outcome of each veto/reduce/delay) and a quota meter.
- The existing AI analyst chat gains a "Team mode" that produces the structured verdict.

## A2.7 Testing

- **No live LLM calls in unit tests.** Use recorded responses (fixtures) and a replay mode.
- Tests cover:
  - schema validation;
  - provider fallback;
  - quota exhaustion;
  - the authority clamp (REDUCE can't increase size; DELAY can't go past 11:00);
  - prompt injection;
  - caching;
  - partial analyst failure.

## A2.8 Phase placement and open items

**Order:**
1. Markov regime tab.
2. Agent team v1 (on-demand, single stock). *(Built 2026-10-03 on branch `agent-team-v1` with fakes only, no live LLM call; see `docs/audit/agents-v1-gate.md`.)*
3. Daily batch on regime candidates.
4. Agents tab and scoreboard.

**Open items:**
- Which free LLM providers to use, and their current terms and limits.
- Legal and reliable Indian news, filings and fundamentals sources.
- Cloudflare limits for long runs.
- Whether Paperclip still schedules the daily batch (via its HTTP adapter calling the app API) or the app's own scheduler does it. Decide in the plan.

## A2.9 Consistency notes added by the assistant (open points, not part of the approved amendment)

These are places where A2 and the rest of the spec or the current code disagree or leave a gap. Each needs a decision when the agent-team plan is written.

1. **Order versus the main phases.** A2.8 lists Markov tab, then agent team v1, then the daily batch, then the Agents tab. It does not say whether this runs before or after Phases 0 and 1 (the Python data foundation). The main spec put agents in Phase 5, after paper trading works.
2. **"Candidates" before a signal engine exists.** Section 7 says the team runs only on candidates that pass the signal and spread builder (Phases 2 and 3). A2's v1 is on-demand for any single stock, and the daily batch on regime candidates needs a candidate source; today the Markov tab is display-only with a placeholder threshold. Until Phases 2 and 3 exist, runs are exploratory and cannot be used as evidence of edge (evaluation stays forward-paper only).
3. **Data access versus "no token reachable from `lib/agents`".** The Options/OI role needs FYERS option-chain data. The agent code cannot read the token, so data must be gathered by separate server code outside `lib/agents` and passed in as plain, as-of-stamped input objects. This also gives the point-in-time boundary.
4. **Two databases.** Agent data lives in D1 (TypeScript app); market data and the future ledger live in DuckDB (Python engine). "The risk engine applies the verdict" needs a defined hand-off (for example the engine reads verdicts through `GET /api/agents/runs/:id`). The ledger rule "verdicts are written to our database, which is authoritative" must name which database.
5. **Migrations.** A2.1 requires D1 migrations, but the app currently creates its tables inline in `lib/backtest/repository.ts` and keeps drizzle files in `drizzle/`. How migrations are applied locally and on deploy has not been checked.
6. **The existing OpenAI analyst.** The main spec requires it to be routed through the AI-cost tracker or disabled during agent evaluation. `lib/llm/` is the natural tracker, so the two routes (`/api/market-assistant`, `/api/stock-assistant`) should move onto it.
7. **Scheduler.** The Python engine's schedule (section 8) also needs a trigger for the agent step at 07:45-09:30 IST; the Paperclip-versus-app-scheduler decision affects both.
8. **Phase 0 audit items.** "TradingAgents fork feasibility" is replaced by the free-provider terms and the Indian data-source checks (section 12 items 4 and 5).
