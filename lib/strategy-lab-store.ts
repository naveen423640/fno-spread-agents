import { getDatabaseBinding } from '@/db';

import type { FoRow } from './backtest/types';

const createTableSql = `CREATE TABLE IF NOT EXISTS strategy_lab_daily_reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ticker TEXT NOT NULL,
  expiry_date TEXT NOT NULL,
  trading_date TEXT NOT NULL,
  rows_json TEXT NOT NULL,
  row_count INTEGER NOT NULL,
  source TEXT NOT NULL,
  fetched_at TEXT NOT NULL
)`;
const createUniqueIndexSql = 'CREATE UNIQUE INDEX IF NOT EXISTS strategy_lab_report_contract_day ON strategy_lab_daily_reports(ticker, expiry_date, trading_date)';
const createCoverageIndexSql = 'CREATE INDEX IF NOT EXISTS strategy_lab_report_coverage ON strategy_lab_daily_reports(ticker, expiry_date, trading_date)';

let storeReady: Promise<void> | null = null;

async function ensureStrategyLabStore() {
  storeReady ??= (async () => {
    const database = getDatabaseBinding();
    await database.prepare(createTableSql).run();
    await database.prepare(createUniqueIndexSql).run();
    await database.prepare(createCoverageIndexSql).run();
    await database.prepare('PRAGMA optimize').run();
  })();
  return storeReady;
}

export async function loadStoredStrategyLabReport(ticker: string, expiryDate: string, tradingDate: string) {
  await ensureStrategyLabStore();
  const row = await getDatabaseBinding().prepare('SELECT rows_json FROM strategy_lab_daily_reports WHERE ticker = ? AND expiry_date = ? AND trading_date = ? LIMIT 1')
    .bind(ticker, expiryDate, tradingDate).first<{ rows_json: string }>();
  if (!row?.rows_json) return null;
  return JSON.parse(row.rows_json) as FoRow[];
}

export async function saveStrategyLabReport(ticker: string, expiryDate: string, tradingDate: string, rows: FoRow[]) {
  await ensureStrategyLabStore();
  const fetchedAt = new Date().toISOString();
  await getDatabaseBinding().prepare(`INSERT INTO strategy_lab_daily_reports (ticker, expiry_date, trading_date, rows_json, row_count, source, fetched_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(ticker, expiry_date, trading_date) DO UPDATE SET rows_json=excluded.rows_json, row_count=excluded.row_count, source=excluded.source, fetched_at=excluded.fetched_at`)
    .bind(ticker, expiryDate, tradingDate, JSON.stringify(rows), rows.length, 'NSE F&O UDiFF bhavcopy', fetchedAt).run();
  return fetchedAt;
}
