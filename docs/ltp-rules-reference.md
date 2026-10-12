# LTP Calculator rules: what the site actually says

Written 2026-10-12 after reading the whole free course and the practice tools at https://howtouseltpcalculator.in, and watching the live tool at https://nseoptionchain.ltpcalculator.com. **This is a reference, not code.** Part 12 compares each rule with what this app implements and lists the differences. Nothing in the app was changed while writing it.

## 0. How much of this is the site, and how much is my guess

Every rule is tagged with where it comes from:

- **[course]**: stated in a free-course chapter (ch = chapter number, see Part 1).
- **[practice tool]**: shown by the site's own practice tools, including the Detailed Chart of Accuracy tool.
- **[tool, observed]**: seen on the live tool but never explained in the free course. These are descriptions of behaviour, not rules from the author.
- **[inferred]**: my reading. Never present these as the method.

The free course does **not** explain: how EOS and EOR are calculated, the "Risky / Moderate / Max Pain / Max Gain" header, the 9:20 trading strategy, "Live AI lines", the "4 Magical SPOT lines", the "WTT TO STRONG" labels, the banner ("NIFTY IS IN BLOOD BATH"), LTP Blast, LTP Swing or Intraday Kundli. Everything this app does for those is **[inferred]** from observation.

## 1. Sources read

Free course chapters (https://howtouseltpcalculator.in/): 01 futures and options basics, 02 features, 03 greeks, 04 volume, 05 open interest, 06 strike price (imaginary line, intrinsic value), 07 color codes, 08 support and resistance, 09 WTT and WTB, 10 six kinds of reversal, 11 Chart of Accuracy 1.0, 12 game of percentage in WTB, 13 game of percentage in WTT, 14 state of confusion, 15 Chart of Accuracy 2.0, 16 weekly range. Practice tools: support, resistance, weekly range, and the Detailed Chart of Accuracy 1.0 (all 529 selectable combinations were read from the tool's output). Chapters 01 to 03 have no trading rules; 04 and 05 define volume and open interest.

## 2. Basic definitions

- **Strike column** splits the chain: calls on the left, puts on the right. [ch06]
- **Imaginary line** [ch06]: the line between the two adjacent strikes where the current market price sits. The two strikes are "the pair of imaginary line strikes". The tool prints the status of support and resistance and the second-highest percentage on this line.
- **Top and bottom of the chain are inverted** [ch09]: lower strikes are drawn at the top of the screen. "Top of the option chain" means higher strikes, "bottom" lower strikes. WTT = weak towards higher strikes, WTB = weak towards lower strikes.
- **Intrinsic value, grey cells** [ch06, ch07]: a call strike below the market price, or a put strike above it, has intrinsic value and is shown grey. Grey on the volume or OI columns marks the highest value that has become in the money.
- **Volume** [ch04]: contracts traded today; starts at 0 each day; only ever increases; shown in lots on the tool. The author says it is more reliable than OI.
- **Open interest** [ch05]: outstanding written contracts; can rise or fall; carries over from the previous close. Call OI is the bears' (writers') position, put OI the bulls'.
- **OI change** [ch05]: today's OI minus the previous session's closing OI; starts from 0 each morning; can be negative. Chart of Accuracy 2.0 uses it.
- **Lots, not shares** on the tool (NIFTY 65 per lot, SENSEX 20 on 2026-10-12). [tool, observed]

### Color codes [ch07]

| Colour | Call side | Put side |
|---|---|---|
| Blue | highest volume | highest volume |
| Pink | highest OI and highest OI change | lowest OI and lowest OI change |
| Green | lowest OI and lowest OI change | highest OI and highest OI change |
| Grey | the highest volume or OI that is now in the money | same |
| Yellow | second-highest value in a volume or OI column (shown only above 75% of the highest) | same |

## 3. Support and resistance [ch08]

- **Support** is on the put side, **resistance** on the call side.
- Search starts **from the pair of imaginary-line strikes** (both are considered at the start) and moves **towards out-of-the-money strikes**: puts from the higher strike of the pair downward; calls from the lower strike of the pair upward.
- Find the strike with the **highest volume** and the strike with the **highest OI**. **Whichever is closest to the imaginary line is the support (or resistance).** If both are at the same strike, the support is "of both volume and OI".
- The author stresses that volume counts as much as OI.

## 4. Strong, WTT and WTB [ch09, ch12, ch13, practice tools]

