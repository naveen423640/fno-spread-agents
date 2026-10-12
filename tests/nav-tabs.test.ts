import { describe, expect, it } from 'vitest';

import { parseHidden, resolveActive, SURFACES, toggleHidden, visibleSurfaces } from '@/lib/nav-tabs';

const ids = SURFACES.map((s) => s.id);

describe('which top-bar tabs are shown', () => {
  it('lists the nine tabs in their usual order, with the heat map first', () => {
    expect(ids).toEqual(['heatmap', 'strategy-lab', 'backtest', 'markov-regime', 'screener', 'board', 'ltp', 'vwap', 'vwap-backtest']);
  });
  it('shows everything when nothing is hidden', () => { expect(visibleSurfaces([])).toEqual(SURFACES); });
  it('hides the ones you untick and keeps the order of the rest', () => {
    expect(visibleSurfaces(['screener', 'board']).map((s) => s.id)).toEqual(['heatmap', 'strategy-lab', 'backtest', 'markov-regime', 'ltp', 'vwap', 'vwap-backtest']);
  });
  it('toggling hides a shown tab and shows a hidden one again', () => {
    expect(toggleHidden([], 'vwap')).toEqual(['vwap']);
    expect(toggleHidden(['vwap'], 'vwap')).toEqual([]);
  });
  it('the last visible tab cannot be hidden', () => {
    const allButLtp = ids.filter((id) => id !== 'ltp');
    expect(toggleHidden(allButLtp, 'ltp')).toEqual(allButLtp);
  });
  it('reads the saved choice, ignoring anything broken, unknown or hiding every tab', () => {
    expect(parseHidden('["screener","board"]')).toEqual(['screener', 'board']);
    expect(parseHidden('["screener","nope",3]')).toEqual(['screener']);
    expect(parseHidden('not json')).toEqual([]);
    expect(parseHidden(null)).toEqual([]);
    expect(parseHidden(JSON.stringify(ids))).toEqual([]);
  });
  it('if the open tab gets hidden, the first shown tab opens instead', () => {
    expect(resolveActive('screener', ['screener'])).toBe('heatmap');
    expect(resolveActive('heatmap', ['heatmap', 'strategy-lab'])).toBe('backtest');
    expect(resolveActive('ltp', ['screener'])).toBe('ltp');
  });
});
