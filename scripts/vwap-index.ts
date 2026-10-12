// Fetch Nifty 50 and the current-month Nifty future (5-minute candles) from FYERS into the CLI cache and report what came back.
//   npm run vwap:index                       (from 2026-07-01 to today)
//   npm run vwap:index -- --from 2026-08-01
// Needs FYERS_CLIENT_ID and FYERS_ACCESS_TOKEN (the npm script loads .env.local if it exists). The backtest CLI then reads these candles
// for the index filter (filters.indexFilter = "with").
import { mkdirSync } from 'node:fs';

import { createCachingProvider } from '../lib/vwap/backtest/history';
import { indexSymbolsFor, loadIndexHistory } from '../lib/vwap/backtest/index-load';
import { createFyersProvider } from '../lib/vwap/provider';
import { createSqliteD1 } from './lib/sqlite-d1';

const argv = process.argv.slice(2);
const arg = (name: string) => { const i = argv.indexOf(`--${name}`); return i >= 0 ? argv[i + 1] : undefined; };

async function main() {
  const clientId = process.env.FYERS_CLIENT_ID, accessToken = process.env.FYERS_ACCESS_TOKEN;
  if (!clientId || !accessToken) throw new Error('FYERS_CLIENT_ID and FYERS_ACCESS_TOKEN are not set. Put the access token in .env.local.');
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
  const from = arg('from') ?? '2026-07-01', to = arg('to') ?? today;
  mkdirSync('.vwap-cache', { recursive: true });
  const db = createSqliteD1('.vwap-cache/vwap.sqlite', ['drizzle/0006_vwap.sql', 'drizzle/0007_vwap_history.sql']);
  const { reports, loginRequired } = await loadIndexHistory({ provider: createCachingProvider(createFyersProvider({ credentials: { clientId, accessToken } }), db, today), symbols: indexSymbolsFor(today), from, to });
  if (loginRequired) { console.error('The FYERS login has expired. Sign in again and refresh FYERS_ACCESS_TOKEN.'); process.exitCode = 2; return; }
  for (const r of reports) {
    console.log(`\n${r.symbol}: ${r.ok ? 'ok' : 'NO DATA'}${r.error ? ` (${r.error})` : ''}`);
    console.log(`  ${r.candles} candles, ${r.sessions} sessions (${r.firstDay ?? '-'} to ${r.lastDay ?? '-'}), ${r.sessionsWithVolume} sessions with volume, ${r.zeroVolumeCandles} zero-volume candles`);
    if (r.sampleCandle) console.log(`  sample ${r.sampleCandle.time} IST  o ${r.sampleCandle.o} h ${r.sampleCandle.h} l ${r.sampleCandle.l} c ${r.sampleCandle.c} v ${r.sampleCandle.v}`);
    console.log(`  months usable for the monthly VWAP: ${r.monthsUsable.join(', ') || 'none'}; VWAP computable: ${r.vwapUsable ? 'yes' : 'NO'}`);
    console.log(`  ${r.note}`);
    for (const s of r.skipped) console.log(`  skipped ${s.month}: ${s.reason}`);
  }
}
main().catch((e) => { console.error(e instanceof Error ? e.message : 'index load failed'); process.exitCode = 1; });
