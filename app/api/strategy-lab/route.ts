import { marketSnapshot } from '@/lib/market-snapshot';
import { buildStrategyLabResult, isStrategyKey, loadStrategyLabSetup, syncStrategyLabData, type StrategyLabResult, type StrategyLabSetup, type StrategyLabSync, type StrategyLegInput } from '@/lib/strategy-lab';

const resultCache = new Map<string, { expiresAt: number; promise: Promise<StrategyLabResult> }>();
const setupCache = new Map<string, { expiresAt: number; promise: Promise<StrategyLabSetup> }>();

function errorStatus(message: string) {
  return /choose|cannot|no |missing|unavailable|selected|submitted|only strikes|strategy leg/i.test(message) ? 400 : 502;
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null) as { action?: string; ticker?: string; startDate?: string; strategy?: string; legs?: StrategyLegInput[] } | null;
  const action = body?.action === 'setup' ? 'setup' : body?.action === 'sync' ? 'sync' : 'build';
  const ticker = body?.ticker?.trim().toUpperCase() ?? '';
  const startDate = body?.startDate ?? '';
  const strategy = body?.strategy ?? '';
  if (!marketSnapshot.some((stock) => stock.ticker === ticker)) return Response.json({ error: 'Choose a stock from the current NSE F&O universe.' }, { status: 400 });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate)) return Response.json({ error: 'Choose a valid start date.' }, { status: 400 });
  if (!isStrategyKey(strategy)) return Response.json({ error: 'Choose a supported ready-made strategy.' }, { status: 400 });
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
  if (startDate > today) return Response.json({ error: 'The start date cannot be in the future.' }, { status: 400 });

  const setupKey = `${ticker}:${startDate}:${strategy}`;
  if (action === 'setup') {
    const cachedSetup = setupCache.get(setupKey);
    if (cachedSetup && cachedSetup.expiresAt > Date.now()) {
      try {
        return Response.json(await cachedSetup.promise, { headers: { 'Cache-Control': 'no-store' } });
      } catch {
        setupCache.delete(setupKey);
      }
    }
    const setupPromise = loadStrategyLabSetup(ticker, startDate, strategy);
    setupCache.set(setupKey, { expiresAt: Date.now() + 30 * 60 * 1000, promise: setupPromise });
    if (setupCache.size > 50) setupCache.delete(setupCache.keys().next().value as string);
    try {
      return Response.json(await setupPromise, { headers: { 'Cache-Control': 'no-store' } });
    } catch (error) {
      setupCache.delete(setupKey);
      const message = error instanceof Error ? error.message : 'Unable to prepare the options strategy.';
      return Response.json({ error: message }, { status: errorStatus(message), headers: { 'Cache-Control': 'no-store' } });
    }
  }


  const legs = Array.isArray(body?.legs) ? body.legs : undefined;
  const key = `${setupKey}:${JSON.stringify(legs ?? [])}`;
  let backendSync: StrategyLabSync | null = null;
  if (action === 'sync') {
    setupCache.delete(setupKey);
    for (const cachedKey of resultCache.keys()) {
      if (cachedKey.startsWith(`${setupKey}:`)) resultCache.delete(cachedKey);
    }
    try {
      backendSync = await syncStrategyLabData(ticker, startDate, strategy);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to update the backend NSE data store.';
      return Response.json({ error: message }, { status: errorStatus(message), headers: { 'Cache-Control': 'no-store' } });
    }
  }
  const cached = resultCache.get(key);
  if (cached && cached.expiresAt > Date.now()) {
    try {
      return Response.json(await cached.promise, { headers: { 'Cache-Control': 'no-store' } });
    } catch {
      resultCache.delete(key);
    }
  }
  const promise = buildStrategyLabResult(ticker, startDate, strategy, legs);
  resultCache.set(key, { expiresAt: Date.now() + 6 * 60 * 60 * 1000, promise });
  if (resultCache.size > 30) resultCache.delete(resultCache.keys().next().value as string);
  try {
    const result = await promise;
    return Response.json(backendSync ? { ...result, backendSync } : result, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    resultCache.delete(key);
    const message = error instanceof Error ? error.message : 'Unable to build the options strategy backtest.';
    return Response.json({ error: message }, { status: errorStatus(message), headers: { 'Cache-Control': 'no-store' } });
  }
}
