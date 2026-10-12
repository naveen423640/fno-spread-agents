---
title: LTP scenarios, from side history to trade
markmap:
  colorFreezeLevel: 2
  maxWidth: 360
---

# LTP scenarios: history to pressure to top and bottom to trade

## 1. Levels and status
- **Support** (put side): holds from below, bottom is EOS or a variant
- **Resistance** (call side): caps from above, top is EOR or a variant
- **Level** = peak of volume or OI nearer the line
  - whole chain counts, in-the-money too
  - tie goes to volume
  - moves only when a peak moves
- **Status** of a level
  - Strong: second-highest at or under 75%
  - WTT: second-highest above the level, over 75%
  - WTB: second-highest below the level, over 75%
  - weak at the strike just left counts at once

## 2. Side history gives pressure
- **Stable strong (S)**: 1 condition
  - Strong since morning (Strong now)
- **Bearish (B)**: 9 conditions
  - Strong but shifted from top to bottom (single shifting) (Strong now)
  - Initially WTT then became strong (Strong now)
  - Shifted from top to bottom [WTT % is there in continuation] and then became WTT at new place and then became strong (not shifted) (Strong now)
  - Shifted from bottom to top became strong, then again shifted from top to bottom at any place and now strong (Strong now)
  - Shifted from bottom to top [WTB % is there in continuation] and then became WTB at new place and also shifted there and now strong (Strong now)
  - Weak towards bottom (WTB now)
  - Shifted from bottom to top became strong and again became WTB at any place (WTB now)
  - Shifted from bottom to top [WTB % is there in continuation] and then WTB at new place (WTB now)
  - Shifted from top to bottom and in that continuation, it is looking WTT (WTT now)
- **Bullish (U)**: 9 conditions
  - Strong but shifted from bottom to top (single shifting) (Strong now)
  - Initially WTB then became strong (Strong now)
  - Shifted from top to bottom became strong, then again shifted from bottom to top at any place and now strong (Strong now)
  - Shifted from top to bottom [WTT % is there in continuation] and then became WTT at new place and also shifted there and now strong (Strong now)
  - Shifted from bottom to top [WTB % is there in continuation] and then became WTB at new place and then became strong (not shifted) (Strong now)
  - Shifted from bottom to top and in that continuation, it is looking WTB (WTB now)
  - Weak towards top (WTT now)
  - Shifted from top to bottom became strong and again became WTT at any place (WTT now)
  - Shifted from top to bottom [WTT % is there in continuation] and then WTT at new place (WTT now)
- **Highly bearish (HB)**: 2 conditions
  - Shifted from top to bottom and again shifted to bottom and now strong (double shifting) (Strong now)
  - Shifted from top to bottom and now again WTB (WTB now)
- **Highly bullish (HU)**: 2 conditions
  - Shifted from bottom to top and again shifted to top and now strong (double shifting) (Strong now)
  - Shifted from bottom to top and now again WTT (WTT now)

## 3. The nine scenarios (status now)
- **1**: support Strong, resistance Strong
- **2**: support Strong, resistance WTB
- **3**: support Strong, resistance WTT
- **4**: support WTB, resistance Strong
- **5**: support WTT, resistance Strong
- **6**: support WTB, resistance WTB
- **7**: support WTT, resistance WTT
- **8**: support WTB, resistance WTT
- **9**: support WTT, resistance WTB

## 4. Pressure pair gives top and bottom
- Read as support pressure, resistance pressure
- **top EOR, no bottom (Blood Bath)**
  - S|HB, B|B, B|HB, HB|S, HB|B, HB|HB
- **no top (Bull Run), bottom EOS**
  - S|HU, U|U, U|HU, HU|S, HU|U, HU|HU
- **top EOR, bottom EOS-1**
  - S|B, B|S, U|HB, HB|U
- **top EOR+1, bottom EOS**
  - S|U, B|HU, U|S, HU|B
- **top EOR+1, bottom EOS-1**
  - B|U, U|B
- **top EOR, bottom EOS**
  - S|S
- **Rare scenario, do not trade**: HB|HU, HU|HB
  - risky top EOR+1 (WTT-1), risky bottom EOS-1 (WTB+1)

## 5. Weak-side variants
- **WTT-1** replaces the top
  - resistance weak toward top now
  - and its pressure is bullish (U or HU)
  - WTT percentage is the key player
- **WTB+1** replaces the bottom
  - support weak toward bottom now
  - and its pressure is bearish (B or HB)
  - WTB percentage is the key player
- A weak side with the other pressure keeps the plain level

## 6. Special outcomes
- **Blood Bath**: no bottom, only the top EOR
  - one side highly bearish and the other strong
  - both highly bearish (EOR-1 also a good top)
  - both plainly bearish (scenario 6)
- **Bull Run**: no top, only the bottom EOS
  - one side highly bullish and the other strong
  - both highly bullish (EOS+1 also a good bottom)
  - both plainly bullish (scenario 7)
- **Stops the Blood Bath / Bull Run**: a highly bearish side against a bullish side gives a bottom EOS-1 again

## 7. Trades and tiers
- [course] The top and bottom come from the pressure of both sides
- [course] WTT-1 / WTB+1 replace the top / bottom only for a weak side with matching pressure
- [course] Highly bearish against highly bullish: do not trade
- [course] The first touch of a level is generally safe; risk rises with each further touch
- [course] Weekly range: risky, moderate and generally safe bands
- [user] Tug of war: risky trades are allowed when both sides push one way, or one pushes highly and the other is stable
- [user] Very high push allows very risky trades at the nearest end of diversion (EOD)
- [user] The live tool shows the risky and moderate levels itself
- **Open questions**
  - Which of the tool's lines is the safe, the moderate and the risky entry in each scenario?
  - What exactly are the tool's Risky, Moderate, Max Pain and Max Gain lines? To be read from the live tool in a session.
  - Stops, targets and time limits per tier.

## 8. Sources and checks
- Practice tool: 529 cases captured and matched by the engine
- Condition meanings confirmed with the owner
- Files: `docs/data/ltp-knowledge-graph.json`, `docs/ltp-coa-verification.md`, `docs/ltp-trade-knowledge.md`
