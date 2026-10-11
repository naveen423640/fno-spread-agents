// Backtest of monthly anchored VWAP crossovers, using the same scanSymbol core as the live scanner.
//   npm run vwap:backtest -- --config configs/vwap_bt.json
//   npm run vwap:backtest -- --config configs/vwap_bt.json --out .vwap-cache/backtests/run1
// source "cache" replays the OrderBlock Board's cached candles (no login); source "fyers" fetches month by month and caches them.
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { createBoardCacheProvider } from '../lib/vwap/cache-provider';
import { parseConfig } from '../lib/vwap/backtest/config';
import { createCachingProvider, loadHistory } from '../lib/vwap/backtest/history';
import { runBacktest } from '../lib/vwap/backtest/run';
import { loadSymbolMaster } from '../lib/vwap/backtest/symbol-master';
import { createFyersProvider, type DataProvider } from '../lib/vwap/provider';
import { createVwapStore } from '../lib/vwap/store';
import { loadUniverse } from '../lib/vwap/universe';
import { createSqliteD1 } from './lib/sqlite-d1';

const argv = process.argv.slice(2);
const arg = (name: string) => { const i = argv.indexOf(`--${name}`); return i >= 0 ? argv[i + 1] : undefined; };
const fmt = (v: number | null | undefined, d = 2) => (v === null || v === undefined ? '-' : v.toFixed(d));

