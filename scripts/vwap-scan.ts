// Monthly anchored VWAP crossover scan.
//   npm run vwap:scan -- --universe nifty_it --date today
//   npm run vwap:scan -- --universe custom:TCS,INFY --date 2026-10-07 --events
//   npm run vwap:scan -- --universe fo --csv out.csv
//   npm run vwap:scan -- --universe nifty_it --date 2026-10-07 --source cache     (offline, from the OrderBlock Board's cached candles)
// Live scans read FYERS_CLIENT_ID and FYERS_ACCESS_TOKEN from the environment (the npm script loads .env.local if it exists).
import { existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { createFyersProvider, type DataProvider } from '../lib/vwap/provider';
import { resolveScanDate, scanUniverse, type SymbolScan } from '../lib/vwap/service';
import { createVwapStore } from '../lib/vwap/store';
import { loadUniverse } from '../lib/vwap/universe';
import { createBoardCacheProvider } from './lib/board-cache-provider';
import { createSqliteD1 } from './lib/sqlite-d1';

const args = new Map<string, string>();
const flags = new Set<string>();
for (let i = 2; i < process.argv.length; i += 1) {
  const a = process.argv[i];
  if (!a.startsWith('--')) continue;
  const next = process.argv[i + 1];
  if (next !== undefined && !next.startsWith('--')) { args.set(a.slice(2), next); i += 1; } else flags.add(a.slice(2));
}

const help = `Usage: vwap-scan --universe <name> [--date today|YYYY-MM-DD] [options]
  --universe   nifty_it | fo | nifty500 | sector:<name> | industry:<name> | custom:TCS,INFY   (default nifty_it)
  --date       today (default) or a YYYY-MM-DD date
  --source     fyers (default) or cache (offline, uses the OrderBlock Board's cached candles)
  --events     print every cross event, not just the last
  --direction  up | down: only symbols with a cross in that direction
  --borderline only symbols with a borderline cross
  --csv <file> write one row per cross event
  --db <file>  cache database (default .vwap-cache/vwap.sqlite)
  --concurrency <n>  parallel requests (default 6)`;
if (flags.has('help') || flags.has('h')) { console.log(help); process.exit(0); }

const pad = (v: string, n: number) => v.padEnd(n);
const num = (v: number | null | undefined, d = 2) => (v === null || v === undefined ? '-' : v.toFixed(d));

async function main() {
  const now = new Date();
  const day = resolveScanDate(args.get('date') ?? 'today', now);
  const today = now.toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
  const dbPath = args.get('db') ?? '.vwap-cache/vwap.sqlite';
  mkdirSync(join(dbPath, '..'), { recursive: true });
  const store = createVwapStore(createSqliteD1(dbPath, ['drizzle/0006_vwap.sql']));

  let provider: DataProvider;
  if ((args.get('source') ?? 'fyers') === 'cache') {
    const dir = '.wrangler/state/v3/d1/miniflare-D1DatabaseObject';
    const file = existsSync(dir) ? readdirSync(dir).find((f) => f.endsWith('.sqlite') && f !== 'metadata.sqlite' && statSync(join(dir, f)).size > 0) : undefined;
    if (!file) throw new Error('No local board cache found. Run the app and load the OrderBlock Board history first.');
    provider = createBoardCacheProvider(join(dir, file));
  } else {
    const clientId = process.env.FYERS_CLIENT_ID;
    const accessToken = process.env.FYERS_ACCESS_TOKEN;
    if (!clientId || !accessToken) throw new Error('FYERS_CLIENT_ID and FYERS_ACCESS_TOKEN are not set. Log in through the app and put the access token in .env.local, or use --source cache.');
    provider = createFyersProvider({ credentials: { clientId, accessToken } });
  }

  const entries = await loadUniverse(args.get('universe') ?? 'nifty_it', { store, today });
  console.log(`Scanning ${entries.length} symbols for ${day} (${provider.name})…`);
  const scanning = day === today;
  const out = await scanUniverse({
    provider, store, entries, day, nowSeconds: scanning ? Math.floor(now.getTime() / 1000) : undefined, concurrency: Number(args.get('concurrency') ?? 6),
    onProgress: (done, total) => { if (done % 25 === 0 || done === total) process.stderr.write(`  ${done}/${total}\r`); },
  });
  if (out.loginRequired) { console.error('\nThe FYERS login has expired. Sign in again and refresh FYERS_ACCESS_TOKEN.'); process.exitCode = 2; return; }

  const direction = args.get('direction');
  const rows = out.results.filter((r) => {
    if (r.status !== 'ok' || !r.scan) return true;
    if (direction && !r.scan.events.some((e) => e.direction === direction)) return false;
    if (flags.has('borderline') && !r.scan.events.some((e) => e.borderline)) return false;
    return true;
  });

  console.log('');
  console.log([pad('SYMBOL', 12), pad('SIDE', 6), pad('VWAP', 10), pad('CLOSE', 10), pad('DIST%', 8), pad('CROSSES', 8), 'LAST CROSS / NOTES'].join(' '));
  for (const r of rows) {
    const s = r.scan;
    if (r.status !== 'ok' || !s) { console.log(`${pad(r.entry.ticker, 12)} ${r.status === 'error' ? `error: ${r.error}` : 'no session on this date'}`); continue; }
    const last = s.events[s.events.length - 1];
    const notes = [last ? `${last.time} ${last.direction} ${last.type}${last.borderline ? ' (borderline)' : ''}` : 'no cross', ...(r.unreliable ? [`VWAP UNRELIABLE: ${r.unreliableNote}`] : []), ...(s.formingExcluded ? ['forming candle excluded'] : [])];
    console.log([pad(r.entry.ticker, 12), pad(s.side ?? '-', 6), pad(num(s.vwap), 10), pad(num(s.lastClose), 10), pad(num(s.distancePct, 3), 8), pad(String(s.crossesToday), 8), notes.join('; ')].join(' '));
    if (flags.has('events')) for (const e of s.events) console.log(`    ${e.time}  ${e.direction.padEnd(4)} ${e.type.padEnd(11)} close ${num(e.close)}  vwap ${num(e.vwap)}${e.borderline ? '  borderline' : ''}`);
  }
  const failed = out.results.filter((r) => r.status === 'error').length;
  console.log(`\n${rows.filter((r: SymbolScan) => r.scan && r.scan.crossesToday > 0).length} symbols with a cross, ${failed} errors, ${out.results.filter((r) => r.status === 'no-session').length} without a session.`);

  const csv = args.get('csv');
  if (csv) {
    const lines = ['date,symbol,sector,time,direction,type,open,close,vwap,distance_pct,borderline'];
    for (const r of out.results) for (const e of r.scan?.events ?? []) lines.push([day, r.entry.ticker, `"${r.entry.sector}"`, e.time, e.direction, e.type, e.open, e.close, e.vwap.toFixed(4), e.distancePct.toFixed(4), e.borderline].join(','));
    writeFileSync(csv, `${lines.join('\n')}\n`);
    console.log(`Wrote ${lines.length - 1} cross events to ${csv}`);
  }
}

main().catch((error) => { console.error(error instanceof Error ? error.message : 'scan failed'); process.exitCode = 1; });