**Yellow box.** The second-highest value of a column gets a yellow box only when it is **above 75%** of the highest. A box at a higher strike than the level means WTT; at a lower strike, WTB. The box says the level could shift there. "WTB 92.93%" means the second-highest is 92.93% of the highest.

**Statuses.** Strong (no yellow box that matters), Weak Towards Top, Weak Towards Bottom. The level (strike) itself stays the same; only its status changes.

**If the level is based on both volume and OI (same strike):**

1. Both strong: strong.
2. A yellow box moving **away** from the line: it counts only if **both** metrics move away. One alone: still strong.
3. A yellow box moving **closer** to the line, in either metric: weak at once. Resistance becomes WTB and support becomes WTT.
4. Both weak in opposite directions: priority to the metric moving closer to the line.

**If the level is based on one metric only (volume or OI):**

1. Look at the metric that is closer to the line (the one that decided the level). Its own yellow box decides: strong, WTT or WTB, in either direction.
2. The other metric (the farther one) matters only if its yellow box **crosses or bypasses** the existing level, i.e. sits on the line side of it. Then resistance is WTB and support is WTT. A box that does not reach the level changes nothing.

**Game of percentage** [ch12, ch13]:

- A rising weak percentage means the level will probably shift to that strike. Rising WTB% is bearish; falling WTB% is bullish. Rising WTT% is bullish; falling WTT% is bearish.
- When the second-highest becomes the highest, the level has shifted; the old strike now shows a yellow box by the "second highest" logic. **Ignore that box** at the strike the level just left. It counts again only if it disappears (percentage falls to 75% or below) and then reappears.
- When a yellow box disappears (percentage reaches 75%), the side has become strong and this creates pressure the opposite way: WTB disappearing is bullish (market may reverse from EOS and break resistance, reversing from EOR+1); WTT disappearing is bearish (market may reverse from the next diversion, EOS-1).

## 5. Six kinds of reversal [ch10]

Resistance, extension of resistance (EOR), support, extension of support (EOS), diversion, end of diversion. The market often does not reverse exactly at support or resistance but a few points beyond: EOS is below support, EOR above resistance. **The exact values come from clicking the volume of the strike on the tool**; the course does not give a formula. "+1" means one strike higher (EOR+1, EOS+1), "-1" one strike lower (EOS-1, EOR-1). WTB+1 and WTT-1 are one strike above the weak-towards-bottom strike and one below the weak-towards-top strike.

Diversions are mini supports and resistances between the two levels where profits are booked; each has an "end of diversion" from which a new trade can start. Bullish motive (support to resistance): calls give diversions, puts give ends of diversion. Bearish: the reverse. Count: strikes strictly between support and resistance plus one; none between gives 1; support and resistance at the same strike gives 0. Trade at the extension of resistance with bearish trades, at the extension of support with bullish ones. First hit of any level is generally safe; risk rises with each further hit; if a level breaks, the market reverses from the next diversion.

## 6. Chart of Accuracy 1.0, the nine scenarios [ch11]

| # | Support | Resistance | Top | Bottom |
|---|---|---|---|---|
| 1 | Strong | Strong | EOR | EOS |
| 2 | Strong | WTB | EOR | EOS-1 |
| 3 | Strong | WTT | WTT-1 | EOS |
| 4 | WTB | Strong | EOR | WTB+1 |
| 5 | WTT | Strong | EOR+1 | EOS |
| 6 | WTB | WTB | EOR | none (Blood Bath, no longs) |
| 7 | WTT | WTT | none (Bull Run, no shorts) | EOS |
| 8 | WTB | WTT | not tradable: wait until one side is strong | |
| 9 | WTT | WTB | not tradable: wait until one side is strong | |

## 7. The Detailed Chart of Accuracy 1.0 [practice tool]

The free course says scenarios 8 and 9 are explained in a "Detailed Chart of Accuracy 1.0". The site's practice tool shows it. **Each side is described by its history today, not just its current status**, and the pair of histories gives the expected top and bottom.

### 7.1 The history conditions and their pressure

Each condition maps to one of five classes: **S** stable strong, **B** bearish pressure, **U** bullish pressure, **HB** highly bearish, **HU** highly bullish. The same mapping holds for support and for resistance.

