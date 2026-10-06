// Mirrors dict P and UNIVERSE in screener/fo_spread_screener.py. Do not retune here without telling the user why.
export type ScreenerParams = {
  rsiBull: [number, number];
  rsiBear: [number, number];
  nearMaUp: number;
  nearMaLo: number;
  hvPctMax: number; // skip when the realised-vol percentile (IV proxy) is above this
  holdDays: number; // enter about 4 weeks out
  timeExitLeft: number; // close about 8 trading days before expiry
  takeProfit: number;
  stopLoss: number;
  slippage: number;
};

export const DEFAULT_PARAMS: ScreenerParams = {
  rsiBull: [35, 48],
  rsiBear: [52, 65],
  nearMaUp: 1.01,
  nearMaLo: 0.97,
  hvPctMax: 0.6,
  holdDays: 20,
  timeExitLeft: 8,
  takeProfit: 0.6,
  stopLoss: 0.5,
  slippage: 0.02,
};

const KEYS = Object.keys(DEFAULT_PARAMS) as (keyof ScreenerParams)[];

export type ParamsResult = { ok: true; value: ScreenerParams } | { ok: false; error: string };

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isBand = (v: unknown): v is [number, number] => Array.isArray(v) && v.length === 2 && isNum(v[0]) && isNum(v[1]);

// Fills missing fields from the defaults, rejects unknown keys and out-of-range values.
export function validateParams(input: unknown): ParamsResult {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return { ok: false, error: 'Parameters must be an object.' };
  const given = input as Record<string, unknown>;
  const unknown = Object.keys(given).find((key) => !(KEYS as string[]).includes(key));
  if (unknown) return { ok: false, error: `Unknown parameter "${unknown}".` };
  const p = { ...DEFAULT_PARAMS, ...given } as Record<string, unknown>;

  for (const key of ['rsiBull', 'rsiBear'] as const) {
    const band = p[key];
    if (!isBand(band)) return { ok: false, error: `${key} must be a [low, high] pair of numbers.` };
    if (band[0] < 0 || band[1] > 100 || band[0] >= band[1]) return { ok: false, error: `${key} must satisfy 0 <= low < high <= 100.` };
  }
  const range = (key: string, lo: number, hi: number, loOpen = false) => {
    const v = p[key];
    return isNum(v) && (loOpen ? v > lo : v >= lo) && v <= hi ? null : `${key} must be a number ${loOpen ? 'above' : 'from'} ${lo} to ${hi}.`;
  };
  const problem =
    range('nearMaUp', 1, 1.1) ?? range('nearMaLo', 0.9, 1) ?? range('hvPctMax', 0, 1, true) ??
    range('takeProfit', 0, 1, true) ?? range('stopLoss', 0, 1, true) ?? range('slippage', 0, 0.1);
  if (problem) return { ok: false, error: problem };

  const { holdDays, timeExitLeft } = p;
  if (!isNum(holdDays) || !Number.isInteger(holdDays) || holdDays < 5 || holdDays > 60) return { ok: false, error: 'holdDays must be a whole number from 5 to 60.' };
  if (!isNum(timeExitLeft) || !Number.isInteger(timeExitLeft) || timeExitLeft < 0 || timeExitLeft >= holdDays) return { ok: false, error: 'timeExitLeft must be a whole number below holdDays.' };
  return { ok: true, value: p as unknown as ScreenerParams };
}

export const UNIVERSE: Record<string, string> = {
  'RELIANCE': 'Energy', 'ONGC': 'Energy', 'BPCL': 'Energy', 'IOC': 'Energy',
  'COALINDIA': 'Energy', 'HDFCBANK': 'Banks', 'ICICIBANK': 'Banks', 'SBIN': 'Banks',
  'AXISBANK': 'Banks', 'KOTAKBANK': 'Banks', 'INDUSINDBK': 'Banks', 'BANKBARODA': 'Banks',
  'PNB': 'Banks', 'BAJFINANCE': 'Fin', 'BAJAJFINSV': 'Fin', 'SBILIFE': 'Fin',
  'HDFCLIFE': 'Fin', 'CHOLAFIN': 'Fin', 'SHRIRAMFIN': 'Fin', 'TCS': 'IT',
  'INFY': 'IT', 'HCLTECH': 'IT', 'WIPRO': 'IT', 'TECHM': 'IT',
  'LTIM': 'IT', 'SUNPHARMA': 'Pharma', 'CIPLA': 'Pharma', 'DRREDDY': 'Pharma',
  'DIVISLAB': 'Pharma', 'LUPIN': 'Pharma', 'ZYDUSLIFE': 'Pharma', 'AUROPHARMA': 'Pharma',
  'APOLLOHOSP': 'Hospitals', 'MAXHEALTH': 'Hospitals', 'MARUTI': 'Auto', 'M&M': 'Auto',
  'BAJAJ-AUTO': 'Auto', 'EICHERMOT': 'Auto', 'HEROMOTOCO': 'Auto', 'TVSMOTOR': 'Auto',
  'HINDUNILVR': 'FMCG', 'ITC': 'FMCG', 'NESTLEIND': 'FMCG', 'BRITANNIA': 'FMCG',
  'TATACONSUM': 'FMCG', 'DMART': 'Retail', 'TRENT': 'Retail', 'TITAN': 'Consumer',
  'ASIANPAINT': 'Consumer', 'PIDILITIND': 'Consumer', 'LT': 'Infra', 'ADANIPORTS': 'Infra',
  'ADANIENT': 'Conglomerate', 'ULTRACEMCO': 'Cement', 'GRASIM': 'Cement', 'AMBUJACEM': 'Cement',
  'TATASTEEL': 'Metals', 'JSWSTEEL': 'Metals', 'HINDALCO': 'Metals', 'VEDL': 'Metals',
  'JINDALSTEL': 'Metals', 'NTPC': 'Power', 'POWERGRID': 'Power', 'TATAPOWER': 'Power',
  'BHARTIARTL': 'Telecom', 'HAL': 'Defence', 'BEL': 'Defence',
};
