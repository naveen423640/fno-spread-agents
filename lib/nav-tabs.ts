// Which of the app's top-bar tabs are shown. The choice is kept per browser (a tablet and the Mac can show different tabs); nothing here touches the server.
export type SurfaceId = 'heatmap' | 'strategy-lab' | 'backtest' | 'markov-regime' | 'screener' | 'board' | 'ltp' | 'vwap' | 'vwap-backtest';

export const SURFACES: { id: SurfaceId; label: string }[] = [
  { id: 'heatmap', label: 'Market heat map' },
  { id: 'strategy-lab', label: 'Options payoff test' },
  { id: 'backtest', label: '6-month strategy test' },
  { id: 'markov-regime', label: 'Markov regime' },
  { id: 'screener', label: 'Screener' },
  { id: 'board', label: 'OrderBlock Board' },
  { id: 'ltp', label: 'LTP Levels' },
  { id: 'vwap', label: 'VWAP Scan' },
  { id: 'vwap-backtest', label: 'VWAP Backtest' },
];

export const NAV_STORAGE_KEY = 'fno-hidden-tabs';
const KNOWN = new Set<string>(SURFACES.map((s) => s.id));

export const visibleSurfaces = (hidden: SurfaceId[]) => SURFACES.filter((s) => !hidden.includes(s.id));

// Hides a shown tab or shows a hidden one; the last tab left cannot be hidden.
export function toggleHidden(hidden: SurfaceId[], id: SurfaceId): SurfaceId[] {
  if (hidden.includes(id)) return hidden.filter((h) => h !== id);
  return visibleSurfaces(hidden).length <= 1 ? hidden : [...hidden, id];
}

// A saved value that is missing, broken, names unknown tabs, or would hide every tab falls back to what is usable (nothing hidden at worst).
export function parseHidden(raw: string | null): SurfaceId[] {
  try {
    const value = JSON.parse(raw ?? '[]') as unknown;
    const hidden = (Array.isArray(value) ? value : []).filter((v): v is SurfaceId => typeof v === 'string' && KNOWN.has(v));
    return visibleSurfaces(hidden).length === 0 ? [] : hidden;
  } catch { return []; }
}

// The tab to show: the open one, unless it has been hidden, then the first one still shown.
export function resolveActive(active: SurfaceId, hidden: SurfaceId[]): SurfaceId {
  return hidden.includes(active) ? visibleSurfaces(hidden)[0].id : active;
}
