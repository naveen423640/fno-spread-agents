// LTP Levels recorder commands. They talk to the running app (default http://localhost:3000), so the data lands in the same database the tab reads.
//   npm run ltp:record-once                 one snapshot of all three underlyings now (add --force to record outside market hours, for testing)
//   npm run ltp:record                      keep recording every minute from 09:15 to 15:30 IST on trading days, until stopped
// The app reads FYERS_ACCESS_TOKEN from .env.local for this (the tab's cookie is not available to a background process). The token expires
// daily; when it does the app logs gap rows with reason login_required and this runner says so.
const argv = process.argv.slice(2);
const command = argv[0];
const flag = (name: string) => argv.includes(`--${name}`);
const option = (name: string) => { const i = argv.indexOf(`--${name}`); return i >= 0 ? argv[i + 1] : undefined; };
const base = option('base') ?? 'http://localhost:3000';

type Result = { underlying: string; inserted: number; gap?: string; skipped?: string; warnings?: string[] };
type Summary = { minuteTs?: number; skipped?: string; results?: Result[]; error?: string; loginRequired?: boolean };

async function post(force: boolean): Promise<{ status: number; body: Summary }> {
  const response = await fetch(`${base}/api/ltp/record`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ force }) });
  return { status: response.status, body: ((await response.json().catch(() => ({}))) as Summary) };
}

function describe(status: number, body: Summary): string {
  const stamp = new Date().toISOString();
  if (status === 401) return `${stamp} login required: set FYERS_ACCESS_TOKEN in .env.local and restart the app`;
  if (body.error) return `${stamp} ${body.error}`;
  if (body.skipped) return `${stamp} ${body.skipped}`;
  return `${stamp} ${(body.results ?? []).map((r) => `${r.underlying.split(':')[1]} ${r.skipped ?? (r.gap ? `GAP(${r.gap})` : `+${r.inserted}`)}`).join('  ')}`;
}

// Weekdays only and 09:14 to 15:31 IST here, just to avoid pointless calls; the app applies the exact window and the holiday list.
function worthCalling(now = new Date()): boolean {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(now);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  const minute = Number(get('hour')) * 60 + Number(get('minute'));
  return !['Sat', 'Sun'].includes(get('weekday')) && minute >= 9 * 60 + 14 && minute <= 15 * 60 + 31;
}

async function main() {
  if (command === 'record-once') {
    const { status, body } = await post(flag('force'));
    console.log(describe(status, body));
    if (status >= 400) process.exitCode = 1;
  } else if (command === 'run') {
    console.log(`LTP recorder running against ${base}. Press Ctrl+C to stop.`);
    for (;;) {
      if (worthCalling()) {
        try { const { status, body } = await post(false); console.log(describe(status, body)); } catch (error) { console.error(`${new Date().toISOString()} could not reach the app: ${error instanceof Error ? error.message : 'unknown error'}`); }
      }
      // Wake a couple of seconds after the next minute boundary.
      await new Promise((resolve) => setTimeout(resolve, 60_000 - (Date.now() % 60_000) + 2_000));
    }
  } else {
    console.log('Usage: ltp-recorder <record-once [--force] | run> [--base http://localhost:3000]');
    process.exitCode = command ? 1 : 0;
  }
}

main().catch((error) => { console.error(error instanceof Error ? error.message : 'recorder failed'); process.exitCode = 1; });
