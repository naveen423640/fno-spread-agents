import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { agentReplayDay } from '@/lib/ltp-agent/agent';
import { buildReviewInput, buildReviewerLlm, loadSummaryTrades, reviewDay, reviewTrade, summarizeTrades, type SummaryTrade } from '@/lib/ltp-agent/reviewer';
import { MISTAKE_TAGS, OUTCOME_CLASSES } from '@/lib/ltp-agent/taxonomy';
import { parseStrategy } from '@/lib/ltp-agent/strategy';
import type { LlmClient, LlmRequest, LlmResult } from '@/lib/llm/types';
import { writerBreakeven } from '@/lib/ltp/extensions';
import { DAY, freshStores, pathDay, U } from '../support/ltp-agent-day';

const v01 = parseStrategy(readFileSync('strategies/ltp_v0.1.yaml', 'utf8'));
const good = { outcome_class: 'good_trade_good_result', mistake_tags: [], what_happened: 'Price touched EOS and ran to the target.', lesson: 'The rules worked as written.', confidence: 0.8 };
const ok = (text: string): LlmResult => ({ ok: true, text, provider: 'anthropic', model: 'test-model', tokensIn: 10, tokensOut: 10 });

// A fake model: no network. It answers from a script and remembers every request.
function fakeLlm(script: (string | LlmResult)[]) {
  const calls: LlmRequest[] = [];
  const llm: LlmClient = { async complete(request) { calls.push(request); const next = script[Math.min(calls.length - 1, script.length - 1)]; return typeof next === 'string' ? ok(next) : next; } };
  return { llm, calls };
}
const input = () => ({ decision: { decisionId: 'd1' }, outcomes: [], path: [] }) as never;

describe('the taxonomy is fixed', () => {
  it('16 mistake tags and 4 outcome classes, exactly as in the brief', () => {
    expect(MISTAKE_TAGS).toHaveLength(16);
    expect(MISTAKE_TAGS).toContain('proxy_extension_error');
    expect(OUTCOME_CLASSES).toEqual(['good_trade_good_result', 'good_trade_bad_result', 'bad_trade', 'lucky_win']);
  });
});

describe('reviewTrade validates the model output, retries once, then fails and says why', () => {
  it('accepts valid JSON, also when the model wraps it in a code fence', async () => {
    const plain = await reviewTrade(fakeLlm([JSON.stringify(good)]).llm, input(), 'r1');
    expect(plain).toMatchObject({ ok: true, review: good, model: 'test-model' });
    const fenced = await reviewTrade(fakeLlm(['```json\n' + JSON.stringify(good) + '\n```']).llm, input(), 'r1');
    expect(fenced).toMatchObject({ ok: true });
  });
  it('invalid JSON once, then valid: retried once and accepted', async () => {
    const { llm, calls } = fakeLlm(['not json at all', JSON.stringify(good)]);
    expect(await reviewTrade(llm, input(), 'r1')).toMatchObject({ ok: true });
    expect(calls).toHaveLength(2);
  });
  it('invalid twice: exactly one retry, then a failure with the reason', async () => {
    const { llm, calls } = fakeLlm(['nope']);
    const r = await reviewTrade(llm, input(), 'r1');
    expect(r).toMatchObject({ ok: false });
    expect(calls).toHaveLength(2);
    if (!r.ok) expect(r.error).toMatch(/invalid/i);
  });
  it('a value outside the schema counts as invalid: confidence 1.5, an unknown outcome class, an empty lesson', async () => {
    for (const bad of [{ ...good, confidence: 1.5 }, { ...good, outcome_class: 'lucky_loss' }, { ...good, lesson: '' }]) {
      const { llm, calls } = fakeLlm([JSON.stringify(bad)]);
      expect(await reviewTrade(llm, input(), 'r1')).toMatchObject({ ok: false });
      expect(calls).toHaveLength(2);
    }
  });
  it('an unknown mistake tag becomes other, with a note naming it', async () => {
    const r = await reviewTrade(fakeLlm([JSON.stringify({ ...good, mistake_tags: ['stop_too_tight', 'bad_vibes'] })]).llm, input(), 'r1');
    if (!r.ok) throw new Error(r.error);
    expect(r.review.mistake_tags).toEqual(['stop_too_tight', 'other']);
    expect(r.review.other_note).toContain('bad_vibes');
  });
  it('a provider failure is not retried (the output was never invalid) and is reported', async () => {
    const { llm, calls } = fakeLlm([{ ok: false, error: 'PROVIDER_ERROR', detail: 'HTTP 500' }]);
    const r = await reviewTrade(llm, input(), 'r1');
    expect(r).toMatchObject({ ok: false });
    expect(calls).toHaveLength(1);
  });
  it('the request carries the fixed tag list and the reviewer role, and no key', async () => {
    const { llm, calls } = fakeLlm([JSON.stringify(good)]);
    await reviewTrade(llm, input(), 'r1');
    const text = calls[0].messages.map((m) => m.content).join('\n');
    for (const tag of MISTAKE_TAGS) expect(text).toContain(tag);
    expect(text).toContain('RULEBOOK'); // the knowledge graph as plain text
    expect(calls[0].role).toBe('ltp-reviewer');
    expect(text).not.toMatch(/sk-|api[_-]?key/i);
  });
});