async function main() {
  if (argv.includes('--help')) { console.log('Usage: vwap-backtest --config <file.json> [--out <dir>] [--universe <spec>] [--from YYYY-MM-DD] [--to YYYY-MM-DD] [--instrument futures|option] [--source cache|fyers]'); return; }
  const path = arg('config') ?? 'configs/vwap_bt.json';
  const raw = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
  for (const key of ['universe', 'from', 'to', 'instrument', 'source']) { const v = arg(key); if (v) raw[key] = v; }
  const config = parseConfig(raw);
  const now = new Date();
  const today = now.toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });

  mkdirSync('.vwap-cache', { recursive: true });
  const db = createSqliteD1('.vwap-cache/vwap.sqlite', ['drizzle/0006_vwap.sql', 'drizzle/0007_vwap_history.sql']);
  let provider: DataProvider;
  if (config.source === 'cache') {
    const dir = '.wrangler/state/v3/d1/miniflare-D1DatabaseObject';
    const file = existsSync(dir) ? readdirSync(dir).find((f) => f.endsWith('.sqlite') && f !== 'metadata.sqlite' && statSync(join(dir, f)).size > 0) : undefined;
    if (!file) throw new Error('No local board cache found. Run the app and load the OrderBlock Board history first, or use source "fyers".');
    const { DatabaseSync } = await import('node:sqlite');
    const sqlite = new DatabaseSync(join(dir, file), { readOnly: true });
    provider = createBoardCacheProvider({ prepare: (sql: string) => { const st = sqlite.prepare(sql); const build = (values: (string | number | null)[]) => ({ async run() { st.run(...values); return {}; }, async first<T>() { return (st.get(...values) as T | undefined) ?? null; }, async all<T>() { return { results: st.all(...values) as T[] }; } }); return { ...build([]), bind: (...v: (string | number | null)[]) => build(v) }; } });
  } else {
    const clientId = process.env.FYERS_CLIENT_ID, accessToken = process.env.FYERS_ACCESS_TOKEN;
    if (!clientId || !accessToken) throw new Error('FYERS_CLIENT_ID and FYERS_ACCESS_TOKEN are not set. Put the access token in .env.local, or use source "cache".');
    provider = createCachingProvider(createFyersProvider({ credentials: { clientId, accessToken } }), db, today);
  }

  const entries = await loadUniverse(config.universe, { store: createVwapStore(db), today });
  console.log(`Backtest ${config.from} to ${config.to}: ${entries.length} symbols, ${config.exits.length} exit rules, ${config.instrument}, data from ${provider.name}`);
  const history = await loadHistory({ provider, entries, from: config.from, to: config.to, onProgress: (d, t) => { if (d % 10 === 0 || d === t) process.stderr.write(`  loading ${d}/${t}\r`); } });
  if (history.loginRequired) { console.error('\nThe FYERS login has expired. Sign in again and refresh FYERS_ACCESS_TOKEN.'); process.exitCode = 2; return; }
  if (!history.data.length) { console.error(`\nNo usable history. ${history.skipped.slice(0, 5).map((s) => `${s.symbol} ${s.month}: ${s.reason}`).join('; ')}`); process.exitCode = 1; return; }

  const master = await loadSymbolMaster({ readCache: () => (existsSync('.vwap-cache/NSE_FO.csv') ? readFileSync('.vwap-cache/NSE_FO.csv', 'utf8') : null), writeCache: (csv) => writeFileSync('.vwap-cache/NSE_FO.csv', csv) });
  const { result, trades } = runBacktest(config, history.data, history.skipped, master, now);

  const out = arg('out') ?? `.vwap-cache/backtests/${now.toISOString().slice(0, 19).replace(/[:T]/g, '-')}`;
  mkdirSync(out, { recursive: true });
  const header = ['strategy', 'symbol', 'sector', 'day', 'direction', 'signal_type', 'borderline', 'entry_time', 'entry_price', 'exit_time', 'exit_price', 'exit_reason', 'hold_min', 'mae_pct', 'mfe_pct', 'qty', 'gross_pnl', 'costs', 'net_pnl', 'net_pct', 'modelled'];
  const ist = (t: number) => new Date((t + 19_800) * 1000).toISOString().slice(11, 16);
  writeFileSync(join(out, 'trades.csv'), `${header.join(',')}\n${trades.map((t) => [t.strategy, t.ticker, `"${t.sector}"`, t.day, t.direction === 1 ? 'long' : 'short', t.signalType, t.borderline, ist(t.entryT), t.entryPrice, ist(t.exitT), t.exitPrice, t.exitReason, t.holdMinutes, t.maePct.toFixed(4), t.mfePct.toFixed(4), t.qty, t.grossPnl.toFixed(2), t.costs.total.toFixed(2), t.netPnl.toFixed(2), t.netPct.toFixed(4), t.modelled].join(',')).join('\n')}\n`);
  const daily = new Map<string, number>();
  for (const t of trades) daily.set(`${t.strategy},${t.day}`, (daily.get(`${t.strategy},${t.day}`) ?? 0) + t.netPnl);
  writeFileSync(join(out, 'daily_pnl.csv'), `strategy,day,net_pnl\n${[...daily.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k},${v.toFixed(2)}`).join('\n')}\n`);
  writeFileSync(join(out, 'summary.json'), JSON.stringify(result, null, 2));
  writeFileSync(join(out, 'config.json'), JSON.stringify(config, null, 2));

  console.log(`\n${result.range.sessions} sessions, ${result.range.months.join(', ')} (hold-out: ${result.range.holdoutMonths.join(', ') || 'none'}), ${result.symbols} symbols`);
  console.log('\nstrategy                 trades  win%   exp%/trade  expRs   PF    totalRs   maxDD    sharpe | holdout: trades  exp%   | random p  CI95(exp%)');
  for (const s of result.strategies) {
    const h = s.holdout, ci = s.expectancyPctCI.all;
    console.log(`${s.name.padEnd(24)} ${String(s.all.trades).padStart(5)} ${fmt((s.all.winRate ?? 0) * 100, 0).padStart(5)} ${fmt(s.all.expectancyPct, 3).padStart(10)} ${fmt(s.all.expectancyRs, 0).padStart(7)} ${fmt(s.all.profitFactor).padStart(5)} ${fmt(s.all.totalPnl, 0).padStart(9)} ${fmt(s.all.maxDrawdown, 0).padStart(8)} ${fmt(s.all.sharpeDaily).padStart(7)} | ${String(h?.trades ?? '-').padStart(14)} ${fmt(h?.expectancyPct, 3).padStart(6)} | ${fmt(s.random?.pValue, 3).padStart(8)}  ${ci ? `${fmt(ci.low, 3)}..${fmt(ci.high, 3)}` : '-'}`);
  }
  const b = result.baselines;
  console.log(`\nbaselines (net % per trade, futures-style): buy@09:30→close ${fmt(b.openToClose.all.long.meanNetPct, 3)} (n=${b.openToClose.all.long.n}), sell@09:30→close ${fmt(b.openToClose.all.short.meanNetPct, 3)}, gainers/losers ${fmt(b.gainersLosers.all.meanNetPct, 3)} (n=${b.gainersLosers.all.n})`);
  if (result.grid) console.log(`\ngrid: ${result.grid.note}`);
  console.log(`\nSkipped symbol-months: ${result.skipped.length}${result.skipped.length ? ` (e.g. ${result.skipped.slice(0, 3).map((s) => `${s.symbol} ${s.month}: ${s.reason}`).join(' | ')})` : ''}`);
  console.log('\nWARNINGS'); for (const w of result.warnings) console.log(` - ${w}`);
  console.log(`\nSaved to ${out}`);
}

main().catch((error) => { console.error(error instanceof Error ? error.message : 'backtest failed'); process.exitCode = 1; });
