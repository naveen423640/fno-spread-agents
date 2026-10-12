# LTP trading knowledge base: which trades in which scenario

Every rule has a source tag: **[course]** from the free course or its practice tools (see `docs/ltp-rules-reference.md` and `docs/ltp-coa-verification.md`), **[tool]** observed on the live tool, **[user]** told to us by the owner of this system, **[ours]** our own choice. Nothing here is advice; the agent trades on paper only.

## Risky, moderate and safe: what is actually documented

- The course teaches **where the market is expected to turn** (top and bottom per scenario), not entry tiers. The nine scenarios and the detailed chart give the levels (`docs/ltp-coa-verification.md`).
- **[course]** The first touch of a level is generally safe; the risk rises with each further touch.
- **[course]** The weekly range has three bands: risky (L1), moderate (L2), generally safe (L3).
- **[course]** The rare scenario (highly bearish against highly bullish): "do not trade", but the tool names the **risky** levels: top EOR+1 (WTT-1), bottom EOS-1 (WTB+1).
- **[tool]** The live tool's header shows Risky, Moderate, Max Pain and Max Gain per side. The course does not explain them. Our reading from one day: Moderate is about the extension (EOR or EOS), Risky about one strike inside it (EOR-1, EOS+1) or the reversal at the weak strike, Max Pain is EOR+2 / EOS-2, Max Gain the opposite extension. Not confirmed.

## Rules from the owner

1. **[user, 2026-10-13]** When the pressure is high (no bottom: Blood Bath, or no top: Bull Run), **risky trades can be taken**.
   - **No bottom (Blood Bath):** the risky trade is a **short**. **No top (Bull Run):** the risky trade is a **long**. *(Direction confirmed again on 2026-10-13 after the level was corrected.)* The entry is at the tool's displayed Risky level on that side (resistance side for the short, support side for the long).
   - **The level is not EOR-1 or EOS+1. The live tool shows the risky level and the moderate level itself** in its header lines (Risky, Moderate, Max Pain, Max Gain, on the resistance side and the support side). The rule uses those displayed values, not our own formula.
   - The tool's practice-tool wording for the extreme case ("EOR-1 can also be a good level as top", "EOS+1 can also be a good level as bottom") is a hint only, not the risky level.

## Open

- **What the tool's Risky and Moderate lines are, exactly.** Our code computes Risky as EOR-1 / EOS+1 (or the reversal at the weak strike) from one day of observation; the owner says the tool's displayed value is the one that counts, and our formula may be wrong. Plan: read the tool's header lines live at several times, per index, and fit them against our levels. Until then the agent does not use the owner's rule 1.

- Rule 1: does it apply to **every** case where the tool shows no bottom or no top (one side highly bearish, both sides bearish, both highly bearish), or only to the highly bearish / highly bullish ones?
- Which scenarios allow only the safe entry, and which also allow the risky one.
- What counts as the moderate entry and the safe entry in each scenario.
- Stops, targets and time limits per tier.