describe('the reviewer model is the Anthropic provider, from config, and needs a key', () => {
  it('with no ANTHROPIC_API_KEY there is no reviewer, so the journal is simply left unreviewed', () => {
    expect(buildReviewerLlm({}, async () => undefined)).toBeNull();
  });
  it('with a key it builds a client; the model comes from AGENT_REVIEW_MODEL when set', () => {
    expect(buildReviewerLlm({ ANTHROPIC_API_KEY: 'k' }, async () => undefined)).not.toBeNull();
    expect(buildReviewerLlm({ ANTHROPIC_API_KEY: 'k', AGENT_REVIEW_MODEL: 'some-model' }, async () => undefined)?.model).toBe('some-model');
  });
});

describe('reviewDay reviews each closed trade of the day once', () => {
  async function tradedDay() {
    const stores = freshStores();
    for (const s of pathDay([['10:00', 23880], ['10:01', 23862], ['10:02', 23900], ['10:03', 24100], ['10:04', 24275]])) await stores.store.insertSnapshot(s);
    await agentReplayDay({ ...stores, strategy: v01, paused: false, method: writerBreakeven }, U, DAY);
    return stores;
  }
  it('stores the review beside the trade and leaves the decision row untouched', async () => {
    const { store, journal } = await tradedDay();
    const id = (await journal.decisionsForDay(DAY))[0].decisionId;
    const before = JSON.stringify(await journal.decisionById(id));
    const { llm, calls } = fakeLlm([JSON.stringify(good)]);
    expect(await reviewDay({ store, journal, llm, model: 'test-model' }, DAY)).toEqual({ reviewed: 1, failed: 0 });
    expect(await journal.reviewFor(id)).toMatchObject({ outcome_class: 'good_trade_good_result' });
    expect(JSON.stringify(await journal.decisionById(id))).toBe(before);
    expect(calls).toHaveLength(1);
  });
  it('what the model is shown: the decision record, both outcomes and a minute-by-minute path of spot, levels, weakness and OI', async () => {
    const { store, journal } = await tradedDay();
    const id = (await journal.decisionsForDay(DAY))[0].decisionId;
    const built = await buildReviewInput({ store, journal }, id);
    expect(built.decision.decisionId).toBe(id);
    expect(built.outcomes.map((o) => o.book)).toEqual(['buy', 'sell']);
    expect(built.path.map((p) => p.time)).toEqual(['10:01', '10:02', '10:03', '10:04']);
    expect(built.path[0]).toMatchObject({ spot: 23862, supportStrike: 23900 });
    expect(built.path[3].spot).toBe(24275);
    for (const key of ['supportVolumePct', 'supportOiPct', 'resistanceVolumePct', 'resistanceOiPct', 'ceOiAtResistance', 'peOiAtSupport']) expect(built.path[0]).toHaveProperty(key);
  });
  it('a holdout day is never reviewed: no model call, nothing stored', async () => {
    const { store, journal } = await tradedDay();
    const { llm, calls } = fakeLlm([JSON.stringify(good)]);
    expect(await reviewDay({ store, journal, llm, model: 'm', holdout: [DAY] }, DAY)).toEqual({ reviewed: 0, failed: 0 });
    expect(calls).toHaveLength(0);
    expect(await journal.reviewFor((await journal.decisionsForDay(DAY))[0].decisionId)).toBeNull();
  });
  it('an already-reviewed trade is not reviewed again', async () => {
    const { store, journal } = await tradedDay();
    const { llm, calls } = fakeLlm([JSON.stringify(good)]);
    await reviewDay({ store, journal, llm, model: 'm' }, DAY);
    expect(await reviewDay({ store, journal, llm, model: 'm' }, DAY)).toEqual({ reviewed: 0, failed: 0 });
    expect(calls).toHaveLength(1);
  });
  it('a failed review is logged, the trade stays unreviewed, and after three failed days it is left alone', async () => {
    const { store, journal } = await tradedDay();
    const id = (await journal.decisionsForDay(DAY))[0].decisionId;
    const { llm, calls } = fakeLlm(['garbage']);
    for (let i = 0; i < 3; i += 1) expect(await reviewDay({ store, journal, llm, model: 'm' }, DAY)).toEqual({ reviewed: 0, failed: 1 });
    expect(await journal.reviewFor(id)).toBeNull();
    expect(JSON.parse((await journal.getState(`review_failed:${id}`))!)).toMatchObject({ attempts: 3 });
    const callsBefore = calls.length;
    expect(await reviewDay({ store, journal, llm, model: 'm' }, DAY)).toEqual({ reviewed: 0, failed: 0 });
    expect(calls).toHaveLength(callsBefore);
  });
  it('a trade whose books are not both closed yet is not reviewed', async () => {
    const stores = freshStores();
    for (const s of pathDay([['10:00', 23880], ['10:01', 23862]])) await stores.store.insertSnapshot(s);
    const { agentStep } = await import('@/lib/ltp-agent/agent');
    await agentStep({ ...stores, strategy: v01, paused: false, method: writerBreakeven }, U, pathDay([['10:00', 23880], ['10:01', 23862]]).at(-1)!.ts);
    const { llm, calls } = fakeLlm([JSON.stringify(good)]);
    expect(await reviewDay({ ...stores, llm, model: 'm' }, DAY)).toEqual({ reviewed: 0, failed: 0 });
    expect(calls).toHaveLength(0);
  });
});

