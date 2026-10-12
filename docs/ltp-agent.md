# LTP Agent

A paper-trading agent that trades the LTP Calculator rules (see `docs/ltp-levels.md`) on NIFTY, BANKNIFTY and SENSEX (nearest expiry), keeps a journal of every decision, has an LLM review the trades afterwards, and, after 100 closed trades, tests LLM-proposed rule changes on days it never saw. It exists to find out whether, and how, these rules can make money after costs. "They cannot" is an acceptable and valuable answer.

**Paper only. Results are not validated for live trading.** Nothing in the agent can place, modify or cancel an order. A test (`tests/ltp-agent/import-guard.test.ts`) fails the build if any file under `lib/ltp-agent/` or `scripts/ltp-agent.ts` mentions an order term or imports anything beyond the LTP engine, the LLM client, zod, yaml and Node built-ins.

## The knowledge graph

`docs/data/ltp-knowledge-graph.json` (generated from the engine by `scripts/build-ltp-graph.ts`; see also `docs/ltp-scenarios.mindmap.html`) holds the scenarios, side histories, pressure classes, levels, trades and rules, each rule tagged with its source (course, tool, user, ours). The agent uses it in two ways, and never to decide a trade:

- every decision's context has a `graph` entry (`lib/ltp-agent/graph-use.ts`): the pressure pair, the top and bottom the graph gives, the rules that applied, and `consistent`, which is false if the live scenario disagrees with the graph;
- the reviewing model and the experiment-proposing model get the graph as a plain-text RULEBOOK in their instructions, with the open questions listed so they do not invent answers.

The owner's risky-trade rule (a risky short in Blood Bath, a risky long in Bull Run, at the tool's own Risky level) is in the graph and shows in a decision's `graph.rules`, flagged `ownerRuleNotUsedForTrading`: the agent does not trade on it until the live tool's Risky line is defined.

## Hard rules

1. **Claude never decides trades.** A deterministic rule engine plus a versioned strategy file decides, so every result can be reproduced by replay. The LLM only reviews closed trades and proposes experiments.
2. **"No trade" is always valid.** Skipped signals are journaled with the rule that stopped them. Nothing rewards activity, and the gate compares every candidate with doing nothing (Rs 0).
3. **Never fabricate data.** A missing bid or ask, a missed snapshot or a missing hedge quote is flagged on the trade (`fill_quality`, `data_gap`, `no_hedge_quote`), never filled in silently.
4. **Decisions are immutable.** The database refuses any UPDATE or DELETE on a decision. Outcomes and reviews go to separate tables, so nothing learned afterwards can leak into the recorded "why".
5. **Secrets** come only through the app's existing mechanism (`ANTHROPIC_API_KEY`, read through `lib/llm`). Keys are never logged, stored in the journal or committed.

## Architecture

```
recorder (every minute) ──► ltp_snapshots (+ bid, ask, futures price)
                                  │
                       analyzeSession (the LTP engine, pure)
                                  │
   strategy (versioned) ──► signals.evaluate ──► rule trace ──► reason sentence
                                  │
                              agentStep  ──► decision (frozen) ──► BUY book + SELL book
                                  │                                   │
                            journal tables ◄── outcome on close ◄─────┘
                                  │
      daily review (LLM) ─► reviews     weekly summary (observations)
                                  │
        after 100 trades: proposals (LLM, discovery days only)
                                  │
        gate: replay candidate vs current on held-out days ─► your approval ─► next version
```

`agentStep(ctx, underlying, ts)` is the whole loop for one recorded minute. It reads only snapshots up to `ts`, so the live runner (one call per recorded minute) and replay (one call per stored minute) are the same code and give the same journal; a test proves it.

