import { describe, expect, it } from 'vitest';

import { monthlyReport } from '@/lib/ltp-agent/reports';
import { freshStores } from '../support/ltp-agent-day';
import { seedClosedTrades } from '../support/ltp-agent-journal';

const octDays = ['2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08'];
const novDays = ['2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05'];
const tagged = (tags: string[]) => () => ({ outcome_class: 'bad_trade', mistake_tags: tags, what_happened: 'x', lesson: 'y', confidence: 0.5 });

describe('the monthly readiness report', () => {
  it('per version and book: trades, win rate, expectancy, profit factor, max drawdown', async () => {
    const { journal } = freshStores();
    await seedClosedTrades(journal, { n: 40, days: octDays, net: (i) => ({ buy: i % 4 === 0 ? -20 : 10, sell: -5 }) });
    const r = await monthlyReport(journal, '2026-10');
    const buy = r.rows.find((x) => x.version === '0.1' && x.book === 'buy')!;
    expect(buy).toMatchObject({ trades: 40, winRate: 0.75, expectancy: 2.5, maxDrawdown: 20 }); // 30 x +10, 10 x -20: net 100
    expect(buy.profitFactor).toBeCloseTo(300 / 200, 9);
    expect(r.rows.find((x) => x.book === 'sell')).toMatchObject({ trades: 40, expectancy: -5, winRate: 0 });
  });
  it('top mistake tags with their count and the count a month earlier (the trend)', async () => {
    const { journal } = freshStores();
    await seedClosedTrades(journal, { n: 8, days: novDays, version: '0.1', review: (i) => tagged(i < 5 ? ['stop_too_tight'] : ['late_in_day', 'stop_too_tight'])() });
    await seedClosedTrades(journal, { n: 4, days: octDays, version: '0.1', review: () => tagged(['stop_too_tight'])() });
    const r = await monthlyReport(journal, '2026-11');
    expect(r.topTags[0]).toEqual({ tag: 'stop_too_tight', count: 8, previousMonth: 4 });
    expect(r.topTags[1]).toEqual({ tag: 'late_in_day', count: 3, previousMonth: 0 });
  });
  it('the percentile versus random entry comes from the experiment that created the version', async () => {
    const { journal } = freshStores();
    await seedClosedTrades(journal, { n: 5, days: novDays, version: '0.2' });
    await journal.saveExperiment({ id: 'EXP-001', hypothesis: 'h', diff: {}, expectedEffect: '', evidence: [], baseVersion: '0.1', split: { discovery: [], holdout: [] }, status: 'approved', appliedVersion: '0.2', triedCount: 1, createdTs: 1, results: { buy: { baselinePercentile: 97 }, sell: { baselinePercentile: 61 } } as never });
    const r = await monthlyReport(journal, '2026-11');
    expect(r.rows.find((x) => x.version === '0.2' && x.book === 'buy')?.percentileVsRandom).toBe(97);
    expect(r.rows.find((x) => x.version === '0.2' && x.book === 'sell')?.percentileVsRandom).toBe(61);
    expect(r.rows.find((x) => x.version === '0.1')).toBeUndefined();
  });
});

describe('stability is stated honestly and never as a recommendation', () => {
  it('one version and one month: not stable', async () => {
    const { journal } = freshStores();
    await seedClosedTrades(journal, { n: 40, days: octDays });
    const r = await monthlyReport(journal, '2026-10');
    expect(r.stability.buy.stable).toBe(false);
    expect(r.stability.buy.basis).toMatch(/fewer than 2/i);
  });
  it('two consecutive versions (and months), each with 30 or more trades and positive expectancy after costs: stable for that book only', async () => {
    const { journal } = freshStores();
    await seedClosedTrades(journal, { n: 40, days: octDays, version: '0.1', net: () => ({ buy: 10, sell: -5 }) });
    await seedClosedTrades(journal, { n: 40, days: novDays, version: '0.2', net: () => ({ buy: 8, sell: -2 }) });
    const r = await monthlyReport(journal, '2026-11');
    expect(r.stability.buy.stable).toBe(true);
    expect(r.stability.sell.stable).toBe(false);
  });
  it('fewer than 30 trades in a version does not count towards stability', async () => {
    const { journal } = freshStores();
    await seedClosedTrades(journal, { n: 40, days: octDays, version: '0.1' });
    await seedClosedTrades(journal, { n: 20, days: novDays, version: '0.2' });
    expect((await monthlyReport(journal, '2026-11')).stability.buy.stable).toBe(false);
  });
  it('versions that are not consecutive do not count (0.1 and 0.3 with no 0.2 in between having evidence)', async () => {
    const { journal } = freshStores();
    await seedClosedTrades(journal, { n: 40, days: octDays, version: '0.1' });
    await seedClosedTrades(journal, { n: 10, days: ['2026-10-20'], version: '0.2' });
    await seedClosedTrades(journal, { n: 40, days: novDays, version: '0.3' });
    expect((await monthlyReport(journal, '2026-11')).stability.buy.stable).toBe(true); // October and November are consecutive months, both qualify
    const { journal: j2 } = freshStores();
    await seedClosedTrades(j2, { n: 40, days: octDays, version: '0.1' });
    await seedClosedTrades(j2, { n: 10, days: ['2026-10-20'], version: '0.2' });
    await seedClosedTrades(j2, { n: 40, days: ['2026-12-02', '2026-12-03'], version: '0.3' });
    expect((await monthlyReport(j2, '2026-12')).stability.buy.stable).toBe(false); // October and December are not consecutive, and 0.2 is too thin
  });
  it('the text carries the paper-only disclaimer and never recommends going live', async () => {
    const { journal } = freshStores();
    await seedClosedTrades(journal, { n: 40, days: octDays, version: '0.1' });
    await seedClosedTrades(journal, { n: 40, days: novDays, version: '0.2' });
    const text = (await monthlyReport(journal, '2026-11')).text.join('\n');
    expect(text).toContain('Paper trading only');
    expect(text).toContain('Live trading is out of scope');
    expect(text).not.toMatch(/recommend|go live|start live|ready for live/i);
  });
  it('an empty month is a valid report with no rows', async () => {
    const { journal } = freshStores();
    expect(await monthlyReport(journal, '2026-10')).toMatchObject({ rows: [], topTags: [] });
  });
});
