// Optional local runner: records a board snapshot every minute while the NSE cash session is open (09:15 to 15:30 IST, Mon-Fri),
// so the dataset keeps building even when the Board tab is closed. It calls the running app, which reads FYERS_ACCESS_TOKEN
// from its own environment (.env.local). Holidays are not known here; the server skips a poll when the market is closed.
// Usage: node scripts/board-poller.mjs [http://localhost:3000]
const base = process.argv[2] ?? 'http://localhost:3000';
const INTERVAL_MS = 60_000;

function marketOpen(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(now);
  const get = (type) => parts.find((p) => p.type === type)?.value ?? '';
  const minute = Number(get('hour')) * 60 + Number(get('minute'));
  return !['Sat', 'Sun'].includes(get('weekday')) && minute >= 9 * 60 + 15 && minute < 15 * 60 + 30;
}

async function tick() {
  if (!marketOpen()) return;
  try {
    const response = await fetch(`${base}/api/board/poll`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    const body = await response.json().catch(() => ({}));
    const stamp = new Date().toISOString();
    if (response.status === 401) console.error(`${stamp} login required: set FYERS_ACCESS_TOKEN in .env.local and restart the app`);
    else console.log(`${stamp} ${body.skipped ?? `stocks=${body.stocks} oi=${body.withOi} failed=${body.failedBatches} baselines=${body.baselines?.done}/${body.baselines?.total}`}`);
  } catch (error) {
    console.error(`${new Date().toISOString()} poll failed: ${error instanceof Error ? error.message : "unknown error"}`);
  }
}

console.log(`Board poller running against ${base}. Press Ctrl+C to stop.`);
await tick();
setInterval(tick, INTERVAL_MS);