describe('loadSummaryTrades turns journal rows into summary trades', () => {
  it('one closed trade: scenario, hit and time from the decision, both books\' net P&L from the outcomes, and its review', async () => {
    const stores = freshStores();
    for (const s of pathDay([['10:00', 23880], ['10:01', 23862], ['10:02', 23900], ['10:03', 24100], ['10:04', 24275]])) await stores.store.insertSnapshot(s);
    await agentReplayDay({ ...stores, strategy: v01, paused: false, method: writerBreakeven }, U, DAY);
    const id = (await stores.journal.decisionsForDay(DAY))[0].decisionId;
    await stores.journal.recordReview(id, good, 'm');
    const [t] = await loadSummaryTrades(stores.journal, [DAY]);
    const outcomes = await stores.journal.outcomesForDecision(id);
    expect(t).toMatchObject({ decisionId: id, date: DAY, underlying: U, setup: 'coa1_reversal', scenario: 1, hit: 1, hhmm: '10:01', review: good });
    expect(t.buy).toBeCloseTo(outcomes.find((o) => o.book === 'buy')!.netPnl, 6);
    expect(t.sell).toBeCloseTo(outcomes.find((o) => o.book === 'sell')!.netPnl, 6);
  });
  it('skipped signals and trades still open are not trades yet', async () => {
    const stores = freshStores();
    expect(await loadSummaryTrades(stores.journal, [DAY])).toEqual([]);
  });
});

describe('the weekly summary reports observations only', () => {
  const trade = (o: Partial<SummaryTrade> & { id: string }): SummaryTrade => ({ decisionId: o.id, date: '2026-10-12', underlying: U, setup: 'coa1_reversal', scenario: 1, hit: 1, hhmm: '10:05', buy: 1000, sell: 400, review: null, ...o });
  const trades = [
    trade({ id: 'a', review: { ...good, mistake_tags: [] } as never }),
    trade({ id: 'b', hit: 2, hhmm: '11:00', buy: -500, sell: -300, review: { ...good, outcome_class: 'bad_trade', mistake_tags: ['stop_too_tight', 'late_in_day'] } as never }),
    trade({ id: 'c', setup: 'nine_twenty', scenario: 3, hhmm: '13:30', underlying: 'NSE:NIFTYBANK-INDEX', buy: -200, sell: 100, review: { ...good, mistake_tags: ['stop_too_tight'] } as never }),
    trade({ id: 'd', hhmm: '14:20', buy: 300, sell: null }),
  ];
  const s = summarizeTrades(trades);
  it('counts, tag frequencies and the buy-versus-sell comparison, by hand', () => {
    expect(s.trades).toBe(4);
    expect(s.byTag).toEqual({ stop_too_tight: 2, late_in_day: 1 });
    expect(s.byBook.buy).toMatchObject({ n: 4, net: 600, winRate: 0.5, expectancy: 150 }); // 1000 - 500 - 200 + 300
    expect(s.byBook.sell).toMatchObject({ n: 3, net: 200, winRate: 2 / 3 }); // 400 - 300 + 100; trade d has no sell book
  });
  it('P&L by setup, scenario, hit number, time bucket and underlying', () => {
    expect(s.bySetup.coa1_reversal).toEqual({ n: 3, buyNet: 800, sellNet: 100 });
    expect(s.bySetup.nine_twenty).toEqual({ n: 1, buyNet: -200, sellNet: 100 });
    expect(s.byScenario['3']).toEqual({ n: 1, buyNet: -200, sellNet: 100 });
    expect(s.byHit['2']).toEqual({ n: 1, buyNet: -500, sellNet: -300 });
    expect(s.byTimeBucket['before 10:30']).toEqual({ n: 1, buyNet: 1000, sellNet: 400 });
    expect(s.byTimeBucket['12:00 to 14:00']).toEqual({ n: 1, buyNet: -200, sellNet: 100 });
    expect(s.byTimeBucket['after 14:00']).toEqual({ n: 1, buyNet: 300, sellNet: 0 });
    expect(s.byUnderlying['NSE:NIFTYBANK-INDEX']).toEqual({ n: 1, buyNet: -200, sellNet: 100 });
  });
  it('has no proposals in it, and says it is observations only', () => {
    const { note: _note, ...data } = s;
    expect(JSON.stringify(data)).not.toMatch(/propos|diff|change|experiment/i);
    expect(s.note).toBe('Observations only. No rule changes are proposed in the journal phase.');
  });
  it('an empty week is a valid, empty summary', () => {
    expect(summarizeTrades([])).toMatchObject({ trades: 0, byTag: {}, byBook: { buy: { n: 0, net: 0 }, sell: { n: 0, net: 0 } } });
  });
});
