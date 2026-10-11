# Trade rules for monthly debit spreads (NSE stock F&O)

## Contents
1. Selection filter (bull; mirror for bear)
2. Structure rules
3. Entry trigger
4. Exits and reversal plan
5. Sizing and portfolio rules
6. Indian-market specifics
7. Broker notes: Fyers and Kite
8. Interpreting the backtest

## 1. Selection filter (bull; mirror for bear)
1. Liquid F&O stock: tight option bid/ask, large OI.
2. Trend: close above the 200-DMA and the 50-DMA above the 200-DMA.
3. Relative strength: 3-month return better than the Nifty. Rank and prefer the top of the list.
4. Pullback: RSI(14) roughly 35-48, price at or below the 20-DMA and not more than ~3% below the 50-DMA. RSI below 30 is acceptable only if the stock is above its 200-DMA and the fall has no news cause.
5. Trigger: a close above the previous day's high (or a volume breakout, 1.5x average volume with rising OI).
6. Volatility: realised-vol percentile not elevated (IV percentile below ~50% when real IV data is available). Do not buy spreads right before earnings; IV drops after the result.
7. Event calendar: no earnings, regulatory hearing, or policy date inside the trade window unless the user knowingly accepts it.
Bear mirror: below both averages, negative relative strength, RSI ~52-65 on a bounce into resistance, trigger = close below previous low.

## 2. Structure rules
- Enter 3-4 weeks before the monthly expiry (stock F&O expires on the last Tuesday of the month; confirm on Kite).
- Buy at the money or slightly in the money (about 0.5-0.6 delta).
- Sell roughly one expected move away (1-1.5 expected moves). Expected move over N days is about spot x IV x sqrt(N/365).
- Debit should be about 30-45% of spread width, giving 1.5-2x reward to risk.
- Breakeven within about 0.5 standard deviations; probability of profit ideally 35-40% or more.
- Check the short strike against OI: heavy call OI there is a natural cap.

## 3. Entry trigger
Prefer entering after confirmation (reclaim of the previous day's high, 20-DMA or 200-DMA). Entering on a gap-down bounce with no confirmation is a counter-trend bet: smaller size, tighter stop.

## 4. Exits and reversal plan
- Profit: take 60-70% of max profit rather than waiting for 100%.
- Premium stop: spread value down 50% of the debit.
- Price stop: close below the recent swing low / the low of the capitulation day / the 20-DMA, whichever the thesis relied on.
- Time stop: close 7-10 trading days before expiry if it has not worked, because decay accelerates.
- Trail: once the spread is ~60% of max profit, move the stop to breakeven.
- Early warnings that a trend is reversing: heavy-volume down day, close below the 20-DMA, relative strength rolling over, price falling with OI rising (short build-up), sector weakness.
- Never average down. Re-enter only on a fresh signal.
- Expectancy check: win rate 40% with 2:1 payoff gives about +0.2 R per trade; cutting losers at 50% of the debit improves it, but only if the exits are followed every time.

## 5. Sizing and portfolio
- Risk 1-2% of capital per trade (the debit is the max loss).
- 3-5 positions, different sectors (hospitals move together, banks move together).
- One lot cannot be scaled out; decide all-or-nothing levels up front.

## 6. Indian-market specifics
- Stock options are physically settled: close spreads before expiry day. In-the-money legs held to expiry become delivery obligations with large margin, and a mismatched exercise can create a naked position.
- When closing a spread, buy back the short leg first, then sell the long leg.
- Kite option symbol format: `NFO:<UNDERLYING><YY><MON><STRIKE><CE|PE>`, e.g. `NFO:APOLLOHOSP26OCT8000CE`.
- Orders in a multi-leg basket execute in the sequence with the lowest margin; check the long leg fills first.
- Margin shown for a same-expiry debit spread should be close to the net debit. A much larger number suggests different expiries or a leg that is not hedged: check before executing.
- Kite stop orders and GTTs are awkward for two-leg spreads. Use price alerts on the underlying and exit by hand.
- Lot sizes change over time. Always read the lot size from Kite instrument data.
- Stock option expiry day and weekly Nifty expiry day can be choppy; check the calendar.

## 7. Broker notes: Fyers and Kite
The rules are broker-independent. Only symbols, data calls and lot-size sources differ.

| | Fyers | Kite (Zerodha) |
|---|---|---|
| Equity symbol | `NSE:RELIANCE-EQ` | `NSE:RELIANCE` |
| Index symbol | `NSE:NIFTY50-INDEX` | `NSE:NIFTY 50` |
| Stock option (monthly) | `NSE:RELIANCE26OCT1200PE` | `NFO:RELIANCE26OCT1200PE` |
| Daily history | `history` API, resolution `D` (about 1 year per request, so chunk it) | `get_historical_data`, interval `day` |
| Quotes and depth | `quotes` / `depth` (bids, ask, oi) | `get_quotes` (depth, oi) |
| Lot size | symbol master `NSE_FO.csv` (min lot column) | instruments dump |
| Auth | app id + access token (expires daily) | login link each session |

Fyers specifics
- Rate limits are tight (about 10 requests/second and 200/minute at the time of writing; verify in the Fyers API docs). The script throttles at 0.4 s per call and caches to `cache_fyers/`.
- Use `python fo_spread_screener.py check --symbol HAL --side bull --long 4800 --short 5100 --expiry 26OCT` for a read-only live check: bid/ask on both legs, debit versus width, breakeven, and max loss and profit in rupees per lot.
- Fyers MCP tools worth using, all read-only: `get_chart_data` (candles), `get_option_chain` (underlying like `NSE:HAL-EQ`, check OI at the short strike), `calculate_span_margin` (confirm margin is close to the net debit before trading), `get_funds`, `get_positions`.
- Price alerts on the underlying (`create_price_alert`) are the practical trigger for stops on a two-leg spread, but only create them when the user asks.
- Never call order tools (`create_order`, `create_multi_order`, `exit_positions`, GTT tools) unless the user explicitly requests that specific order.
- Monthly stock F&O currently expires on the last Tuesday of the month; the script computes this but always confirm the expiry on the broker.
- The Fyers integration was written from the API documentation and tested with mocked responses; run `check` on a symbol you can verify by eye in the Fyers app before relying on it.

## 8. Interpreting the backtest
- R = return on the debit risked. Expectancy_R > 0 means positive edge after the 2% slippage assumption.
- The full rule set should beat plain RSI<30 and the uptrend-only baseline, be positive in both halves of history, and have 100+ trades.
- Option prices are modelled (Black-Scholes, IV proxy = 1.1 x 20-day realised volatility, no skew, no real quotes). Treat results as indicative. A positive result is a reason to paper-trade, not to size up.
- If the full rules produce very few signals, loosen one parameter at a time in `P` and re-run; do not tune until the result looks good (that is overfitting).
