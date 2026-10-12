# LTP Calculator, Detailed Chart of Accuracy: every case, and our check of it

Source: the free course's practice tool, https://howtouseltpcalculator.in/chart-of-accuracy-practice-tool/. Captured on 2026-10-13 by selecting every available combination and reading the result and the tool's one-line explanation. Raw data: `docs/data/ltp-coa-practice-tool.json` (529 cases, 44 explanations; the checksums of the rows and explanations were compared with the live page after copying). Generated from that file, so the tables below cannot drift from it.

## 1. What the tool is

You pick the **COA box** (1.1 to 1.9: the current status of the two sides, the same nine as the basic chart of accuracy), then the **history condition** of the support and of the resistance. It shows the **expected top** (red) and **expected bottom** (green), and a sentence saying why. The boxes and their sizes:

| Box | Support now | Resistance now | Conditions offered (support x resistance) | Cases |
|---|---|---|---|---|
| 1.1 | Strong | Strong | 13 x 13 | 169 |
| 1.2 | Strong | WTB | 13 x 5 | 65 |
| 1.3 | Strong | WTT | 13 x 5 | 65 |
| 1.4 | WTB | Strong | 5 x 13 | 65 |
| 1.5 | WTT | Strong | 5 x 13 | 65 |
| 1.6 | WTB | WTB | 5 x 5 | 25 |
| 1.7 | WTT | WTT | 5 x 5 | 25 |
| 1.8 | WTB | WTT | 5 x 5 | 25 |
| 1.9 | WTT | WTB | 5 x 5 | 25 |
| | | | **Total** | **529** |

