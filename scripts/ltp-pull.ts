// Pulls recorded days from the cloud recorder into the local database, so the Mac's tabs, replay and agent see what was captured while it was off.
//   npm run ltp:pull                    today and yesterday
//   npm run ltp:pull -- --date 2026-10-12     one day      (add --db <file> to import into another sqlite file)
// Needs LTP_RECORDER_URL (the Worker's address) and LTP_RECORDER_SECRET (its ADMIN_SECRET) in .env.local; this script only reads them from the environment.
import { existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { importExport, type Export } from '../cloud-recorder/src/import';
import { UNDERLYINGS } from '../lib/ltp/recorder';
import { istDate } from '../lib/ltp/time';
import { createSqliteD1 } from './lib/sqlite-d1';

const argv = process.argv.slice(2);
const option = (name: string) => { const i = argv.indexOf(`--${name}`); return i >= 0 ? argv[i + 1] : undefined; };

async function main() {
  const base = process.env.LTP_RECORDER_URL?.replace(/\/$/, '');
  const secret = process.env.LTP_RECORDER_SECRET;
  if (!base || !secret) { console.error('Set LTP_RECORDER_URL and LTP_RECORDER_SECRET in .env.local.'); process.exitCode = 1; return; }
  const dir = '.wrangler/state/v3/d1/miniflare-D1DatabaseObject';
  const found = existsSync(dir) ? readdirSync(dir).find((f) => f.endsWith('.sqlite') && f !== 'metadata.sqlite' && statSync(join(dir, f)).size > 0) : undefined;
  const dbPath = option('db') ?? (found ? join(dir, found) : undefined);
  if (!dbPath || !existsSync(dbPath)) { console.error('No local app database found. Start the app once so it exists, or pass --db <file>.'); process.exitCode = 1; return; }
  const db = createSqliteD1(dbPath);
  const now = Math.floor(Date.now() / 1000);
  const dates = option('date') ? [option('date')!] : [istDate(now - 86_400), istDate(now)];
  for (const date of dates) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) { console.error(`Bad date ${date}; use YYYY-MM-DD.`); process.exitCode = 1; return; }
    for (const underlying of UNDERLYINGS) {
      const response = await fetch(`${base}/export?date=${date}&underlying=${encodeURIComponent(underlying)}`, { headers: { Authorization: `Bearer ${secret}` } });
      if (!response.ok) { console.error(`${date} ${underlying}: the recorder answered ${response.status}.`); process.exitCode = 1; continue; }
      const done = await importExport(db, (await response.json()) as Export);
      console.log(`${date} ${underlying.split(':')[1]}: ${done.snapshots} rows, ${done.gaps} gaps`);
    }
  }
}

main().catch((error) => { console.error(error instanceof Error ? error.message : 'pull failed'); process.exitCode = 1; });