| Piece | File |
|---|---|
| Strategy schema, tunable fields, diffs | `lib/ltp-agent/strategy.ts`, `strategies/ltp_v0.1.yaml` |
| Strategy storage (database, bundled v0.1) | `strategy-store.ts`, `strategy-files.ts` (scripts) |
| Rules, trace, skip reason | `signals.ts`, `reason.ts` |
| Books, fills, costs | `books.ts`, `fills.ts`, `costs.ts`, `config/costs.ts`, `config/lots.ts` |
| Loop, replay, close-out | `agent.ts`, `memory-journal.ts` |
| Journal | `journal-store.ts`, migration `drizzle/0010_ltp_agent.sql` |
| Reviewer, summaries | `reviewer.ts`, `taxonomy.ts` |
| Phases, holdout | `phase.ts`, `holdout.ts` |
| Proposals, gate | `experiments.ts`, `gate.ts`, `metrics.ts`, `bootstrap.ts`, `baseline.ts` |
| Versions, reports, schedule | `versions.ts`, `reports.ts`, `schedule.ts` |
| Tab | `app/ltp-agent-tab.tsx`, `app/ltp-agent-parts/` |
| Routes | `app/api/ltp/agent/{step,review,state,decisions,experiments,report}` |
| Commands | `scripts/ltp-agent.ts` |

## Running it

The recorder must be running (see `docs/ltp-levels.md`); the agent reads what it stores. Start the app, then:

```bash
npm run agent-run
```

This is the scheduler. IST, weekdays only:

| Time | What it does |
|---|---|
| every minute 09:15 to 15:30 | steps the agent for each underlying (a few seconds after the recorder) |
| 15:31 | closes anything still open, flagged as a data gap |
| 15:35 | daily review of the day's closed trades (needs `ANTHROPIC_API_KEY` in the app's environment) |
| Friday 15:40 | asks for proposals (refused until 100 closed trades) |
| first weekday of a month | writes last month's report to `data/agent_reports/YYYY-MM.txt` |

If the recorder stores a minute a few seconds late, the next call processes the missed minute first, so live matches replay. A minute older than 5 minutes is never acted on as if it were tradable: if the agent was away that long, anything open is closed as a data gap and only the fresh minutes are processed. The agent does not know market holidays; on a holiday the jobs find no snapshots and do nothing.

Other commands (the tab offers the same actions):

| Command | What it does |
|---|---|
| `npm run agent-replay -- --from 2026-10-12 --to 2026-10-12 --version 0.1 [--db file] [--underlying sym]` | re-runs the agent over recorded days into a throwaway journal; prints a table and writes `data/agent_replay/*.json`. Needs neither the app nor FYERS. |
| `npm run agent-review -- --date 2026-10-12` | reviews that day's closed trades through the running app |
| `npm run experiment-run -- EXP-001` | runs one proposed experiment through the gate and writes `experiments/EXP-001.json` |
| `npm run report -- --month 2026-10` | prints the monthly readiness report |

Pause and resume paper trading from the tab. Paused means no new decisions or trades; open trades are still managed to their exit.

## The strategy: v2.0 is the default (v0.1 = the pure course rules)

**v2.0** (`strategies/ltp_v2.0.yaml`) is the version the agent runs. It has the same values as v0.1 plus `graph_consistent_required: true`: a signal is skipped (reason `scenario_allowed`, with `graph_consistent: false` in the trace) when the live scenario and the knowledge graph disagree. v0.1 stays loadable for comparison. A new version starts its own 100-trade journal phase, so the learning lock restarts at v2.0.

**Numbered conditions.** Each side's history is named as one of the practice tool's numbered conditions (`lib/ltp/conditions.ts`): 13 for a strong side, 5 for a weak side. The scenario label reads `scenario-S<support>/R<resistance>`, for example `6-S3/R1`, with `~` after a number when the history is not one of the listed shapes (then it is the listed condition of the same pressure). Phases are the stretches between events; a weak or strong spell under 3 minutes is a blink and ignored, a shift never is; a side that has stayed in one phase for 2 hours is in a continuation (both numbers are `LTP_CONFIG.phases`, assumed). The label, the pressure, the phase count and the phase age are in every decision's context (`conditions`) and on the LTP screen.

## The strategy file (v0.1 values)

`strategies/ltp_v0.1.yaml`, validated by a zod schema (unknown keys and bad values are rejected with the field path). Fields: which sides to trade in each COA 1.0 scenario (6 = shorts only, 7 = longs only, 8 and 9 both, as in the Detailed Chart of Accuracy; a side the chart gives no level for is never traded), entry profile, which setups are on, touch tolerance, time window, maximum hit number, COA 2.0 agreement, SOC filter, stop rule and buffer, time exit, level-shift exit, risk caps, book settings and fill settings.

**Only these fields may be changed by the reviewer, each within its bounds** (anything else is rejected automatically):

