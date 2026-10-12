// Turns one engine state into candidate signals, each with the ordered rule trace that decided it. A candidate exists when the spot has just
// come within the touch tolerance of a level (the previous minute was outside it); whether it is then taken or skipped is decided by the
// rules below, in this fixed order, and the first failing rule is the skip reason. Setups that are switched off produce no candidates. Pure.
import type { UsableAnalysis } from '@/lib/ltp/analyze';
import { countHits } from '@/lib/ltp/coa1';
import { istHhmm } from '@/lib/ltp/time';
import type { Direction } from './books';
import { tugOfWar } from '@/lib/ltp/tug-of-war';
import { graphTrace } from './graph-use';
import type { Strategy } from './strategy';

export type SetupType = 'coa1_reversal' | 'nine_twenty' | 'soc' | 'risky_tug';
export type RuleStep = { rule: string; inputs: Record<string, number | string | boolean | null>; passed: boolean };
export type EvalContext = { dayTradeCount: number; openCount: number; dayLossInr: number };
export type Candidate = {
  setup: SetupType; direction: Direction; scenario: number; level: { label: string; value: number }; hit: number;
  trace: RuleStep[]; taken: boolean; skipReason: string | null;
  entry: number; stop: number | null; target: number | null; plannedRiskPts: number | null; rewardPts: number | null; anchorStrike: number;
};

// The next level out, for stop_rule 'next_level'.
const LONG_NEXT: Record<string, string> = { 'EOS+1': 'EOS', EOS: 'EOS-1', 'EOS-1': 'EOS-2', 'WTB+1': 'EOS-1' };
const SHORT_NEXT: Record<string, string> = { 'EOR-1': 'EOR', EOR: 'EOR+1', 'EOR+1': 'EOR+2', 'WTT-1': 'EOR+1' };

function ladder(a: UsableAnalysis): Record<string, number | null> {
  const e = a.extensions;
  return {
    'EOS+1': e.eosPlus1.value, EOS: e.eos.value, 'EOS-1': e.eosMinus[0].value, 'EOS-2': e.eosMinus[1].value,
    'EOR-1': e.eorMinus1.value, EOR: e.eor.value, 'EOR+1': e.eorPlus[0].value, 'EOR+2': e.eorPlus[1].value,
  };
}

type Raw = { setup: SetupType; direction: Direction; level: { label: string; value: number }; stop: number | null; target: number | null };

export function evaluate(a: UsableAnalysis, strategy: Strategy, ctx: EvalContext): Candidate[] {
  return build(a, strategy, ctx, 'touch');
}

// Where the agent WOULD trade from the current state, whether or not the spot is near the level: the same levels, plan and rules, with the entry taken
// at the level and the hit number being the one the next touch would be. Used to show the user the levels being watched; nothing is journaled or booked.
export function watchLevels(a: UsableAnalysis, strategy: Strategy, ctx: EvalContext): Candidate[] {
  return build(a, strategy, ctx, 'watch');
}

