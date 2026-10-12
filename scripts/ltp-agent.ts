// LTP agent commands (paper trading only; nothing here can place an order).
//   npm run agent-run                              every minute: asks the running app to step the agent (the app reads the recorded snapshots)
//   npm run agent-replay -- --from 2026-10-12 --to 2026-10-12 --version 0.1 [--db <file>] [--underlying <symbol>]
//                                                  re-runs the agent over recorded days into a throwaway journal and prints what it would have done
// `run` needs the app running, like the recorder. `agent-replay` reads the app's local database read-only and needs neither the app nor FYERS.
import { existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { agentReplayDay, type AgentContext } from '../lib/ltp-agent/agent';
import { createJournalStore } from '../lib/ltp-agent/journal-store';
import { readStrategyFile } from '../lib/ltp-agent/strategy-files';
import { UNDERLYINGS } from '../lib/ltp/recorder';
import { createLtpStore } from '../lib/ltp/store';
import { createSqliteD1 } from './lib/sqlite-d1';

const argv = process.argv.slice(2);
const command = argv[0];
const option = (name: string) => { const i = argv.indexOf(`--${name}`); return i >= 0 ? argv[i + 1] : undefined; };
const base = option('base') ?? 'http://localhost:3000';

async function post(action: string): Promise<string> {
  const response = await fetch(`${base}/api/ltp/agent/step`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action }) });
  const body = (await response.json().catch(() => ({}))) as { error?: string; version?: string; paused?: boolean; results?: Record<string, { decisions?: number; opened?: number; closed?: number }> };
  if (!response.ok || body.error) return `${new Date().toISOString()} ${body.error ?? `HTTP ${response.status}`}`;
  const parts = Object.entries(body.results ?? {}).map(([u, r]) => `${u.split(':')[1]} d${r.decisions ?? 0}/o${r.opened ?? 0}/c${r.closed ?? 0}`);
  return `${new Date().toISOString()} v${body.version}${body.paused ? ' PAUSED' : ''} ${parts.join('  ')}`;
}

function istParts(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(now);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return { weekday: get('weekday'), minute: Number(get('hour')) * 60 + Number(get('minute')) };
}

async function run() {
  console.log(`LTP agent running against ${base}. Press Ctrl+C to stop.`);
  let finishedFor = '';
  for (;;) {
    const { weekday, minute } = istParts();
    const trading = !['Sat', 'Sun'].includes(weekday);
    try {
      if (trading && minute >= 9 * 60 + 15 && minute <= 15 * 60 + 30) console.log(await post('step'));
      const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
      if (trading && minute >= 15 * 60 + 31 && finishedFor !== today) { console.log(`end of day: ${await post('finish_day')}`); finishedFor = today; }
    } catch (error) { console.error(`${new Date().toISOString()} could not reach the app: ${error instanceof Error ? error.message : 'unknown error'}`); }
    // Wake a few seconds after the next minute boundary, so the recorder has stored that minute.
    await new Promise((resolve) => setTimeout(resolve, 60_000 - (Date.now() % 60_000) + 6_000));
  }
}

function findDatabase(): string | undefined {
  const given = option('db');
  if (given) return given;
  const dir = join('.wrangler', 'state', 'v3', 'd1', 'miniflare-D1DatabaseObject');
  if (!existsSync(dir)) return undefined;
  const file = readdirSync(dir).find((f) => f.endsWith('.sqlite') && f !== 'metadata.sqlite' && statSync(join(dir, f)).size > 0);
  return file ? join(dir, file) : undefined;
}

async function replay() {
  const from = option('from');
  const to = option('to') ?? from;
  const version = option('version') ?? '0.1';
  const dbPath = findDatabase();
  if (!from || !to) { console.error('Usage: agent-replay --from YYYY-MM-DD --to YYYY-MM-DD [--version 0.1] [--db <file>] [--underlying <symbol>]'); process.exitCode = 1; return; }
  if (!dbPath || !existsSync(dbPath)) { console.error('No local app database found. Pass --db <file>.'); process.exitCode = 1; return; }
  const source = createSqliteD1(dbPath, [], true);
  const underlyings = option('underlying') ? [option('underlying')!] : UNDERLYINGS;
  const journal = createJournalStore(createSqliteD1(':memory:', ['drizzle/0010_ltp_agent.sql'], false)); // a throwaway journal: replay never touches the live one
  const ctx: AgentContext = { store: createLtpStore(source), journal, strategy: readStrategyFile(version), paused: false };
  const days = ((await source.prepare('SELECT DISTINCT trade_date AS d FROM ltp_snapshots WHERE trade_date >= ? AND trade_date <= ? ORDER BY trade_date').bind(from, to).all<{ d: string }>()).results).map((r) => r.d);
  if (!days.length) { console.log(`No recorded days between ${from} and ${to}.`); return; }
  const rows: Record<string, unknown>[] = [];
  for (const day of days) {
    for (const underlying of underlyings) await agentReplayDay(ctx, underlying, day);
    const decisions = await journal.decisionsForDay(day);
    const outcomes = await journal.outcomesForDay(day);
    const net = (book: string) => Math.round(outcomes.filter((o) => o.book === book).reduce((s, o) => s + o.netPnl, 0) * 100) / 100;
    rows.push({ day, decisions: decisions.length, taken: decisions.filter((d) => d.taken).length, closedTrades: outcomes.length / 2, netBuy: net('buy'), netSell: net('sell') });
  }
  console.log(`agent-replay v${version} ${from}..${to}`);
  console.table(rows);
  mkdirSync('data/agent_replay', { recursive: true });
  const file = join('data/agent_replay', `${from}_${to}_v${version}.json`);
  const all = (await Promise.all(days.map(async (d) => ({ day: d, decisions: await journal.decisionsForDay(d), outcomes: await journal.outcomesForDay(d) }))));
  writeFileSync(file, JSON.stringify(all, null, 1));
  console.log(`wrote ${file}`);
}

async function main() {
  if (command === 'run') await run();
  else if (command === 'replay') await replay();
  else { console.error('Usage: ltp-agent <run | replay>'); process.exitCode = 1; }
}
void main();
