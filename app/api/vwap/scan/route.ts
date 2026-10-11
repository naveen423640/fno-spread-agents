import { checkRequestOrigin } from '@/lib/agent-service/guard';
import { assertPaperOnly } from '@/lib/execution-mode';
import { parseSource, vwapDeps } from '@/lib/vwap/runtime';
import { resolveScanDate, scanUniverse, type SymbolScan } from '@/lib/vwap/service';
import { loadUniverse } from '@/lib/vwap/universe';

const NO_STORE = { 'Cache-Control': 'no-store' };
const MAX_SLICE = 100;

// What the table needs from one scan, without the raw totals.
function row(r: SymbolScan) {
  const s = r.scan;
  return {
    ticker: r.entry.ticker, symbol: r.entry.symbol, name: r.entry.name, sector: r.entry.sector, status: r.status, error: r.error ?? null,
    vwap: s?.vwap ?? null, lastClose: s?.lastClose ?? null, side: s?.side ?? null, distancePct: s?.distancePct ?? null, borderlineNow: s?.borderlineNow ?? false,
    crossesToday: s?.crossesToday ?? 0, events: s?.events ?? [], wickTouches: s?.wickTouches.length ?? 0, candlesUsed: s?.candlesUsed ?? 0,
    formingExcluded: s?.formingExcluded ?? false, flags: s?.flags ?? [], unreliable: r.unreliable, unreliableNote: r.unreliableNote, sessionsInMonth: r.sessionsInMonth,
  };
}

// Scans one slice of a universe, so a large universe is scanned as several short requests the page stitches together.
// Read-only market data. Body: { universe, date, source, offset, limit }.
export async function POST(request: Request) {
  try {
    assertPaperOnly();
    const blocked = checkRequestOrigin(request.headers);
    if (blocked) return Response.json({ error: blocked }, { status: 403, headers: NO_STORE });
    const body = (await request.json().catch(() => null)) as { universe?: unknown; date?: unknown; source?: unknown; offset?: unknown; limit?: unknown } | null;
    const universe = typeof body?.universe === 'string' && body.universe.length <= 400 ? body.universe : 'nifty_it';
    const requestedDate = typeof body?.date === 'string' && (body.date === 'today' || /^\d{4}-\d{2}-\d{2}$/.test(body.date)) ? body.date : 'today';
    const offset = Math.max(0, Math.floor(Number(body?.offset) || 0));
    const limit = Math.min(MAX_SLICE, Math.max(1, Math.floor(Number(body?.limit) || 40)));
    const source = parseSource(body?.source);

    const deps = vwapDeps(request, source);
    if (!deps.ok) return Response.json({ loginRequired: true, error: 'Connect FYERS first.' }, { status: 401, headers: NO_STORE });
    const now = new Date();
    const today = now.toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
    let entries;
    try { entries = await loadUniverse(universe, { store: deps.store, today }); }
    catch (error) { return Response.json({ error: error instanceof Error ? error.message : 'Unknown universe.' }, { status: 400, headers: NO_STORE }); }

    const day = resolveScanDate(requestedDate, now);
    const slice = entries.slice(offset, offset + limit);
    const out = await scanUniverse({ provider: deps.provider, store: deps.store, entries: slice, day, nowSeconds: day === today ? Math.floor(now.getTime() / 1000) : undefined, concurrency: 6 });
    if (out.loginRequired) return Response.json({ loginRequired: true, error: 'The FYERS login has expired. Sign in again.' }, { status: 401, headers: NO_STORE });
    return Response.json({ day, source, total: entries.length, offset, done: offset + slice.length >= entries.length, scannedAt: now.toISOString(), results: out.results.map(row) }, { headers: NO_STORE });
  } catch (error) {
    console.error('vwap scan failed', error);
    return Response.json({ error: 'The scan failed.' }, { status: 500, headers: NO_STORE });
  }
}