function build(a: UsableAnalysis, strategy: Strategy, ctx: EvalContext, mode: 'touch' | 'watch'): Candidate[] {
  const hhmm = istHhmm(a.asOf);
  const spot = a.spot;
  const spots = a.series.spot.map((p) => p.spot);
  const previous = spots.length > 1 ? spots[spots.length - 2] : null;
  const tol = strategy.touch_tolerance_pts;
  const touched = (value: number) => mode === 'watch' || (Math.abs(spot - value) <= tol && (previous === null || Math.abs(previous - value) > tol));
  const buffer = strategy.stop_buffer_pts;
  const rungs = ladder(a);
  const scenario = a.coa1.scenario;
  const graphConsistent = graphTrace(a).consistent;
  const moderate = strategy.entry_profile === 'moderate';

  const coaStop = (direction: Direction, label: string): number | null => {
    if (strategy.stop_rule === 'nine_twenty') {
      const base = direction === 'long' ? rungs['EOS-2'] : rungs['EOR+2'];
      return base === null ? null : direction === 'long' ? base - buffer : base + buffer;
    }
    const next = (direction === 'long' ? LONG_NEXT : SHORT_NEXT)[label];
    const base = next ? rungs[next] : null;
    return base === null || base === undefined ? null : direction === 'long' ? base - buffer : base + buffer;
  };
  const coaTarget = (direction: Direction) => (direction === 'long' ? rungs.EOR : rungs.EOS);

  // The level a COA 1.0 style entry uses: the scenario's own non-primary level, else the primary one for the entry profile.
  const primaryLevel = (direction: Direction): { label: string; value: number | null } => {
    const own = direction === 'long' ? scenario.bottom : scenario.top;
    const ownLevel = direction === 'long' ? a.coa1.bottom : a.coa1.top;
    const primary = direction === 'long' ? 'EOS' : 'EOR';
    if (own && own !== primary && ownLevel) return { label: own, value: ownLevel.value };
    const label = direction === 'long' ? (moderate ? 'EOS-1' : 'EOS') : moderate ? 'EOR+1' : 'EOR';
    return { label, value: rungs[label] };
  };

  const raws: Raw[] = [];
  const coaDirections = new Set<Direction>();
  if (strategy.setups_enabled.coa1_reversal) {
    for (const direction of ['long', 'short'] as Direction[]) {
      const { label, value } = primaryLevel(direction);
      if (value === null || !touched(value)) continue;
      coaDirections.add(direction);
      raws.push({ setup: 'coa1_reversal', direction, level: { label, value }, stop: coaStop(direction, label), target: coaTarget(direction) });
    }
  }
  if (strategy.setups_enabled.nine_twenty && a.lines0920) {
    for (const direction of ['long', 'short'] as Direction[]) {
      const t = direction === 'long' ? a.lines0920.long : a.lines0920.short;
      const entry = moderate ? t.moderate : t.risky;
      if (entry.value === null || !touched(entry.value)) continue;
      const stop = t.maxPain.value === null ? null : direction === 'long' ? t.maxPain.value - buffer : t.maxPain.value + buffer;
      raws.push({ setup: 'nine_twenty', direction, level: { label: moderate ? '9:20 Moderate' : '9:20 Risky', value: entry.value }, stop, target: t.maxGain.value });
    }
  }
  if (strategy.setups_enabled.soc && a.soc) {
    const direction: Direction = a.soc.bias === 'bearish' ? 'short' : 'long';
    const { label, value } = primaryLevel(direction);
    if (value !== null && touched(value) && !coaDirections.has(direction)) raws.push({ setup: 'soc', direction, level: { label, value }, stop: coaStop(direction, label), target: a.soc.target }); // the diversion of the zone (course ch14)
  }

  // The tug of war: when both sides push one way, or one pushes highly and the other is stable, a risky entry at the live Risky level is allowed, in the
  // winner's direction. (Owner rule, 2026-10-13; the level is the proxy of the tool's own Risky line.)
  if (strategy.setups_enabled.risky_tug) {
    const tug = tugOfWar(a.coa1.pressure.support, a.coa1.pressure.resistance);
    if (tug.riskyAllowed && tug.riskyDirection && !coaDirections.has(tug.riskyDirection)) {
      const direction = tug.riskyDirection;
      const risky = direction === 'short' ? a.extensions.riskyShort : a.extensions.riskyLong;
      if (risky.value !== null && touched(risky.value)) raws.push({ setup: 'risky_tug', direction, level: { label: 'Risky', value: risky.value }, stop: coaStop(direction, direction === 'short' ? 'EOR-1' : 'EOS+1'), target: coaTarget(direction) });
    }
  }

  // v2.0 raises no signal at all for a side the outcome has no level for (no long in a Blood Bath, no short in a Bull Run): nothing to show or to skip.
  const hasLevelFor = (direction: Direction) => (direction === 'long' ? scenario.bottom : scenario.top) !== null;
  return raws.filter((r) => !strategy.decide_by_graph || hasLevelFor(r.direction)).map((r) => judge(r));

  function judge(r: Raw): Candidate {
    const inBand = Math.abs(spot - r.level.value) <= tol;
    const hit = countHits(spots, r.level.value, tol) + (mode === 'watch' && !inBand ? 1 : 0);
    const entry = mode === 'watch' ? r.level.value : spot;
    // The Detailed Chart gives no top (Bull Run) or no bottom (Blood Bath) in some pairs: that side has no trade whatever the strategy table says.
    const hasLevel = (r.direction === 'long' ? scenario.bottom : scenario.top) !== null;
    // v2.0 decides from the mind-map outcome (a top gives shorts, a bottom gives longs); earlier versions also ask the first-level scenario table.
    const allowed = hasLevel && (strategy.decide_by_graph || strategy.scenarios_traded[String(scenario.number) as '1'][r.direction]);
    const blocked = !strategy.decide_by_graph && strategy.block_scenarios.includes(scenario.number);
    const start = r.setup === 'nine_twenty' ? strategy.window.nine_twenty_start : strategy.window.start;
    const stop = r.stop;
    const target = r.target;
    const planOk = stop !== null && target !== null && (r.direction === 'long' ? stop < entry && entry < target : target < entry && entry < stop);
    const coa2 = a.coa2.result;
    const agrees = coa2.status === 'ok'
      ? (r.direction === 'long' ? /^Reversal at (both|support)/.test(coa2.outcome) : /^Reversal at (both|resistance)/.test(coa2.outcome))
      : null;
    const soc = a.soc;
    const opposes = !!soc && r.setup !== 'soc' && (soc.bias === 'bearish' ? r.direction === 'long' : r.direction === 'short');

    const checks: RuleStep[] = [
      { rule: 'scenario_allowed', inputs: { scenario: scenario.number, direction: r.direction, allowed, blocked, has_level: hasLevel, graph_consistent: graphConsistent }, passed: allowed && !blocked && (!strategy.graph_consistent_required || graphConsistent) },
      { rule: 'time_window', inputs: { time: hhmm, start, end: strategy.window.end }, passed: hhmm >= start && hhmm <= strategy.window.end },
      { rule: 'level_touched', inputs: mode === 'watch' ? { spot, level: r.level.value, tolerance: tol, previous_spot: previous, watching: true } : { spot, level: r.level.value, tolerance: tol, previous_spot: previous }, passed: true },
      { rule: 'valid_plan', inputs: { entry, stop, target }, passed: planOk },
      { rule: 'hit_number', inputs: { hit, max: strategy.max_hit_number }, passed: hit <= strategy.max_hit_number },
      { rule: 'coa2_agree', inputs: { status: coa2.status, agrees, required: strategy.require_coa2_agree }, passed: !strategy.require_coa2_agree || agrees === true },
      { rule: 'soc_opposes', inputs: { soc: soc ? `${soc.type} ${soc.bias}` : null, opposes, blocking: strategy.block_on_opposing_soc }, passed: !strategy.block_on_opposing_soc || !opposes },
      { rule: 'daily_trade_cap', inputs: { today: ctx.dayTradeCount, max: strategy.risk.max_trades_per_day }, passed: ctx.dayTradeCount < strategy.risk.max_trades_per_day },
      { rule: 'max_concurrent', inputs: { open: ctx.openCount, max: strategy.risk.max_concurrent }, passed: ctx.openCount < strategy.risk.max_concurrent },
      { rule: 'daily_loss_cap', inputs: { loss_inr: ctx.dayLossInr, cap_inr: strategy.risk.daily_loss_cap_inr }, passed: ctx.dayLossInr < strategy.risk.daily_loss_cap_inr },
    ];
    const trace: RuleStep[] = [];
    for (const step of checks) { trace.push(step); if (!step.passed) break; }
    const failed = trace.find((s) => !s.passed);
    return {
      setup: r.setup, direction: r.direction, scenario: scenario.number, level: r.level, hit, trace, taken: !failed, skipReason: failed?.rule ?? null,
      entry, stop, target, plannedRiskPts: stop === null ? null : Math.abs(entry - stop), rewardPts: target === null ? null : Math.abs(target - entry),
      anchorStrike: r.direction === 'long' ? a.levels.support.strike : a.levels.resistance.strike,
    };
  }
}
