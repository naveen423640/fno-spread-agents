# Audit: later-phase feasibility (spec section 12 items 4-8, Amendment A2)

All pages read on 2026-10-03. Classes: verified / documented-untested / needs adaptation / unsupported. "unverified: ..." means not confirmed. Nothing here was run against a live service.

## 1. Indian news, filings, fundamentals and results-calendar sources (item 4)

**Headline: the NSE website terms forbid automated collection and, separately, forbid using website data for simulation. This affects the agent data plan and also the NSE archive downloads already used (see audit 01).**

| Source | What was read | Class |
|---|---|---|
| NSE website (announcements, results calendar, corporate filings) | Terms of Use, https://www.nseindia.com/static/nse-terms-of-use, "Updated on: 29/10/2025": "User is prohibited to conduct any systematic or automated data collection activities (including scraping, data mining, data extraction and data harvesting)"; content may not be copied or redistributed without written permission; "Unless the information or Content is available for download, not to aggregate, copy or duplicate"; and "shall not ... use or make the data or Content available on the Website ... for any gaming, virtual trading or simulation activities under any circumstances whatsoever". `robots.txt` (https://www.nseindia.com/robots.txt) allows all except `/market-data-test`, but robots is not the terms. NSE also publishes a Data Sharing and Usage Policy (https://www.nseindia.com/static/market-data/nse-data-policy; found by search, not read). | **unsupported** for automated announcements/calendar scraping. For files "available for download" (bhavcopy archives) the aggregation clause has an exception, but the simulation clause still reads on a paper-trading use. **Needs a decision by the user** (a licence from NSE Data & Analytics, or accept the risk, or switch sources). Not legal advice. |
| BSE announcements / API | https://www.bseindia.com/robots.txt returned the site HTML, not a robots file; BSE terms page returned HTTP 403. | unverified: BSE terms of use for automated access (page blocked) |
| Google News RSS | https://news.google.com/robots.txt: `User-agent: *` has `Disallow: /` with only specific allows (home, topics, publications, stories...), and the `ClaudeBot`/`GPTBot`/`anthropic-ai` agents are disallowed entirely. The RSS search path `/rss/...` is not in the allow list. Google News terms were not read. | **needs adaptation / unverified**. The path the spec names appears disallowed to generic crawlers by robots.txt; do not assume it is usable. |
| Screener.in, Yahoo Finance (yfinance) | A web search returned only a general statement that Yahoo's API is "intended for personal use only"; Screener's terms were not found. | unverified: terms of both (not read) |
| SEBI / company filings via the exchange feeds | Not researched. | unverified: not attempted |

Practical consequence for A2: the News and Fundamentals analysts have **no source confirmed as legal and reliable for programmatic use**. Options to put to the user: (a) a licensed market-data/news vendor, (b) user-supplied text pasted in, (c) FYERS-provided data only (quotes, option chain), (d) accept NSE/Google ToS risk knowingly. The role design already allows "unavailable" analysts.

## 2. Free LLM providers for an OpenAI-compatible TypeScript client (item 5, A2)

Limits change often and several model names on these pages looked unusual; figures are as the page rendered on 2026-10-03.