(The page's own FAQ says 625 scenarios; the tool actually offers 529.)

A strong side has 13 history conditions, a weak side 5. They are listed in section 4. Results use only these levels: top is EOR, EOR+1 or WTT-1 (or none: **Bull Run**); bottom is EOS, EOS-1 or WTB+1 (or none: **Blood Bath**).

## 2. How we checked our engine against it

`tests/ltp/coa-practice-tool.test.ts` runs every case. Each history condition is turned into an event log of one side, in the exact words our logs use (`tests/support/coa-practice-tool.ts`, section 4 shows the mapping). `pressureOf()` reads the side's pressure class from that log and its current status, and `selectDetailed()` returns the top and bottom. The result is compared with the tool.

**Result: all 529 cases agree** (521 ordinary cases give the same top and bottom; the 8 rare-scenario cases give the same risky levels and are marked not tradable). The test fails if any case stops matching.

The comparison found, and we fixed, one thing the course text did not show: **WTT-1 and WTB+1 replace the top or bottom only when the weak side also carries the matching pressure.** A resistance that is WTT now but shifted down earlier keeps the plain EOR top; a support that is WTB now but shifted up earlier keeps the plain EOS or EOS-1 bottom. Our first version replaced on current status alone and was wrong in 45 cases.

**What the check does not prove.** It proves our engine reproduces the tool *given our translation of each condition into events* (section 4). If a translation is wrong, the engine can agree with the tool for the wrong reason. Section 4 is where to verify our reading of the conditions.

## 3. The rules the tool shows

1. Each side is **stable strong (S), bearish (B), bullish (U), highly bearish (HB) or highly bullish (HU)**, from its history (the tool's own words in its explanations).
2. **Blood Bath** = no bottom (highly bearish pressure, or both sides bearish). **Bull Run** = no top (highly bullish, or both bullish). A highly bearish side against a bullish side "stops the Blood Bath" and gets a bottom of EOS-1 (or WTB+1); highly bullish against bearish stops the Bull Run.
3. **Highly bearish against highly bullish** (either way round) is the **rare scenario**: "market is very volatile, do not trade". The tool still names the **risky** levels: top EOR+1 (WTT-1) and bottom EOS-1 (WTB+1). This is the only place this tool uses the word *risky*.
4. **WTT-1** replaces the top, and **WTB+1** the bottom, for a side that is weak now and bullish (resistance) or bearish (support) in pressure. The explanation then adds: "WTT %AGE (or WTB %AGE) IS KEY PLAYER TO DECIDE THE TOP (OR BOTTOM)": the weak percentage decides how far that level is trusted.
5. Both sides highly bearish: no bottom, top EOR, and "EOR-1 can also be a good level as top". Both highly bullish: no top, bottom EOS, and "EOS+1 can also be a good level as bottom".

The tool says nothing about moderate or safe entries, stops or targets. Those are not in this tool.

## 4. The history conditions, and how we translated them into events

Verify this table: it is our reading, not the tool's. `init` = stable strong at the start, `down` / `up` = a level shift ("Shifted from Top to Bottom" / "Bottom to Top"), `wtt` / `wtb` = a weak-toward-top / bottom row, `fromWtt` / `fromWtb` = "WTT TO STRONG" / "WTB TO STRONG" row.

**Strong side (13)**

| # | The tool's wording | Our event log |
|---|---|---|
| 0 | STRONG SINCE MORNING | `init` |
| 1 | STRONG BUT SHIFTED FROM TOP TO BOTTOM (SINGLE SHIFTING) | `init, down` |
| 2 | STRONG BUT SHIFTED FROM BOTTOM TO TOP (SINGLE SHIFTING) | `init, up` |
| 3 | INITIALLY WTB THEN BECAME STRONG | `wtb, fromWtb` |
| 4 | INITIALLY WTT THEN BECAME STRONG | `wtt, fromWtt` |
| 5 | SHIFTED FROM TOP TO BOTTOM AND AGAIN SHIFTED TO BOTTOM AND NOW STRONG (DOUBLE SHIFTING) | `init, down, down` |
| 6 | SHIFTED FROM BOTTOM TO TOP AND AGAIN SHIFTED TO TOP AND NOW STRONG (DOUBLE SHIFTING) | `init, up, up` |
| 7 | SHIFTED FROM TOP TO BOTTOM BECAME STRONG, THEN AGAIN SHIFTED FROM BOTTOM TO TOP AT ANY PLACE AND NOW STRONG | `init, down, up` |
| 8 | SHIFTED FROM TOP TO BOTTOM [WTT % IS THERE IN CONTINUATION] AND THEN BECAME WTT AT NEW PLACE AND ALSO SHIFTED THERE AND NOW STRONG | `init, down, wtt, up` |
| 9 | SHIFTED FROM TOP TO BOTTOM [WTT % IS THERE IN CONTINUATION] AND THEN BECAME WTT AT NEW PLACE AND THEN BECAME STRONG (NOT SHIFTED) | `init, down, wtt, wtt, fromWtt` |
| 10 | SHIFTED FROM BOTTOM TO TOP BECAME STRONG, THEN AGAIN SHIFTED FROM TOP TO BOTTOM AT ANY PLACE AND NOW STRONG | `init, up, down` |
| 11 | SHIFTED FROM BOTTOM TO TOP [WTB % IS THERE IN CONTINUATION] AND THEN BECAME WTB AT NEW PLACE AND ALSO SHIFTED THERE AND NOW STRONG | `init, up, wtb, down` |
| 12 | SHIFTED FROM BOTTOM TO TOP [WTB % IS THERE IN CONTINUATION] AND THEN BECAME WTB AT NEW PLACE AND THEN BECAME STRONG (NOT SHIFTED) | `init, up, wtb, wtb, fromWtb` |

**Weak toward bottom (5)**

| # | The tool's wording | Our event log |
|---|---|---|
| 0 | WEAK TOWARDS BOTTOM | `wtb` |
| 1 | SHIFTED FROM TOP TO BOTTOM AND NOW AGAIN WTB | `wtb, down, wtb` |
| 2 | SHIFTED FROM BOTTOM TO TOP AND IN THAT CONTINUATION, IT IS LOOKING WTB | `init, up, wtb` |
| 3 | SHIFTED FROM BOTTOM TO TOP BECAME STRONG AND AGAIN BECAME WTB AT ANY PLACE | `init, up, wtb, fromWtb, wtb` |
| 4 | SHIFTED FROM BOTTOM TO TOP [WTB % IS THERE IN CONTINUATION] AND THEN WTB AT NEW PLACE | `init, up, wtb, wtb` |

**Weak toward top (5)**

| # | The tool's wording | Our event log |
|---|---|---|
| 0 | WEAK TOWARDS TOP | `wtt` |
| 1 | SHIFTED FROM BOTTOM TO TOP AND NOW AGAIN WTT | `wtt, up, wtt` |
| 2 | SHIFTED FROM TOP TO BOTTOM AND IN THAT CONTINUATION, IT IS LOOKING WTT | `init, down, wtt` |
| 3 | SHIFTED FROM TOP TO BOTTOM BECAME STRONG AND AGAIN BECAME WTT AT ANY PLACE | `init, down, wtt, fromWtt, wtt` |
| 4 | SHIFTED FROM TOP TO BOTTOM [WTT % IS THERE IN CONTINUATION] AND THEN WTT AT NEW PLACE | `init, down, wtt, wtt` |

## 5. Every result

Cells read `top / bottom`; `–` means none (Bull Run has no top, Blood Bath no bottom). Cells in brackets are the rare scenario (do not trade; the levels shown are the risky ones). Rows are the support condition number, columns the resistance condition number from section 4.

### Box 1.1: support Strong, resistance Strong

| Support \ Resistance | R0 | R1 | R2 | R3 | R4 | R5 | R6 | R7 | R8 | R9 | R10 | R11 | R12 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| **S0** | EOR / EOS | EOR / EOS-1 | EOR+1 / EOS | EOR+1 / EOS | EOR / EOS-1 | EOR / – | – / EOS | EOR+1 / EOS | EOR+1 / EOS | EOR / EOS-1 | EOR / EOS-1 | EOR / EOS-1 | EOR+1 / EOS |
| **S1** | EOR / EOS-1 | EOR / – | EOR+1 / EOS-1 | EOR+1 / EOS-1 | EOR / – | EOR / – | EOR+1 / EOS | EOR+1 / EOS-1 | EOR+1 / EOS-1 | EOR / – | EOR / – | EOR / – | EOR+1 / EOS-1 |
| **S2** | EOR+1 / EOS | EOR+1 / EOS-1 | – / EOS | – / EOS | EOR+1 / EOS-1 | EOR / EOS-1 | – / EOS | – / EOS | – / EOS | EOR+1 / EOS-1 | EOR+1 / EOS-1 | EOR+1 / EOS-1 | – / EOS |
| **S3** | EOR+1 / EOS | EOR+1 / EOS-1 | – / EOS | – / EOS | EOR+1 / EOS-1 | EOR / EOS-1 | – / EOS | – / EOS | – / EOS | EOR+1 / EOS-1 | EOR+1 / EOS-1 | EOR+1 / EOS-1 | – / EOS |
| **S4** | EOR / EOS-1 | EOR / – | EOR+1 / EOS-1 | EOR+1 / EOS-1 | EOR / – | EOR / – | EOR+1 / EOS | EOR+1 / EOS-1 | EOR+1 / EOS-1 | EOR / – | EOR / – | EOR / – | EOR+1 / EOS-1 |
| **S5** | EOR / – | EOR / – | EOR / EOS-1 | EOR / EOS-1 | EOR / – | EOR / – | (EOR+1 / EOS-1) | EOR / EOS-1 | EOR / EOS-1 | EOR / – | EOR / – | EOR / – | EOR / EOS-1 |
| **S6** | – / EOS | EOR+1 / EOS | – / EOS | – / EOS | EOR+1 / EOS | (EOR+1 / EOS-1) | – / EOS | – / EOS | – / EOS | EOR+1 / EOS | EOR+1 / EOS | EOR+1 / EOS | – / EOS |
| **S7** | EOR+1 / EOS | EOR+1 / EOS-1 | – / EOS | – / EOS | EOR+1 / EOS-1 | EOR / EOS-1 | – / EOS | – / EOS | – / EOS | EOR+1 / EOS-1 | EOR+1 / EOS-1 | EOR+1 / EOS-1 | – / EOS |
| **S8** | EOR+1 / EOS | EOR+1 / EOS-1 | – / EOS | – / EOS | EOR+1 / EOS-1 | EOR / EOS-1 | – / EOS | – / EOS | – / EOS | EOR+1 / EOS-1 | EOR+1 / EOS-1 | EOR+1 / EOS-1 | – / EOS |
| **S9** | EOR / EOS-1 | EOR / – | EOR+1 / EOS-1 | EOR+1 / EOS-1 | EOR / – | EOR / – | EOR+1 / EOS | EOR+1 / EOS-1 | EOR+1 / EOS-1 | EOR / – | EOR / – | EOR / – | EOR+1 / EOS-1 |
| **S10** | EOR / EOS-1 | EOR / – | EOR+1 / EOS-1 | EOR+1 / EOS-1 | EOR / – | EOR / – | EOR+1 / EOS | EOR+1 / EOS-1 | EOR+1 / EOS-1 | EOR / – | EOR / – | EOR / – | EOR+1 / EOS-1 |
| **S11** | EOR / EOS-1 | EOR / – | EOR+1 / EOS-1 | EOR+1 / EOS-1 | EOR / – | EOR / – | EOR+1 / EOS | EOR+1 / EOS-1 | EOR+1 / EOS-1 | EOR / – | EOR / – | EOR / – | EOR+1 / EOS-1 |
| **S12** | EOR+1 / EOS | EOR+1 / EOS-1 | – / EOS | – / EOS | EOR+1 / EOS-1 | EOR / EOS-1 | – / EOS | – / EOS | – / EOS | EOR+1 / EOS-1 | EOR+1 / EOS-1 | EOR+1 / EOS-1 | – / EOS |

### Box 1.2: support Strong, resistance WTB

| Support \ Resistance | R0 | R1 | R2 | R3 | R4 |
|---|---|---|---|---|---|
| **S0** | EOR / EOS-1 | EOR / – | EOR+1 / EOS | EOR / EOS-1 | EOR / EOS-1 |
| **S1** | EOR / – | EOR / – | EOR+1 / EOS-1 | EOR / – | EOR / – |
| **S2** | EOR+1 / EOS-1 | EOR / EOS-1 | – / EOS | EOR+1 / EOS-1 | EOR+1 / EOS-1 |
| **S3** | EOR+1 / EOS-1 | EOR / EOS-1 | – / EOS | EOR+1 / EOS-1 | EOR+1 / EOS-1 |
| **S4** | EOR / – | EOR / – | EOR+1 / EOS-1 | EOR / – | EOR / – |
| **S5** | EOR / – | EOR / – | EOR / EOS-1 | EOR / – | EOR / – |
| **S6** | EOR+1 / EOS | (EOR+1 / EOS-1) | – / EOS | EOR+1 / EOS | EOR+1 / EOS |
| **S7** | EOR+1 / EOS-1 | EOR / EOS-1 | – / EOS | EOR+1 / EOS-1 | EOR+1 / EOS-1 |
| **S8** | EOR+1 / EOS-1 | EOR / EOS-1 | – / EOS | EOR+1 / EOS-1 | EOR+1 / EOS-1 |
| **S9** | EOR / – | EOR / – | EOR+1 / EOS-1 | EOR / – | EOR / – |
| **S10** | EOR / – | EOR / – | EOR+1 / EOS-1 | EOR / – | EOR / – |
| **S11** | EOR / – | EOR / – | EOR+1 / EOS-1 | EOR / – | EOR / – |
| **S12** | EOR+1 / EOS-1 | EOR / EOS-1 | – / EOS | EOR+1 / EOS-1 | EOR+1 / EOS-1 |

### Box 1.3: support Strong, resistance WTT

| Support \ Resistance | R0 | R1 | R2 | R3 | R4 |
|---|---|---|---|---|---|
| **S0** | WTT-1 / EOS | – / EOS | EOR / EOS-1 | WTT-1 / EOS | WTT-1 / EOS |
| **S1** | WTT-1 / EOS-1 | WTT-1 / EOS | EOR / – | WTT-1 / EOS-1 | WTT-1 / EOS-1 |
| **S2** | – / EOS | – / EOS | EOR+1 / EOS-1 | – / EOS | – / EOS |
| **S3** | – / EOS | – / EOS | EOR+1 / EOS-1 | – / EOS | – / EOS |
| **S4** | WTT-1 / EOS-1 | WTT-1 / EOS | EOR / – | WTT-1 / EOS-1 | WTT-1 / EOS-1 |
| **S5** | WTT-1 / EOS-1 | (WTT-1 / EOS-1) | EOR / – | WTT-1 / EOS-1 | WTT-1 / EOS-1 |
| **S6** | – / EOS | – / EOS | EOR+1 / EOS | – / EOS | – / EOS |
| **S7** | – / EOS | – / EOS | EOR+1 / EOS-1 | – / EOS | – / EOS |
| **S8** | – / EOS | – / EOS | EOR+1 / EOS-1 | – / EOS | – / EOS |
| **S9** | WTT-1 / EOS-1 | WTT-1 / EOS | EOR / – | WTT-1 / EOS-1 | WTT-1 / EOS-1 |
| **S10** | WTT-1 / EOS-1 | WTT-1 / EOS | EOR / – | WTT-1 / EOS-1 | WTT-1 / EOS-1 |
| **S11** | WTT-1 / EOS-1 | WTT-1 / EOS | EOR / – | WTT-1 / EOS-1 | WTT-1 / EOS-1 |
| **S12** | – / EOS | – / EOS | EOR+1 / EOS-1 | – / EOS | – / EOS |

### Box 1.4: support WTB, resistance Strong

| Support \ Resistance | R0 | R1 | R2 | R3 | R4 | R5 | R6 | R7 | R8 | R9 | R10 | R11 | R12 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| **S0** | EOR / WTB+1 | EOR / – | EOR+1 / WTB+1 | EOR+1 / WTB+1 | EOR / – | EOR / – | EOR+1 / WTB+1 | EOR+1 / WTB+1 | EOR+1 / WTB+1 | EOR / – | EOR / – | EOR / – | EOR+1 / WTB+1 |
| **S1** | EOR / – | EOR / – | EOR / WTB+1 | EOR / WTB+1 | EOR / – | EOR / – | (EOR+1 / WTB+1) | EOR / WTB+1 | EOR / WTB+1 | EOR / – | EOR / – | EOR / – | EOR / WTB+1 |
| **S2** | EOR+1 / EOS | EOR+1 / EOS-1 | – / EOS | – / EOS | EOR+1 / EOS-1 | EOR / EOS-1 | – / EOS | – / EOS | – / EOS | EOR+1 / EOS-1 | EOR+1 / EOS-1 | EOR+1 / EOS-1 | – / EOS |
| **S3** | EOR / WTB+1 | EOR / – | EOR+1 / WTB+1 | EOR+1 / WTB+1 | EOR / – | EOR / – | EOR+1 / WTB+1 | EOR+1 / WTB+1 | EOR+1 / WTB+1 | EOR / – | EOR / – | EOR / – | EOR+1 / WTB+1 |
| **S4** | EOR / WTB+1 | EOR / – | EOR+1 / WTB+1 | EOR+1 / WTB+1 | EOR / – | EOR / – | EOR+1 / WTB+1 | EOR+1 / WTB+1 | EOR+1 / WTB+1 | EOR / – | EOR / – | EOR / – | EOR+1 / WTB+1 |

### Box 1.5: support WTT, resistance Strong

| Support \ Resistance | R0 | R1 | R2 | R3 | R4 | R5 | R6 | R7 | R8 | R9 | R10 | R11 | R12 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| **S0** | EOR+1 / EOS | EOR+1 / EOS-1 | – / EOS | – / EOS | EOR+1 / EOS-1 | EOR / EOS-1 | – / EOS | – / EOS | – / EOS | EOR+1 / EOS-1 | EOR+1 / EOS-1 | EOR+1 / EOS-1 | – / EOS |
| **S1** | – / EOS | EOR+1 / EOS | – / EOS | – / EOS | EOR+1 / EOS | (EOR+1 / EOS-1) | – / EOS | – / EOS | – / EOS | EOR+1 / EOS | EOR+1 / EOS | EOR+1 / EOS | – / EOS |
| **S2** | EOR / EOS-1 | EOR / – | EOR+1 / EOS-1 | EOR+1 / EOS-1 | EOR / – | EOR / – | EOR+1 / EOS | EOR+1 / EOS-1 | EOR+1 / EOS-1 | EOR / – | EOR / – | EOR / – | EOR+1 / EOS-1 |
| **S3** | EOR+1 / EOS | EOR+1 / EOS-1 | – / EOS | – / EOS | EOR+1 / EOS-1 | EOR / EOS-1 | – / EOS | – / EOS | – / EOS | EOR+1 / EOS-1 | EOR+1 / EOS-1 | EOR+1 / EOS-1 | – / EOS |
| **S4** | EOR+1 / EOS | EOR+1 / EOS-1 | – / EOS | – / EOS | EOR+1 / EOS-1 | EOR / EOS-1 | – / EOS | – / EOS | – / EOS | EOR+1 / EOS-1 | EOR+1 / EOS-1 | EOR+1 / EOS-1 | – / EOS |

### Box 1.6: support WTB, resistance WTB

| Support \ Resistance | R0 | R1 | R2 | R3 | R4 |
|---|---|---|---|---|---|
| **S0** | EOR / – | EOR / – | EOR+1 / WTB+1 | EOR / – | EOR / – |
| **S1** | EOR / – | EOR / – | EOR / WTB+1 | EOR / – | EOR / – |
| **S2** | EOR+1 / EOS-1 | EOR / EOS-1 | – / EOS | EOR+1 / EOS-1 | EOR+1 / EOS-1 |
| **S3** | EOR / – | EOR / – | EOR+1 / WTB+1 | EOR / – | EOR / – |
| **S4** | EOR / – | EOR / – | EOR+1 / WTB+1 | EOR / – | EOR / – |

### Box 1.7: support WTT, resistance WTT

| Support \ Resistance | R0 | R1 | R2 | R3 | R4 |
|---|---|---|---|---|---|
| **S0** | – / EOS | – / EOS | EOR+1 / EOS-1 | – / EOS | – / EOS |
| **S1** | – / EOS | – / EOS | EOR+1 / EOS | – / EOS | – / EOS |
| **S2** | WTT-1 / EOS-1 | WTT-1 / EOS | EOR / – | WTT-1 / EOS-1 | WTT-1 / EOS-1 |
| **S3** | – / EOS | – / EOS | EOR+1 / EOS-1 | – / EOS | – / EOS |
| **S4** | – / EOS | – / EOS | EOR+1 / EOS-1 | – / EOS | – / EOS |

### Box 1.8: support WTB, resistance WTT

| Support \ Resistance | R0 | R1 | R2 | R3 | R4 |
|---|---|---|---|---|---|
| **S0** | WTT-1 / WTB+1 | WTT-1 / WTB+1 | EOR / – | WTT-1 / WTB+1 | WTT-1 / WTB+1 |
| **S1** | WTT-1 / WTB+1 | (WTT-1 / WTB+1) | EOR / – | WTT-1 / WTB+1 | WTT-1 / WTB+1 |
| **S2** | – / EOS | – / EOS | EOR+1 / EOS-1 | – / EOS | – / EOS |
| **S3** | WTT-1 / WTB+1 | WTT-1 / WTB+1 | EOR / – | WTT-1 / WTB+1 | WTT-1 / WTB+1 |
| **S4** | WTT-1 / WTB+1 | WTT-1 / WTB+1 | EOR / – | WTT-1 / WTB+1 | WTT-1 / WTB+1 |

### Box 1.9: support WTT, resistance WTB

| Support \ Resistance | R0 | R1 | R2 | R3 | R4 |
|---|---|---|---|---|---|
| **S0** | EOR+1 / EOS-1 | EOR / EOS-1 | – / EOS | EOR+1 / EOS-1 | EOR+1 / EOS-1 |
| **S1** | EOR+1 / EOS | (EOR+1 / EOS-1) | – / EOS | EOR+1 / EOS | EOR+1 / EOS |
| **S2** | EOR / – | EOR / – | EOR+1 / EOS-1 | EOR / – | EOR / – |
| **S3** | EOR+1 / EOS-1 | EOR / EOS-1 | – / EOS | EOR+1 / EOS-1 | EOR+1 / EOS-1 |
| **S4** | EOR+1 / EOS-1 | EOR / EOS-1 | – / EOS | EOR+1 / EOS-1 | EOR+1 / EOS-1 |

## 6. The tool's explanations

The 44 distinct sentences the tool shows (index: text):

0. BOTH SUPPORT & RESISTANCE ARE STABLE STRONG, SO EOR IS THE TOP & EOS IS THE BOTTOM.
1. SUPPORT IS STABLE STRONG BUT RESISTANCE HAS BEARISH PRESSURE, SO EOR CAN BE THE TOP & EOS-1 CAN BE BOTTOM.
2. SUPPORT IS STABLE STRONG BUT RESISTANCE HAS BULLISH PRESSURE, SO EOR+1 CAN BE THE TOP & EOS CAN BE BOTTOM.
3. SUPPORT IS STABLE STRONG BUT RESISTANCE HAS HIGHLY BEARISH PRESSURE, SO EOR CAN BE THE TOP BUT THERE IS NO BOTTOM (BLOOD BATH).
4. SUPPORT IS STABLE STRONG BUT RESISTANCE HAS HIGHLY BULLISH PRESSURE, SO EOS CAN BE THE BOTTOM BUT THERE IS NO TOP (BULL RUN).
5. RESISTANCE IS STABLE STRONG BUT SUPPORT HAS BEARISH PRESSURE, SO EOR CAN BE THE TOP & EOS-1 CAN BE BOTTOM.
6. BOTH SUPPORT & RESISTANCE HAS BEARISH PRESSURE, SO THERE IS NO BOTTOM (BLOOD BATH) BUT EOR CAN BE THE TOP.
7. RESISTANCE HAS BULLISH PRESSURE BUT SUPPORT HAS BEARISH PRESSURE, SO EOR+1 CAN BE THE TOP & EOS-1 CAN BE THE BOTTOM.
8. RESISTANCE HAS HIGHLY BULLISH PRESSURE (BULL RUN) BUT SUPPORT HAS BEARISH PRESSURE, THIS WILL STOP THE BULL RUN, SO EOR+1 CAN BE THE TOP & EOS CAN BE THE BOTTOM.
9. RESISTANCE IS STABLE STRONG BUT SUPPORT HAS BULLISH PRESSURE, SO EOR+1 CAN BE THE TOP & EOS CAN BE BOTTOM.
10. RESISTANCE HAS BEARISH PRESSURE BUT SUPPORT HAS BULLISH PRESSURE, SO EOR+1 CAN BE THE TOP & EOS-1 CAN BE THE BOTTOM.
11. BOTH SUPPORT & RESISTANCE HAS BULLISH PRESSURE, SO THERE IS NO TOP (BULL RUN) BUT EOS CAN BE THE BOTTOM.
12. RESISTANCE HAS HIGHLY BEARISH PRESSURE (BLOOD BATH) BUT SUPPORT HAS BULLISH PRESSURE, THIS WILL STOP THE BLOOD BATH, SO EOS-1 CAN BE THE BOTTOM & EOR CAN BE THE TOP.
13. RESISTANCE IS STABLE STRONG BUT SUPPORT HAS HIGHLY BEARISH PRESSURE, SO EOR CAN BE THE TOP BUT THERE IS NO BOTTOM (BLOOD BATH).
14. SUPPORT HAS HIGHLY BEARISH PRESSURE (BLOOD BATH) BUT RESISTANCE HAS BULLISH PRESSURE, THIS WILL STOP THE BLOOD BATH, SO EOS-1 CAN BE THE BOTTOM & EOR CAN BE THE TOP.
15. BOTH SUPPORT & RESISTANCE HAS HIGHLY BEARISH PRESSURE, SO THERE IS NO BOTTOM AT ALL (BLOOD BATH) BUT EOR CAN BE THE TOP (EOR-1 CAN ALSO BE A GOOD LEVEL AS TOP).
16. RARE SCENARIO : MARKET IS VERY VOLATILE, DO NOT TRADE . BUT IF ANYONE WANTS TO TRADE THEN EOR+1 CAN BE THE RISKY TOP & EOS-1 CAN BE THE RISKY BOTTOM.
17. RESISTANCE IS STABLE STRONG BUT SUPPORT HAS HIGHLY BULLISH PRESSURE, SO EOS CAN BE THE BOTTOM BUT THERE IS NO TOP (BULL RUN).
18. SUPPORT HAS HIGHLY BULLISH PRESSURE (BULL RUN) BUT RESISTANCE HAS BEARISH PRESSURE, THIS WILL STOP THE BULL RUN, SO EOR+1 CAN BE THE TOP & EOS CAN BE THE BOTTOM.
19. RARE SCENARIO : MARKET IS VERY VOLATILE, DO NOT TRADE. BUT IF ANYONE WANTS TO TRADE THEN EOR+1 CAN BE THE RISKY TOP & EOS-1 CAN BE THE RISKY BOTTOM.
20. BOTH SUPPORT & RESISTANCE HAS HIGHLY BULLISH PRESSURE, SO THERE IS NO TOP AT ALL (BULL RUN) BUT EOS CAN BE THE BOTTOM (EOS+1 CAN ALSO BE A GOOD LEVEL AS BOTTOM).
21. SUPPORT IS STABLE STRONG BUT RESISTANCE HAS BULLISH PRESSURE, SO WTT-1 CAN BE THE TOP & EOS CAN BE BOTTOM, WTT %AGE IS KEY PLAYER TO DECIDE THE TOP.
22. SUPPORT IS STABLE STRONG BUT RESISTANCE HAS BULLISH PRESSURE, SO WTT-1 CAN BE THE TOP & EOS CAN BE TOP, WTT %AGE IS KEY PLAYER HERE TO DECIDE THE TOP
23. RESISTANCE HAS BULLISH PRESSURE BUT SUPPORT HAS BEARISH PRESSURE, SO WTT-1 CAN BE THE TOP & EOS-1 CAN BE THE BOTTOM, WTT %AGE IS KEY PLAYER TO DECIDE THE TOP.
24. RESISTANCE HAS HIGHLY BULLISH PRESSURE (BULL RUN) BUT SUPPORT HAS BEARISH PRESSURE, THIS WILL STOP THE BULL RUN, SO WTT-1 CAN BE THE TOP & EOS CAN BE THE TOP, WTT %AGE IS KEY PLAYER HERE TO DECIDE THE TOP
25. RESISTANCE HAS BULLISH PRESSURE BUT SUPPORT HAS BEARISH PRESSURE, SO WTT-1 CAN BE THE TOP & EOS-1 CAN BE THE TOP, WTT %AGE IS KEY PLAYER HERE TO DECIDE THE TOP
26. SUPPORT HAS HIGHLY BEARISH PRESSURE (BLOOD BATH) BUT RESISTANCE HAS BULLISH PRESSURE, THIS WILL STOP THE BLOOD BATH, SO EOS-1 CAN BE THE BOTTOM & WTT-1 CAN BE THE TOP, WTT %AGE IS KEY PLAYER TO DECIDE THE TOP.
27. RARE SCENARIO : MARKET IS VERY VOLATILE, DO NOT TRADE . BUT IF ANYONE WANTS TO TRADE THEN WTT-1 CAN BE THE RISKY TOP & EOS-1 CAN BE THE RISKY TOP, WTT %AGE IS KEY PLAYER HERE TO DECIDE THE TOP
28. SUPPORT HAS HIGHLY BEARISH PRESSURE (BLOOD BATH) BUT RESISTANCE HAS BULLISH PRESSURE, THIS WILL STOP THE BLOOD BATH, SO EOS-1 CAN BE THE BOTTOM & WTT-1 CAN BE THE TOP, WTT %AGE IS KEY PLAYER HERE TO DECIDE THE TOP
29. RESISTANCE IS STABLE STRONG BUT SUPPORT HAS BEARISH PRESSURE, SO EOR CAN BE THE TOP & WTB+1 CAN BE BOTTOM, WTB %AGE IS KEY PLAYER HERE TO DECIDE THE BOTTOM.
30. RESISTANCE HAS BULLISH PRESSURE BUT SUPPORT HAS BEARISH PRESSURE, SO EOR+1 CAN BE THE TOP & WTB+1 CAN BE THE BOTTOM, WTB %AGE IS KEY PLAYER HERE TO DECIDE THE BOTTOM.
31. RESISTANCE HAS HIGHLY BULLISH PRESSURE (BULL RUN) BUT SUPPORT HAS BEARISH PRESSURE, THIS WILL STOP THE BULL RUN, SO EOR+1 CAN BE THE TOP & WTB+1 CAN BE THE BOTTOM, WTB %AGE IS KEY PLAYER HERE TO DECIDE THE BOTTOM.
32. SUPPORT HAS HIGHLY BEARISH PRESSURE (BLOOD BATH) BUT RESISTANCE HAS BULLISH PRESSURE, THIS WILL STOP THE BLOOD BATH, SO WTB+1 CAN BE THE BOTTOM & EOR CAN BE THE TOP, WTB %AGE IS KEY PLAYER HERE TO DECIDE THE BOTTOM
33. RARE SCENARIO : MARKET IS VERY VOLATILE, DO NOT TRADE . BUT IF ANYONE WANTS TO TRADE THEN EOR+1 CAN BE THE RISKY TOP & WTB+1 CAN BE THE RISKY BOTTOM, WTB %AGE IS KEY PLAYER HERE TO DECIDE THE BOTTOM
34. RESISTANCE IS STABLE STRONG BUT SUPPORT HAS BEARISH PRESSURE, SO EOR CAN BE THE TOP & WTB+1 CAN BE BOTTOM, WTB %AGE IS KEY PLAYER HERE TO DECIDE THE BOTTOM
35. RESISTANCE HAS BULLISH PRESSURE BUT SUPPORT HAS BEARISH PRESSURE, SO EOR+1 CAN BE THE TOP & WTB+1 CAN BE THE BOTTOM, WTB %AGE IS KEY PLAYER HERE TO DECIDE THE BOTTOM
36. RESISTANCE HAS HIGHLY BULLISH PRESSURE (BULL RUN) BUT SUPPORT HAS BEARISH PRESSURE, THIS WILL STOP THE BULL RUN, SO EOR+1 CAN BE THE TOP & WTB+1 CAN BE THE BOTTOM, WTB %AGE IS KEY PLAYER HERE TO DECIDE THE BOTTOM
37. RESISTANCE HAS BULLISH PRESSURE BUT SUPPORT HAS BEARISH PRESSURE, SO WTT-1 CAN BE THE TOP & WTB+1 CAN BE THE BOTTOM, WTT %AGE IS KEY PLAYER TO DECIDE THE TOP, WTB %AGE IS KEY PLAYER HERE TO DECIDE THE BOTTOM.
38. RESISTANCE HAS HIGHLY BULLISH PRESSURE (BULL RUN) BUT SUPPORT HAS BEARISH PRESSURE, THIS WILL STOP THE BULL RUN, SO WTT-1 CAN BE THE TOP & WTB+1 CAN BE THE BOTTOM, WTB & WTT %AGE IS KEY PLAYER HERE TO DECIDE THE TOP & BOTTOM
39. RESISTANCE HAS BULLISH PRESSURE BUT SUPPORT HAS BEARISH PRESSURE, SO WTT-1 CAN BE THE TOP & WTB+1 CAN BE THE BOTTOM, WTB & WTT %AGE IS KEY PLAYER HERE TO DECIDE THE TOP & BOTTOM
40. SUPPORT HAS HIGHLY BEARISH PRESSURE (BLOOD BATH) BUT RESISTANCE HAS BULLISH PRESSURE, THIS WILL STOP THE BLOOD BATH, SO WTB+1 CAN BE THE BOTTOM & WTT-1 CAN BE THE TOP, WTT & WTB %AGE IS KEY PLAYER TO DECIDE THE TOP & BOTTOM
41. RARE SCENARIO : MARKET IS VERY VOLATILE, DO NOT TRADE . BUT IF ANYONE WANTS TO TRADE THEN WTT-1 CAN BE THE RISKY TOP & WTB+1 CAN BE THE RISKY BOTTOM, WTB & WTT %AGE IS KEY PLAYER HERE TO DECIDE THE TOP & BOTTOM
42. SUPPORT HAS HIGHLY BEARISH PRESSURE (BLOOD BATH) BUT RESISTANCE HAS BULLISH PRESSURE, THIS WILL STOP THE BLOOD BATH, SO WTB+1 CAN BE THE BOTTOM & WTT-1 CAN BE THE TOP, WTB & WTT %AGE IS KEY PLAYER HERE TO DECIDE THE TOP & BOTTOM
43. RESISTANCE HAS BULLISH PRESSURE BUT SUPPORT HAS BEARISH PRESSURE, SO WTT-1 CAN BE THE TOP & WTB+1 CAN BE THE BOTTOM, WTT %AGE IS KEY PLAYER TO DECIDE THE TOP, WTB %AGE IS KEY PLAYER HERE TO DECIDE THE BOTTOM

## 7. What is still open

- The mapping in section 4 is our reading. The two least certain are "shifted ... and now again WTB/WTT" (we read it as: it was weak that way before the shift) and the two "became strong and again became WTB/WTT at any place" conditions.
- The tool covers the **top and bottom only**. Which entries are risky, moderate or safe, stops, targets and times are not in it.
- The tool's names for the states are not the live tool's: the live tool never says "highly bearish"; we infer the class from the side's event log (`lib/ltp/pressure.ts`).