| Condition (as the tool words it) | Class |
|---|---|
| Strong since morning | S |
| Strong but shifted top to bottom (single shifting) | B |
| Strong but shifted bottom to top (single shifting) | U |
| Initially WTB then became strong | U |
| Initially WTT then became strong | B |
| Shifted top to bottom and again shifted to bottom, now strong (double shifting) | HB |
| Shifted bottom to top and again shifted to top, now strong (double shifting) | HU |
| Shifted top to bottom, became strong, then shifted bottom to top somewhere, now strong | U |
| Shifted top to bottom (WTT % in continuation), then WTT at the new place and also shifted there, now strong | U |
| Shifted top to bottom (WTT % in continuation), then WTT at the new place, then strong (not shifted) | B |
| Shifted bottom to top, became strong, then shifted top to bottom somewhere, now strong | B |
| Shifted bottom to top (WTB % in continuation), then WTB at the new place and also shifted there, now strong | B |
| Shifted bottom to top (WTB % in continuation), then WTB at the new place, then strong (not shifted) | U |
| Currently WTB | B |
| Shifted top to bottom and now again WTB | HB |
| Shifted bottom to top and in that continuation it is looking WTB | U |
| Shifted bottom to top, became strong, and again WTB somewhere | B |
| Shifted bottom to top (WTB % in continuation) and then WTB at a new place | B |
| Currently WTT | U |
| Shifted bottom to top and now again WTT | HU |
| Shifted top to bottom and in that continuation it is looking WTT | B |
| Shifted top to bottom, became strong, and again WTT somewhere | U |
| Shifted top to bottom (WTT % in continuation) and then WTT at a new place | U |

