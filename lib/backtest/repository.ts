import { getDatabaseBinding } from '@/db';

import type { ResearchConfiguration } from './types';

const schemaStatements = [
  'CREATE TABLE IF NOT EXISTS research_configuration (id INTEGER PRIMARY KEY, completed_cycles INTEGER NOT NULL, stocks_per_cycle INTEGER NOT NULL, entry_time_ist TEXT NOT NULL, minimum_reward_risk REAL NOT NULL, stop_loss TEXT NOT NULL, profit_exit_percent REAL NOT NULL, forced_exit_time_ist TEXT NOT NULL, slippage_per_leg REAL NOT NULL, round_trip_costs REAL NOT NULL, updated_at TEXT NOT NULL)',
  'CREATE TABLE IF NOT EXISTS preflight_runs (id TEXT PRIMARY KEY, status TEXT NOT NULL, phase TEXT NOT NULL, progress_percent INTEGER NOT NULL, summary TEXT NOT NULL, started_at TEXT NOT NULL, completed_at TEXT)',
  'CREATE TABLE IF NOT EXISTS monthly_cycles (id INTEGER PRIMARY KEY AUTOINCREMENT, run_id TEXT NOT NULL, cycle_order INTEGER NOT NULL, expiry_date TEXT NOT NULL, first_eligible_trading_day TEXT NOT NULL, entry_timestamp TEXT NOT NULL, previous_trading_day TEXT NOT NULL, t1_trading_day TEXT NOT NULL)',
  'CREATE UNIQUE INDEX IF NOT EXISTS monthly_cycles_run_order ON monthly_cycles(run_id, cycle_order)',
  'CREATE INDEX IF NOT EXISTS monthly_cycles_run ON monthly_cycles(run_id)',
  'CREATE TABLE IF NOT EXISTS monthly_universe (id INTEGER PRIMARY KEY AUTOINCREMENT, run_id TEXT NOT NULL, cycle_id INTEGER NOT NULL, stock_symbol TEXT NOT NULL, liquidity_metric REAL NOT NULL, liquidity_rank INTEGER NOT NULL, fno_eligible INTEGER NOT NULL, option_data_available INTEGER, liquidity_methodology TEXT NOT NULL, lot_size INTEGER, contract_snapshot_json TEXT NOT NULL)',
  'CREATE UNIQUE INDEX IF NOT EXISTS monthly_universe_cycle_symbol ON monthly_universe(cycle_id, stock_symbol)',
  'CREATE INDEX IF NOT EXISTS monthly_universe_run ON monthly_universe(run_id)',
  'CREATE TABLE IF NOT EXISTS option_data_metadata (id INTEGER PRIMARY KEY AUTOINCREMENT, run_id TEXT NOT NULL, cycle_id INTEGER NOT NULL, stock_symbol TEXT NOT NULL, expiry_date TEXT NOT NULL, option_type TEXT NOT NULL, strike REAL NOT NULL, fyers_symbol TEXT NOT NULL, coverage_start TEXT, coverage_end TEXT, expected_points INTEGER NOT NULL, actual_points INTEGER NOT NULL, missing_intervals INTEGER NOT NULL, completeness_percent REAL NOT NULL, execution_quality TEXT NOT NULL)',
  'CREATE INDEX IF NOT EXISTS option_metadata_run ON option_data_metadata(run_id)',
  'CREATE INDEX IF NOT EXISTS option_metadata_cycle_stock ON option_data_metadata(cycle_id, stock_symbol)',
  'CREATE TABLE IF NOT EXISTS spread_candidates (id INTEGER PRIMARY KEY AUTOINCREMENT, run_id TEXT NOT NULL, cycle_id INTEGER NOT NULL, stock_symbol TEXT NOT NULL, direction TEXT NOT NULL, atm_strike REAL, short_strike REAL, available_strikes_json TEXT NOT NULL, net_debit REAL, spread_width REAL, maximum_loss REAL, maximum_profit REAL, breakeven REAL, actual_reward_risk REAL, lot_size INTEGER, feasible INTEGER NOT NULL, reason TEXT NOT NULL)',
  'CREATE INDEX IF NOT EXISTS spread_candidates_run ON spread_candidates(run_id)',
  'CREATE INDEX IF NOT EXISTS spread_candidates_cycle_stock ON spread_candidates(cycle_id, stock_symbol)',
  'CREATE TABLE IF NOT EXISTS data_quality_results (id INTEGER PRIMARY KEY AUTOINCREMENT, run_id TEXT NOT NULL, severity TEXT NOT NULL, code TEXT NOT NULL, scope TEXT NOT NULL, cycle_id INTEGER, stock_symbol TEXT, message TEXT NOT NULL, details_json TEXT NOT NULL, created_at TEXT NOT NULL)',
  'CREATE INDEX IF NOT EXISTS quality_results_run ON data_quality_results(run_id)',
  'CREATE INDEX IF NOT EXISTS quality_results_severity ON data_quality_results(run_id, severity)',
  'CREATE TABLE IF NOT EXISTS daily_backtest_runs (id TEXT PRIMARY KEY, status TEXT NOT NULL, progress_percent INTEGER NOT NULL, summary TEXT NOT NULL, configuration_json TEXT NOT NULL, cycles_json TEXT, expected_candidates INTEGER, executable_trades INTEGER, exclusions_json TEXT, result_json TEXT, started_at TEXT NOT NULL, completed_at TEXT)',
  'CREATE TABLE IF NOT EXISTS daily_proxy_trades (id INTEGER PRIMARY KEY AUTOINCREMENT, run_id TEXT NOT NULL, cycle TEXT NOT NULL, expiry_date TEXT NOT NULL, entry_date TEXT NOT NULL, t1_trading_day TEXT NOT NULL, stock_symbol TEXT NOT NULL, direction TEXT NOT NULL, long_symbol TEXT NOT NULL, short_symbol TEXT NOT NULL, long_strike REAL NOT NULL, short_strike REAL NOT NULL, lot_size INTEGER NOT NULL, net_debit REAL NOT NULL, maximum_loss REAL NOT NULL, maximum_profit REAL NOT NULL, actual_reward_risk REAL NOT NULL, outcome_json TEXT NOT NULL, marks_json TEXT NOT NULL)',
  'CREATE INDEX IF NOT EXISTS daily_proxy_trades_run ON daily_proxy_trades(run_id)',
  'CREATE INDEX IF NOT EXISTS daily_proxy_trades_stock ON daily_proxy_trades(run_id, stock_symbol)',
];

