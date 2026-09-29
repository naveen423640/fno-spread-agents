import { HORIZONS, METHODS, WINDOWS, type Horizon, type LabelWindow, type Method } from './types';

export type RegimeParams = { symbol: string; window: LabelWindow; method: Method; horizon: Horizon; asOf: string | null };

function validDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function parseRegimeParams(params: URLSearchParams, universe: ReadonlySet<string>): { ok: true; value: RegimeParams } | { ok: false; error: string } {
  const symbol = params.get('symbol') ?? '';
  if (!universe.has(symbol)) return { ok: false, error: 'Choose a stock from the F&O universe.' };
  const window = Number(params.get('window') ?? 20);
  if (!(WINDOWS as readonly number[]).includes(window)) return { ok: false, error: 'window must be 10, 20, 40 or 60.' };
  const method = params.get('method') ?? 'vol';
  if (!(METHODS as readonly string[]).includes(method)) return { ok: false, error: 'method must be vol or fixed.' };
  const horizon = Number(params.get('horizon') ?? 5);
  if (!(HORIZONS as readonly number[]).includes(horizon)) return { ok: false, error: 'horizon must be 1, 5 or 10.' };
  const asOf = params.get('asOf');
  if (asOf !== null && !validDate(asOf)) return { ok: false, error: 'asOf must be a valid YYYY-MM-DD date.' };
  return { ok: true, value: { symbol, window: window as LabelWindow, method: method as Method, horizon: horizon as Horizon, asOf } };
}