(In the tool's text, "double shifting" and the two "shifted ... and now again WTB/WTT" rows read as highly bearish or highly bullish; a few pairs word the same condition as plain bearish or bullish, which I could not separate with certainty. Treat the "highly" rows as probable.)

**What the table says in plain words** [inferred from the table]: the direction of a side is the direction of its **latest** shift or status change (a shift down is bearish, a shift up is bullish; weak towards top is bullish, weak towards bottom bearish; weak that turns strong points the opposite way: WTT-to-strong is bearish, WTB-to-strong bullish). Two shifts in a row the same way, or a shift followed by weakness the same way, make it "highly".

### 7.2 The expected top and bottom from the pair (support class | resistance class)

| Support | Resistance | Top | Bottom |
|---|---|---|---|
| S | S | EOR | EOS |
| S | B | EOR | EOS-1 |
| S | U | EOR+1 (WTT-1 if resistance is currently WTT) | EOS |
| S | HB | EOR | none (Blood Bath) |
| S | HU | none (Bull Run) | EOS |
| B | S | EOR | EOS-1 (WTB+1 if support is currently WTB) |
| B | B | EOR | none (Blood Bath) |
| B | U | EOR+1 (WTT-1 if resistance currently WTT) | EOS-1 (WTB+1 if support currently WTB) |
| B | HU | EOR+1 (WTT-1) | EOS (WTB+1) |
| U | S | EOR+1 | EOS |
| U | B | EOR+1 | EOS-1 |
| U | U | none (Bull Run) | EOS |
| U | HB | EOR | EOS-1 |
| HB | S | EOR | none (Blood Bath) |
| HB | U | EOR (WTT-1) | EOS-1 (WTB+1) |
| HB | HB | EOR (EOR-1 is also a good top) | none (Blood Bath) |
| HU | S | none (Bull Run) | EOS |
| HU | B | EOR+1 | EOS |
| HU | HU | none (Bull Run) | EOS (EOS+1 is also a good bottom) |
| HB | HU, and HU | HB | "Rare scenario: market very volatile, do not trade"; if you must, EOR+1 risky top and EOS-1 risky bottom |

Notes from the tool's explanations: a highly bearish side with a bullish other side "stops the Blood Bath" (and the reverse); where a weak side is currently WTT or WTB the top or bottom uses WTT-1 or WTB+1 and the tool adds that the WTT% or WTB% is "the key player" in deciding that level.

**Consequence:** scenarios 8 and 9 (B|U and U|B) are tradable in the detailed chart: EOR+1 top and EOS-1 bottom (or the WTT-1 and WTB+1 variants).

## 8. State of confusion (SOC) [ch14]

- Applies **only when one side is weak (WTT or WTB) and the other side is strong.** If both are weak, no SOC.
- Time is counted from when the weakness started (when the side became WTT or WTB).
- **1 hour:** the weak side's percentage stays "stable", fluctuating between 2% and 5%, for more than one hour.
- **2 hours:** it fluctuates between 10% and 15%, without the level shifting, for two hours.
- **3 hours:** the level has shifted (top to bottom or bottom to top) and in that continuation shows WTT or WTB, and the percentage is stable or fluctuating (the new level has not become strong) for more than three hours.
- **SOC in support** makes the market **bearish**: it falls from EOR and the bottom is the **diversion of the smallest strike** in the zone of confusion.
- **SOC in resistance** makes it **bullish**: from EOS up to the **diversion of the largest strike** in the confused zone.
- Display [tool, observed]: the header shows "Bullish SOC - 3 hours" when resistance is weak and support strong.

## 9. Chart of Accuracy 2.0 [ch15]

- Entirely based on **open-interest change** of call side and put side, three states each: increasing, decreasing, stable. The "stable" band is not given.
- The OI-change graph is opened by clicking the OI-change value next to a strike, and shows both sides **from 09:15 to now**. The course says to open it for the **ATM strike** (the strike nearest the market, the one with reversal values visible on both sides).
- Valid **09:45 to 14:30**. Not at extensions, especially not on the first hit of an extension; usable when the market is consolidating (range-bound) and at diversions and ends of diversion. After 14:30 both sides often fall and the market is unpredictable.
- Nine outcomes (call OI, put OI): increasing and increasing: reversal from both (consolidation); increasing and stable: reversal at resistance, support may break; increasing and decreasing: reversal at resistance, support will break; stable and increasing: reversal at support, resistance may break out; stable and stable: reversal at both; stable and decreasing: reversal at resistance, support may break; decreasing and increasing: reversal at support, resistance may break out; decreasing and stable: reversal at support, resistance will break out; decreasing and decreasing: unpredictable, avoid.

## 10. Weekly range [ch16, weekly range calculator]

- For indices with a weekly expiry. On the **first trading day of the expiry week at 09:15**, take the market price and the **first out-of-the-money call LTP and put LTP**. S = call LTP + put LTP.
- L1 = price - S to price + S (risky, the market can leave it); L2 = L1 widened by S each side (moderate); L3 = L2 widened by S each side (generally safe). So L3 is price +/- 3S.
- For option writers: sell hedged, outside the range, in increasing size at 1st, 2nd, 3rd strike outside it. The stop-loss is the sum of the two sold LTPs; if one side stops out, keep the other.

## 11. Things seen on the live tool but not explained in the course [tool, observed]

- **Banner** ("NIFTY IS IN BLOOD BATH" or "BULL RUN") was the same on NIFTY, BANKNIFTY and SENSEX on a day when the side statuses differed, and was "BULL RUN" on the December screenshot. It follows the pressure classes of Part 7 (both sides bearish gives Blood Bath), not the plain nine-scenario table.
- **Pill labels** "STRONG, WTT TO STRONG", "WTB-22500 WEAK TOWARDS BOTTOM", "Shifted from Top to Bottom" are entries of a per-side log (time, spot, spot reversal, futures reversal, level label, "shifted" text, direction) opened by clicking the banner. A sample of 13 support rows and 20 resistance rows from 2026-10-12 was captured and the direction mapping in 7.1 reproduces all of them.
- **Header lines** "Risky, Moderate, Max Pain, Max Gain" and the chart's "4 Magical SPOT Lines" (EOR+1, EOR, EOS, EOS-1, Max Pain above and below) are not in the course. By matching numbers on one day: Moderate = EOR, Max Pain = EOR+2, Max Gain = EOS, Risky = EOR-1 normally and the reversal at the weak strike when resistance is WTB. **One day of evidence.**
- **S-REVERSAL columns** show "Break Out" or "Break Down" instead of a number when the level has been passed.
- **Reversal offsets** on 2026-10-12 about 10:30: calls +24 to +27 and puts -21 to -24 near the money, shrinking far out; about 10% of the one-sigma move left to expiry. This is a fit, not a formula from the site.
- **Historical mode** ("HS", pick a date and time) shows any past minute, which allows side-by-side checks.
- **9:20 AM**, **LTP Blast**, **LTP Swing**, **Live AI lines**, **Intraday Kundli**, **Arbitrage stocks**: listed as features, not explained in the free course.

## 12. How the app compares today

Status key: **matches**, **differs**, **missing**, **unknown** (the site gives no rule).

| # | Rule | Status | Detail |
|---|---|---|---|
| 1 | Search both strikes of the pair, towards OTM; closest of highest-volume and highest-OI; tie means both | matches | |
| 2 | Yellow box above 75% of the highest | matches | exactly 75% is strong |
| 3 | Status when the level is based on **both** metrics (away needs both; toward in either; opposite means toward wins) | matches | |
| 4 | Status when the level is based on **one** metric | **fixed 2026-10-12** | The app treats volume and OI symmetrically, each against its own highest strike. The site: the deciding metric's own box counts in either direction; the other metric counts only if its box lies on the line side of the level. Matters whenever volume and OI peak at different strikes. |
| 5 | Ignore the yellow box at the strike a level just left until it vanishes and reappears | matches | |
| 6 | Percentage trend (rising or falling) as a bullish or bearish signal | missing | Only the discrete events (shift, weak, weak turns strong) are used. |
| 7 | Side direction from the latest event (shift down bearish, WTT bullish, WTT-to-strong bearish, ...) | matches | reproduced the captured logs |
| 8 | "Highly" pressure (double shifting, shift then weak the same way) | missing | HB and HU are not distinguished from B and U. |
| 9 | Nine-scenario top and bottom (basic) | matches | |
| 10 | Detailed chart: S|U gives EOR+1 top, B|S gives EOS-1 bottom, etc. | **fixed 2026-10-12** (`lib/ltp/pressure.ts`, `coa1-detailed.ts`; "highly" classes included) | The app picks the level from the scenario's status labels. When the pressure comes from history while the side is now strong, the needed level (EOR+1, or EOS-1) is missing and the app falls back to EOR or EOS. |
| 11 | Scenarios 8 and 9 tradable in the detailed chart | **fixed 2026-10-12** (strategy v0.1 now trades both) | The strategy blocks 8 and 9 on purpose (your brief). Worth reconsidering. |
| 12 | Banner from pressure classes; Blood Bath and Bull Run | matches | Blood Bath or Bull Run when both sides point the same way. Highly bearish or bullish with a strong other side is not handled. |
| 13 | Rare scenario (highly bearish with highly bullish): do not trade | missing | |
| 14 | SOC conditions and timing | partly | One-hour, two-hour and three-hour logic is there; "stable" read as the spread of the percentage. Needs checking against what the tool prints ("Bullish SOC - 3 hours"). |
| 15 | SOC target: diversion of the smallest (or largest) strike in the zone | **fixed 2026-10-12** (`socTarget`; the SOC setup's target) | The agent targets the opposite extension (EOS or EOR) instead. |
| 16 | COA 2.0 on the **ATM strike's** call and put OI change from 09:15 | **differs** | The app uses call OI at the resistance strike and put OI at the support strike, and OI rather than OI change (same slope, different percentages). Needs your decision: your original brief said resistance and support strikes; the course says ATM. |
| 17 | COA 2.0 window and "not on the first hit of an extension" | matches | The "use it when consolidating or at diversions" advice is not modelled. |
| 18 | Weekly range | matches | Computed for every index; the course says only those with a weekly expiry. |
| 19 | Diversions count and direction | matches | |
| 20 | EOS and EOR values | unknown | Proxy fitted to one day; the real values come from the tool's popup. |
| 21 | Risky, Moderate, Max Pain, Max Gain; 9:20 lines and strategy | unknown | Inferred from one day of observation; the course gives no definition. |
| 22 | Entries, stops, targets, trade times, caps | unknown | The course gives levels and scenarios, not an entry or exit system. These are your brief and my choices. |

## 13. Questions that only you or the site can answer

1. COA 2.0: use the ATM strike (course) or the resistance and support strikes (your brief)?
2. Do you want scenarios 8 and 9 traded using the detailed chart (EOR+1 top, EOS-1 bottom), or kept as "do not trade"?
3. Is there a paid or video lesson on the **9:20 strategy**, the **Risky / Moderate / Max Pain / Max Gain** lines and the **AI lines**? Without one, those stay guesses.
4. How should "percentage stable (2% to 5%)" be read in SOC: the range of the percentage over the hour (my reading), or the percentage staying within 2 to 5 of the highest value?
5. Which exact values should EOS and EOR have? The tool's click popup is the only source; a few samples per day logged in the Calibration tab would let the proxy be checked.

## 14. How to validate without writing any trading code

The live tool's historical mode shows any past minute. A direct check, for a day we recorded, is to compare at a handful of times: both side statuses with percentages, the pill labels, the banner, the SOC label, and the S-REVERSAL values for the strikes around the line, against what the app computes from the stored snapshot of the same minute. Differences would show exactly which rules above are wrong, before any rule is changed.