| Field | Allowed |
|---|---|
| `touch_tolerance_pts` | 1 to 15 |
| `max_hit_number` | whole number 1 to 5 |
| `stop_buffer_pts` | 0 to 30 |
| `require_coa2_agree`, `exit_on_level_shift` | true or false |
| `entry_profile` | risky or moderate |
| `window.start` | 09:30, 09:45 or 10:00 |
| `window.end` | 13:30, 14:00, 14:30 or 14:45 |
| `risk.max_trades_per_day` | whole number 1 to 5 |
| `books.sell.hedge_width` | whole number 2 to 8 |

## Signals and the rule trace

A candidate exists when the spot has just come within `touch_tolerance_pts` of a level (the previous minute was outside the band), so one touch is one decision. Setups: **COA 1.0 reversal** (the scenario's own level, or EOS/EOR, or EOS-1/EOR+1 for the moderate profile), **9:20 lines** (the frozen Risky or Moderate line, from 09:21), **SOC** (a bearish SOC trades a short at EOR, a bullish one a long at EOS, only when the COA setup has no candidate for that touch). End-of-diversion is off and has no trade rule, because the engine does not specify one.

Rules run in this fixed order; the first failure is the skip reason and the trace stops there:

1. `scenario_allowed` (the scenario permits this side and is not blocked)
2. `time_window`
3. `level_touched` (always passed for a candidate; records spot, level, tolerance, previous spot)
4. `valid_plan` (a stop and target exist and sit on the right sides of the entry)
5. `hit_number` (hit number at most `max_hit_number`)
6. `coa2_agree` (always logged; enforced only if `require_coa2_agree`)
7. `soc_opposes` (an opposing State of Confusion blocks the trade)
8. `daily_trade_cap`
9. `max_concurrent`
10. `daily_loss_cap`

If the signal passes but neither book can open (no usable quote), it is journaled as skipped with a failed `book_quote` rule.

**Stop** (`nine_twenty`): EOS-2 minus the buffer for longs, EOR+2 plus the buffer for shorts (`next_level`: the next rung beyond the entry). **Target**: the opposite extension of the live pair (EOR for longs, EOS for shorts). The scenario comes from each side's direction (see `docs/ltp-levels.md`).

The tab's **Today** view starts with "Where the agent would trade now": for each underlying, the levels it is watching (COA 1.0, 9:20 and SOC), how far each is from the spot, the stop and target planned at each, the risk and reward in points, and whether it would trade there on a touch or which rule stops it (for example, the current scenario does not allow that side). The first level that would trade is spelled out as the next trade level. Nothing is journaled or booked from this view.

## The Backtest tab

LTP tab, third sub-tab. Pick one to five recorded days and replay them through any strategy to see what the agent *would* have traded, trade by trade with the reason, plus every skipped signal and why. The strategy can be a stored version (including every version you approve later), an experiment from the agent in any status (its change applied on the version it was proposed against, so you can see what an idea would have done on days the gate never used), and/or your own changes to the ten tunable fields. "Also run the active version" shows the two side by side. The replay runs in a throwaway in-memory journal: nothing is written to the live journal, the active version never changes, and FYERS is not called. Notes warn when a day's recording started late, when fills had no quote, and when a trade was closed only because the recording had a gap. A few days of results are not evidence; the gate is the test. The same replay is available from the shell as `npm run agent-replay`.

## Books, fills and costs

Every signal is booked in both books, so the comparison is fair.

- **BUY**: one lot, ATM (or 1-OTM) call for a long, put for a short.
- **SELL**: one lot of a hedged credit spread: sell the option at the support (long) or resistance (short) strike and buy the same side `hedge_width` strikes further out.
- **Fills**: buys at the ask plus `slippage_ticks` ticks, sells at the bid minus them (tick 0.05). With no quote on that side, LTP plus or minus `fallback_slippage_pct` (2%) and `fill_quality = ltp_fallback`. With no LTP either, or with a fallback buy price below one tick (a worthless option), no fill and no trade.
- **Exits** are driven by the spot levels, checked every minute: data gap, then stop or target (if both are crossed within one step, the stop is booked), then the 15:15 time exit, then a level shift if enabled.
- **Costs**: brokerage, STT (sell side, plus the exercise case), exchange charge, SEBI fee, GST and stamp duty, each rounded to the paisa, with rates by effective date in `lib/ltp-agent/config/costs.ts`. Lot sizes by date in `config/lots.ts` (NIFTY 65, BANKNIFTY 30, SENSEX 20 from 2026-10-01; earlier days throw until rows are added).
- **Per trade**: gross and net P&L, R multiple (net over planned risk: the premium paid for BUY, the maximum loss for SELL), MAE and MFE in spot points and rupees, holding minutes, exit reason (`target`, `stop`, `time`, `level_shift`, `data_gap`), fill quality, and for SELL a margin estimate.

## The decision record

Written once, at decision time, for every candidate (taken or skipped). Fields:

| Group | Contents |
|---|---|
| Identity | `decisionId` (`underlying\|ts\|setup\|direction\|version`, so a re-run is idempotent), `ts`, `tradeDate`, `underlying`, `strategyVersion`, `setup`, `direction`, `book` (`both`), `taken`, `skipReason` |
| Market context | spot, imaginary line, support and resistance strike with status, volume and OI weakness %, scenario and its bias, each side's direction and the banner, COA 2.0 trends and outcome, active SOC, diversion count, the 9:20 lines, the weekly range and the spot's position in it, hit number, minutes since the last level shift, time, days to expiry, the EOS/EOR method, snapshot count |
| Rule trace | every rule checked, in order, with its inputs and whether it passed |
| Reason text | the deterministic sentence built from the trace, e.g. "LONG NIFTY: COA-1 scenario 1 (Strong/Strong; directions neutral/neutral); spot 23,862 touched EOS 23,860 (proxy: IV move) on hit #1; COA-2 = Stable/Increasing agrees; no opposing SOC; 10:01 inside window. SL 23,765, target 24,255, planned risk 97 pts." |
| Expectation | entry, stop, target, planned risk and reward in points, R:R, the level, and per book the planned risk in rupees, margin estimate and fill quality (or why a book could not open) |
| Data quality | snapshot age, fetch latency, the time the day's history starts (`historyFrom`), gaps so far, book skips |

Outcomes live in `trade_outcomes` (one row per decision and book) and reviews in `trade_reviews`, both linked by `decision_id`.

## The review and its mistake taxonomy

After 15:35 each closed trade is shown to the model (the Anthropic provider, model from `AGENT_REVIEW_MODEL`, default `claude-sonnet-5-5`): the frozen decision, both outcomes and a minute-by-minute path of spot, levels, weakness % and OI at the walls. It must answer with JSON, validated against a schema; invalid output is retried once, then logged as a failure (a trade is left alone after 3 failed days). Held-out days are never reviewed, even when asked for by date.

- `outcome_class`: `good_trade_good_result`, `good_trade_bad_result` (rules followed, normal variance), `bad_trade` (a rule or data problem), `lucky_win`
- `mistake_tags`, from a fixed list: `level_shifted_after_entry`, `scenario_flipped_after_entry`, `entered_late_hit`, `coa2_conflict_ignored`, `soc_conflict`, `stop_too_tight`, `stop_too_wide`, `target_too_far`, `premium_decay`, `gamma_spike`, `slippage_or_spread`, `late_in_day`, `expiry_day_effect`, `proxy_extension_error`, `data_gap`, `other` (an unknown tag becomes `other` with a note)
- `what_happened` (2 to 4 sentences), `lesson` (1 sentence), `confidence` (0 to 1)

The weekly summary (tag frequencies; P&L by setup, scenario, hit number, time bucket, underlying and book; BUY versus SELL) is observations only.

## Phases and the gate

**Phase 1, journal only**: the first 100 closed trades of a strategy version (a trade is one taken signal booked in both books; the counter is across all underlyings). No rule changes; the tab shows "Journal phase: 37 / 100 trades".

**Phase 2** unlocks at exactly 100. **Proposals**: the model sees the discovery set only (never holdout trades, their stats or their reviews; the exclusion is in the database query) and may propose at most 3 experiments per run, each a diff over the tunable fields. Each becomes a permanent `EXP-###` record (kept in the database and exported to `experiments/`); experiments are never deleted.

**Holdout**: the chronologically last 30% of recorded trading days at the time of the split (whole days, at least one on each side). A fresh split is made when a new version is adopted. Days recorded after a split count as discovery.

**The gate** replays the candidate and the current version over the same holdout days (deterministically) and judges each book separately. All criteria must hold:

1. at least 30 holdout trades for the candidate
2. net expectancy per trade above the current version's, after costs
3. profit factor at least the current one's
4. max drawdown no worse than the current one's plus 10%
5. better than at least the 90th percentile of the random-entry baseline (same number of trades, same times of day, same stop and target distances, 200 seeded runs; the percentile is reported)
6. expectancy above 0 (it beats doing nothing)

A seeded bootstrap 90% interval of the expectancy difference is always reported; if it includes 0 the result is flagged "weak evidence". The running count of experiments tried is shown next to every result. A pass in either book makes the experiment `awaiting_approval`; otherwise `rejected_by_gate`.

**Approval** is yours, in the tab. It creates the next version (for example `ltp_v0.2.yaml` content with a changelog line), makes it the active paper version, and starts that version's own journal phase. **Rollback** reactivates any earlier version; nothing is deleted.

**Monthly report** (`npm run report`): per version and book, trades, win rate, expectancy, profit factor, max drawdown, the percentile versus random entry (for versions created by an experiment), top mistake tags with their trend, and a yes or no on whether the evidence is stable out of sample (two consecutive versions or months each with at least 30 trades and a positive net expectancy after costs). Going live is out of scope; the report never recommends it.

## Assumptions and proxies

Read every number on screen with these in mind. None of it has been validated against the real LTP Calculator or the market.

- **EOS and EOR** are proxies (default `iv_move`, fitted to 14 strikes captured from the real tool on one day; see `docs/ltp-levels.md`). Every level, stop, target and 9:20 line depends on them.
- **Directions, the banner and the scenario number** are inferred from the real tool's logs. The tool's logs start at 09:15; a recorder that starts later cannot reproduce the history, and each decision records `historyFrom` so such days can be excluded from learning.
- **COA 2.0 band and lookback** (5% stable band, 30 minutes) are mine. "Agrees" means the COA 2.0 outcome reads "at both" or at the trade's side.
- **SOC** is read as the spread of weakness % over the whole weak run; the SOC setup's entry and target are my reading (EOR for bearish, EOS for bullish; target the opposite extension).
- **Entry levels**: the COA setup's risky and moderate profiles are EOS/EOR and EOS-1/EOR+1; the 9:20 setup uses the rebuilt Risky and Moderate lines. End-of-diversion is not implemented.
- **Target and stop** rules are my reading of the course (the opposite extension; the EOR+2 or EOS-2 level plus a 10-point buffer).
- **Hit number** counts approaches within 5 points per day for the engine; the agent counts entries into the strategy's own band.
- **Cost rates** are the ones in `lib/options-costs.ts` where it has them. Brokerage (Rs 20 per order), STT on exercise (0.125%) and the BSE transaction rate are my readings, marked "confirm" in `config/costs.ts`. Clearing and IPFT charges are not modelled. The rates have effective dates; earlier dates throw.
- **Lot sizes** are known only from 2026-10-01.
- **Margin estimate** for SELL is (spread width minus credit) times the lot size, labelled an estimate; no SPAN calculation.
- **Slippage**: one tick (0.05) on top of the quote, and 2% on LTP when there is no quote. Snapshots recorded before bid and ask capture was added (during the 2026-10-12 session) carry neither, so their fills are `ltp_fallback`.
- **Planned risk** (for R multiples) is the premium paid for BUY and the maximum loss for SELL, not the stop distance.
- **Same-minute ambiguity**: we have one spot per minute, so "stop and target in the same minute" means both levels were crossed within one step between snapshots; the stop is booked.
- **Random baseline** anchors the SELL book's short strike two strikes beyond the spot, not at the support or resistance strike.
- **Gate thresholds**: the 90th percentile bar and the 10% drawdown slack (the latter from the brief) are the numbers I used; a null profit factor means no losing trade.
- **Holdout**: days recorded after a split are discovery, so the holdout is not literally the latest 30% once new days arrive.
- **The Anthropic endpoint** is the app's existing OpenAI-compatible provider entry; I have not verified it against Anthropic's current documentation.

## What to expect

With about 370 one-minute snapshots a day and at most 3 trades per underlying per day, 100 closed trades will take weeks, and the gate needs at least 30 trades per book on held-out days on top of that. Until then the agent only journals. If after months no candidate ever passes, that is the answer the project was built to find.
