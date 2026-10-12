import { getDatabaseBinding } from '@/db';
import { checkRequestOrigin } from '@/lib/agent-service/guard';
import { calibrationSummary, proxiesAt } from '@/lib/ltp/calibration';
import { UNDERLYINGS } from '@/lib/ltp/recorder';
import { createLtpStore } from '@/lib/ltp/store';
import { istDate } from '@/lib/ltp/time';

const NO_STORE = { 'Cache-Control': 'no-store' };

// GET ?underlying= : the logged entries and the per-method error summary. POST: log what the LTP Calculator website showed for EOS / EOR at a time.
export async function GET(request: Request) {
  try {
    const underlying = new URL(request.url).searchParams.get('underlying') ?? UNDERLYINGS[0];
    if (!UNDERLYINGS.includes(underlying)) return Response.json({ error: 'Unknown underlying.' }, { status: 400, headers: NO_STORE });
    const entries = await createLtpStore(getDatabaseBinding()).calibrationEntries(underlying);
    return Response.json({ entries, summary: calibrationSummary(entries) }, { headers: NO_STORE });
  } catch (error) {
    console.error('ltp calibration read failed', error);
    return Response.json({ error: 'Unable to read the calibration log.' }, { status: 500, headers: NO_STORE });
  }
}

export async function POST(request: Request) {
  try {
    const blocked = checkRequestOrigin(request.headers);
    if (blocked) return Response.json({ error: blocked }, { status: 403, headers: NO_STORE });
    const body = (await request.json().catch(() => null)) as { underlying?: unknown; entryTs?: unknown; label?: unknown; actual?: unknown } | null;
    const underlying = typeof body?.underlying === 'string' ? body.underlying : '';
    const entryTs = Number(body?.entryTs);
    const actual = Number(body?.actual);
    if (!UNDERLYINGS.includes(underlying) || !Number.isFinite(entryTs) || !Number.isFinite(actual) || typeof body?.label !== 'string') {
      return Response.json({ error: 'underlying, entryTs (unix seconds), label and actual are required.' }, { status: 400, headers: NO_STORE });
    }
    const store = createLtpStore(getDatabaseBinding());
    const snaps = await store.snapshotsForDay(underlying, istDate(entryTs));
    const result = proxiesAt(snaps, entryTs, body.label);
    if (!result.ok) return Response.json({ error: result.message }, { status: 422, headers: NO_STORE });
    const entry = { id: crypto.randomUUID(), underlying, entryTs, label: body.label, actual, snapshotTs: result.snapshotTs, proxies: result.proxies };
    await store.addCalibration(entry);
    const entries = await store.calibrationEntries(underlying);
    return Response.json({ entry, entries, summary: calibrationSummary(entries) }, { headers: NO_STORE });
  } catch (error) {
    console.error('ltp calibration write failed', error);
    return Response.json({ error: 'Unable to log that entry.' }, { status: 500, headers: NO_STORE });
  }
}
