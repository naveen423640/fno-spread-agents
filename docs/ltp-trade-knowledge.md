# LTP trading knowledge base: which trades in which scenario

Every rule has a source tag: **[course]** from the free course or its practice tools (see `docs/ltp-rules-reference.md` and `docs/ltp-coa-verification.md`), **[tool]** observed on the live tool, **[user]** told to us by the owner of this system, **[ours]** our own choice. Nothing here is advice; the agent trades on paper only.

## Risky, moderate and safe: what is actually documented

- The course teaches **where the market is expected to turn** (top and bottom per scenario), not entry tiers. The nine scenarios and the detailed chart give the levels (`docs/ltp-coa-verification.md`).
- **[course]** The first touch of a level is generally safe; the risk rises with each further touch.
- **[course]** The weekly range has three bands: risky (L1), moderate (L2), generally safe (L3).
- **[course]** The rare scenario (highly bearish against highly bullish): "do not trade", but the tool names the **risky** levels: top EOR+1 (WTT-1), bottom EOS-1 (WTB+1).
- **[tool]** The live tool's header shows Risky, Moderate, Max Pain and Max Gain per side. The course does not explain them. Our reading from one day: Moderate is about the extension (EOR or EOS), Risky about one strike inside it (EOR-1, EOS+1) or the reversal at the weak strike, Max Pain is EOR+2 / EOS-2, Max Gain the opposite extension. Not confirmed.

## Rules from the owner

1. **[user, 2026-10-13, replaces the earlier version]** **Tug of war.** The two sides pull the market; the pair of pressures says who is winning.
   - **Risky is allowed** when **both sides push the same way** (both bearish, both bullish, with or without a high one), or **one side pushes highly and the other is stable**.
   - **Bears winning** (the push is down): a **risky short** on the resistance side. **Bulls winning** (the push is up): a **risky long** on the support side. The level is the one the live tool shows as Risky (the agent uses its proxy of that line until the tool's own is read).
   - **No risky trade** when the sides pull against each other (contested), when only one side pushes plainly and the other is stable (a mild lead), or when both are stable.
   - **Do not skip on the first-level scenario** (the nine boxes by current status). Decide from the mind-map outcome: a top gives shorts, a bottom gives longs; the tug of war then says whether a risky trade is also allowed.
   - Shown everywhere in short tags: `6(S1/R1) S-Bearish R-Bullish(H)`; (H) = high. The agent (v2.0) now trades on this (`risky_tug` setup, `decide_by_graph`).

## Open

- **What the tool's Risky and Moderate lines are, exactly.** Our code computes Risky as EOR-1 / EOS+1 (or the reversal at the weak strike) from one day of observation; the owner says the tool's displayed value is the one that counts, and our formula may be wrong. Plan: read the tool's header lines live at several times, per index, and fit them against our levels. Until then the agent uses its proxy of the Risky line for the risky entry (tug-of-war rule).

- Which scenarios allow only the safe entry, and which also allow the risky one.
- What counts as the moderate entry and the safe entry in each scenario.
- Stops, targets and time limits per tier.