let schemaReady: Promise<void> | null = null;

export function db() {
  return getDatabaseBinding();
}

export async function ensureSchema() {
  schemaReady ??= (async () => {
    for (const statement of schemaStatements) await db().prepare(statement).run();
  })();
  return schemaReady;
}

export async function saveConfiguration(configuration: ResearchConfiguration) {
  await ensureSchema();
  await db().prepare(`INSERT INTO research_configuration (id, completed_cycles, stocks_per_cycle, entry_time_ist, minimum_reward_risk, stop_loss, profit_exit_percent, forced_exit_time_ist, slippage_per_leg, round_trip_costs, updated_at)
    VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET completed_cycles=excluded.completed_cycles, stocks_per_cycle=excluded.stocks_per_cycle, entry_time_ist=excluded.entry_time_ist, minimum_reward_risk=excluded.minimum_reward_risk, stop_loss=excluded.stop_loss, profit_exit_percent=excluded.profit_exit_percent, forced_exit_time_ist=excluded.forced_exit_time_ist, slippage_per_leg=excluded.slippage_per_leg, round_trip_costs=excluded.round_trip_costs, updated_at=excluded.updated_at`)
    .bind(configuration.completedCycles, configuration.stocksPerCycle, configuration.entryTimeIst, configuration.minimumRewardRisk, configuration.stopLoss, configuration.profitExitPercent, configuration.forcedExitTimeIst, configuration.slippagePerLeg, configuration.roundTripCosts, new Date().toISOString()).run();
}

export async function latestRunId() {
  await ensureSchema();
  const row = await db().prepare('SELECT id FROM preflight_runs ORDER BY started_at DESC LIMIT 1').first<{ id: string }>();
  return row?.id ?? null;
}

export async function resolveRunId(request: Request) {
  const supplied = new URL(request.url).searchParams.get('runId');
  return supplied || latestRunId();
}

export async function queryAll<T>(sql: string, ...bindings: unknown[]) {
  await ensureSchema();
  const result = await db().prepare(sql).bind(...bindings).all<T>();
  return result.results;
}