| Provider | Free-tier limits read | OpenAI-compatible endpoint | Data-use / terms | Class |
|---|---|---|---|---|
| Groq | Free plan, per org: `openai/gpt-oss-120b`, `gpt-oss-20b`: 30 RPM, 1K RPD, 8K TPM, 200K TPD (https://console.groq.com/docs/rate-limits) | Base URL `https://api.groq.com/openai/v1`; `n` must be 1; `logprobs`, `logit_bias`, `messages[].name` unsupported (https://console.groq.com/docs/openai) | unverified: free-tier data retention and commercial-use terms (not read) | documented-untested. The 8K TPM cap is small for multi-analyst prompts that carry option-chain text. |
| Google Gemini API (AI Studio) | Free tier exists, limits shown per model in AI Studio (the docs page lists no fixed numbers); "no billing setup required" (https://ai.google.dev/gemini-api/docs/rate-limits) | Base URL `https://generativelanguage.googleapis.com/v1beta/openai/`, supports streaming, function calling, structured JSON; compatibility layer "remains in beta" (https://ai.google.dev/gemini-api/docs/openai) | Pricing page: free tier "Content used to improve our products: Yes"; paid tier No (https://ai.google.dev/gemini-api/docs/pricing). So **free-tier prompts may be used for training**; do not send anything you would not share. | documented-untested |
| OpenRouter | `:free` model IDs only: 20 requests/min; 50 requests/day with no credits, 1,000/day after buying at least USD 10 of credits (https://openrouter.ai/docs/api-reference/limits) | OpenAI-compatible (not re-checked on a docs page this session) | unverified: per-model upstream data policies | documented-untested. 50/day is too low for a daily batch; 1,000/day needs a USD 10 top-up (a paid action; the A2 default is Rs 0 spend). |
| Cerebras | Free Trial: `gpt-oss-120b` and `qwen-3.8-27b`: 5 RPM, 30K uncached TPM, 90K total TPM, 1M tokens/hour, 1M tokens/day (https://inference-docs.cerebras.ai/support/rate-limits) | unverified: base URL not on the page read | unverified | documented-untested |
| Others (Mistral, GitHub Models, Cloudflare Workers AI) | Not researched | n/a | n/a | unverified: not attempted |

Takeaways: at least three providers (Groq, Gemini, OpenRouter) offer OpenAI-compatible endpoints with a free tier, so the `lib/llm/` fallback-list design is feasible. The numbers are small: one run of 4 analysts + 2 researchers + trader + risk is about 8 to 10 calls, so on-demand single-stock use fits; a daily batch over many candidates will hit the daily token or request caps first. JSON-schema reliability across free models is **unverified**. Class: **documented-untested**; needs a recorded-response replay test plan per A2.7 and real calls by the user to confirm.

### TradingAgents licence notice

- Repository https://github.com/TauricResearch/TradingAgents: GitHub shows "Apache-2.0 license". No NOTICE file was visible on the page. The LICENSE text itself was not read, and the README says the framework "is designed for research purposes" and not for trading advice.
- Apache-2.0 obligations that are standard to that licence (from general knowledge, not from a source read here; verify against the LICENSE text before relying): keep the copyright/licence notice with copied or adapted material, state changes, and include the NOTICE content if one exists. Practical rule for A2: any prompt text adapted from TradingAgents carries a header comment with the project name, its Apache-2.0 licence and a "modified" note, plus a copy of the licence in the repo. Class: **verified** for the licence name; the notice mechanics are **unverified** until the LICENSE file is read.

## 3. Paperclip on Windows (item 6, A2.8)

| Question | Finding | Source | Class |
|---|---|---|---|
| What it is, licence | Open-source agent orchestration (company/org-chart metaphor), MIT, (c) 2026 Paperclip Labs | https://github.com/paperclipai/paperclip | documented |
| Node requirement | Node.js 24.11 or newer; pnpm 9.15+ for source development | repo README; https://github.com/paperclipai/paperclip/blob/master/doc/INSTALLING.md | documented |
| Install command | `npx paperclipai@latest onboard --yes`; from source `pnpm install`, `pnpm dev` | repo README | documented |
| Native Windows | INSTALLING.md lists **macOS, Linux and WSL2**; native Windows PowerShell is not mentioned. The README mentions Windows only for manual installation methods. Service install: systemd user service on Linux/WSL2, LaunchAgent on macOS; elsewhere only foreground `paperclipai run`. A third-party Windows guide (Techmixer, 2026-04-19) tells readers to `pip install paperclip` (a Python package), which conflicts with the Node-based official docs, so it was disregarded. | INSTALLING.md; techmixer (secondary, unreliable) | documented for WSL2; **unverified for native Windows** (not tried) |
| Windows/WSL2 gotchas | A GitHub issue (#1673, "Add Windows/WSL2 setup guide for hermes_local adapter") exists, indicating the WSL2 path needs undocumented configuration for CLI adapters; only the search summary was read. | https://github.com/paperclipai/paperclip/issues/1673 | unverified |
| HTTP adapter calling the app API | The `http` adapter "sends a JSON webhook request to a service you control" (JSON body with `runId`, `agentId`, `context`), expects a 2xx response meaning accepted (not finished), custom headers for auth. **Localhost and private-network addresses are blocked by default**; they can be allowed via `PAPERCLIP_HTTP_ADAPTER_PRIVATE_ENDPOINT_ALLOWLIST` (comma-separated exact origins). | https://docs.paperclip.ing/adapters/http | documented |

Fit with A2.1 (`POST /api/agents/runs` returns a run id): matches the "accept now, work later" 2xx contract. Calling a local app from Paperclip needs the allowlist variable set to the app origin, and the app must send `Authorization`-style shared-secret checking since it is a webhook. Whether Paperclip itself supports a cron-style daily schedule (as opposed to heartbeats) was not confirmed: unverified. Class: **documented-untested**, **needs adaptation** on Windows (WSL2 route). The app's own scheduler remains the simpler alternative.

## 4. Paper capital and per-leg slippage (item 7): USER DECISIONS, not decided here

Questions for the user:

1. **Paper capital.** What account size should the simulation assume? Options to choose from: (a) a round figure that matches what you would really fund (give the number, e.g. Rs 5 lakh, Rs 10 lakh, Rs 25 lakh); (b) derive from your real FYERS funds balance at the start (read-only, needs your decision); (c) several tiers run side by side to see how lot sizes constrain the spread builder. Also: is margin-required capital or max-loss the sizing constraint, and what per-trade risk percent?
2. **Slippage per leg.** The code default is Rs 0.05 per unit per fill (`slippagePerUnit`). Options: (a) keep a flat rupee value; (b) a percent of premium; (c) a tick-based or bid-ask-spread-based rule (needs quote data, which is not captured yet, so it cannot be tuned from bhavcopy); (d) a stress setting double the base value. No source was found to calibrate this; it needs a measured bid/ask sample from the user's own FYERS option chain.

## 5. SEBI and broker requirements for future personal API trading (item 8, informational)

| Item | Finding | Source | Class |
|---|---|---|---|
| Retail algo framework | SEBI circular SEBI/HO/MIRSD/MIRSD-PoD/P/CIR/2025/0000013, 2025-02-04: API access through a broker with a whitelisted static IP, no open APIs, OAuth and 2FA; personal algos need exchange registration through the broker only above an order-per-second threshold. Read via a third-party summary only, the circular PDF copy (cse-india.com) was not opened. | search summaries (Mondaq, FinSecLaw and others) | documented-untested (secondary) |
| FYERS implementation | From 2026-04-01: new API app mapped to one static IP; orders accepted only from that app and IP; 2FA once every trading day; no continuous refresh-token sessions; maximum 10 orders per second; market orders converted to MPP; old apps become data-only; external platforms must be empanelled and hosted within the broker's infrastructure. | https://fyers.in/notice-board/new-sebi-framework-for-retail-algo-trading-from-april-01-2026/ ; https://support.fyers.in/portal/en/kb/articles/how-do-i-activate-the-new-app-for-api-trading-after-april-1-2026 | documented (official FYERS) |
| Relevance | Paper trading and data reads are not affected. A future live path needs a static IP (a home connection or serverless cloud usually has none), daily manual login and a new app. | same | informational |

## Not done

- BSE/Screener/Yahoo terms, Groq/Cerebras/OpenRouter data-use terms and Cerebras base URL, the TradingAgents LICENSE text, native-Windows Paperclip run, Paperclip scheduling, Cloudflare Worker limits (A2.8) were not read or tested.
