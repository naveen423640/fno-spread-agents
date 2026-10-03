import { index, integer, primaryKey, real, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

export const researchConfiguration = sqliteTable('research_configuration', {
  id: integer('id').primaryKey(),
  completedCycles: integer('completed_cycles').notNull(),
  stocksPerCycle: integer('stocks_per_cycle').notNull(),
  entryTimeIst: text('entry_time_ist').notNull(),
  minimumRewardRisk: real('minimum_reward_risk').notNull(),
  stopLoss: text('stop_loss').notNull(),
  profitExitPercent: real('profit_exit_percent').notNull(),
  forcedExitTimeIst: text('forced_exit_time_ist').notNull(),
  slippagePerLeg: real('slippage_per_leg').notNull(),
  roundTripCosts: real('round_trip_costs').notNull(),
  updatedAt: text('updated_at').notNull(),
});

export const preflightRuns = sqliteTable('preflight_runs', {
  id: text('id').primaryKey(),
  status: text('status').notNull(),
  phase: text('phase').notNull(),
  progressPercent: integer('progress_percent').notNull(),
  summary: text('summary').notNull(),
  startedAt: text('started_at').notNull(),
  completedAt: text('completed_at'),
});

export const monthlyCycles = sqliteTable('monthly_cycles', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  runId: text('run_id').notNull(),
  cycleOrder: integer('cycle_order').notNull(),
  expiryDate: text('expiry_date').notNull(),
  firstEligibleTradingDay: text('first_eligible_trading_day').notNull(),
  entryTimestamp: text('entry_timestamp').notNull(),
  previousTradingDay: text('previous_trading_day').notNull(),
  t1TradingDay: text('t1_trading_day').notNull(),
}, (table) => [
  uniqueIndex('monthly_cycles_run_order').on(table.runId, table.cycleOrder),
  index('monthly_cycles_run').on(table.runId),
]);

export const monthlyUniverse = sqliteTable('monthly_universe', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  runId: text('run_id').notNull(),
  cycleId: integer('cycle_id').notNull(),
  stockSymbol: text('stock_symbol').notNull(),
  liquidityMetric: real('liquidity_metric').notNull(),
  liquidityRank: integer('liquidity_rank').notNull(),
  fnoEligible: integer('fno_eligible', { mode: 'boolean' }).notNull(),
  optionDataAvailable: integer('option_data_available', { mode: 'boolean' }),
  liquidityMethodology: text('liquidity_methodology').notNull(),
  lotSize: integer('lot_size'),
  contractSnapshotJson: text('contract_snapshot_json').notNull(),
}, (table) => [
  uniqueIndex('monthly_universe_cycle_symbol').on(table.cycleId, table.stockSymbol),
  index('monthly_universe_run').on(table.runId),
]);

export const optionDataMetadata = sqliteTable('option_data_metadata', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  runId: text('run_id').notNull(),
  cycleId: integer('cycle_id').notNull(),
  stockSymbol: text('stock_symbol').notNull(),
  expiryDate: text('expiry_date').notNull(),
  optionType: text('option_type').notNull(),
  strike: real('strike').notNull(),
  fyersSymbol: text('fyers_symbol').notNull(),
  coverageStart: text('coverage_start'),
  coverageEnd: text('coverage_end'),
  expectedPoints: integer('expected_points').notNull(),
  actualPoints: integer('actual_points').notNull(),
  missingIntervals: integer('missing_intervals').notNull(),
  completenessPercent: real('completeness_percent').notNull(),
  executionQuality: text('execution_quality').notNull(),
}, (table) => [index('option_metadata_run').on(table.runId), index('option_metadata_cycle_stock').on(table.cycleId, table.stockSymbol)]);

export const spreadCandidates = sqliteTable('spread_candidates', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  runId: text('run_id').notNull(),
  cycleId: integer('cycle_id').notNull(),
  stockSymbol: text('stock_symbol').notNull(),
  direction: text('direction').notNull(),
  atmStrike: real('atm_strike'),
  shortStrike: real('short_strike'),
  availableStrikesJson: text('available_strikes_json').notNull(),
  netDebit: real('net_debit'),
  spreadWidth: real('spread_width'),
  maximumLoss: real('maximum_loss'),
  maximumProfit: real('maximum_profit'),
  breakeven: real('breakeven'),
  actualRewardRisk: real('actual_reward_risk'),
  lotSize: integer('lot_size'),
  feasible: integer('feasible', { mode: 'boolean' }).notNull(),
  reason: text('reason').notNull(),
}, (table) => [index('spread_candidates_run').on(table.runId), index('spread_candidates_cycle_stock').on(table.cycleId, table.stockSymbol)]);

export const dataQualityResults = sqliteTable('data_quality_results', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  runId: text('run_id').notNull(),
  severity: text('severity').notNull(),
  code: text('code').notNull(),
  scope: text('scope').notNull(),
  cycleId: integer('cycle_id'),
  stockSymbol: text('stock_symbol'),
  message: text('message').notNull(),
  detailsJson: text('details_json').notNull(),
  createdAt: text('created_at').notNull(),
}, (table) => [index('quality_results_run').on(table.runId), index('quality_results_severity').on(table.runId, table.severity)]);

export const dailyBacktestRuns = sqliteTable('daily_backtest_runs', {
  id: text('id').primaryKey(),
  status: text('status').notNull(),
  progressPercent: integer('progress_percent').notNull(),
  summary: text('summary').notNull(),
  configurationJson: text('configuration_json').notNull(),
  cyclesJson: text('cycles_json'),
  expectedCandidates: integer('expected_candidates'),
  executableTrades: integer('executable_trades'),
  exclusionsJson: text('exclusions_json'),
  resultJson: text('result_json'),
  startedAt: text('started_at').notNull(),
  completedAt: text('completed_at'),
});

export const dailyProxyTrades = sqliteTable('daily_proxy_trades', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  runId: text('run_id').notNull(),
  cycle: text('cycle').notNull(),
  expiryDate: text('expiry_date').notNull(),
  entryDate: text('entry_date').notNull(),
  t1TradingDay: text('t1_trading_day').notNull(),
  stockSymbol: text('stock_symbol').notNull(),
  direction: text('direction').notNull(),
  longSymbol: text('long_symbol').notNull(),
  shortSymbol: text('short_symbol').notNull(),
  longStrike: real('long_strike').notNull(),
  shortStrike: real('short_strike').notNull(),
  lotSize: integer('lot_size').notNull(),
  netDebit: real('net_debit').notNull(),
  maximumLoss: real('maximum_loss').notNull(),
  maximumProfit: real('maximum_profit').notNull(),
  actualRewardRisk: real('actual_reward_risk').notNull(),
  outcomeJson: text('outcome_json').notNull(),
  marksJson: text('marks_json').notNull(),
}, (table) => [index('daily_proxy_trades_run').on(table.runId), index('daily_proxy_trades_stock').on(table.runId, table.stockSymbol)]);

export const strategyLabDailyReports = sqliteTable('strategy_lab_daily_reports', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  ticker: text('ticker').notNull(),
  expiryDate: text('expiry_date').notNull(),
  tradingDate: text('trading_date').notNull(),
  rowsJson: text('rows_json').notNull(),
  rowCount: integer('row_count').notNull(),
  source: text('source').notNull(),
  fetchedAt: text('fetched_at').notNull(),
}, (table) => [
  uniqueIndex('strategy_lab_report_contract_day').on(table.ticker, table.expiryDate, table.tradingDate),
  index('strategy_lab_report_coverage').on(table.ticker, table.expiryDate, table.tradingDate),
]);

export const agentRuns = sqliteTable('agent_runs', {
  id: text('id').primaryKey(),
  symbol: text('symbol').notNull(),
  asOf: text('as_of').notNull(),
  tradingDate: text('trading_date').notNull(),
  status: text('status').notNull(),
  candidateJson: text('candidate_json').notNull(),
  promptSet: text('prompt_set').notNull(),
  modelNote: text('model_note').notNull(),
  createdAt: text('created_at').notNull(),
  completedAt: text('completed_at'),
});

export const agentSteps = sqliteTable('agent_steps', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  runId: text('run_id').notNull(),
  role: text('role').notNull(),
  status: text('status').notNull(),
  outputJson: text('output_json'),
  error: text('error'),
  startedAt: text('started_at').notNull(),
  completedAt: text('completed_at'),
}, (table) => [index('agent_steps_run').on(table.runId)]);

export const llmCalls = sqliteTable('llm_calls', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  runId: text('run_id').notNull(),
  role: text('role').notNull(),
  provider: text('provider').notNull(),
  model: text('model').notNull(),
  promptHash: text('prompt_hash').notNull(),
  tokensIn: integer('tokens_in').notNull(),
  tokensOut: integer('tokens_out').notNull(),
  costInr: real('cost_inr').notNull(),
  latencyMs: integer('latency_ms').notNull(),
  status: text('status').notNull(),
  createdAt: text('created_at').notNull(),
}, (table) => [index('llm_calls_run').on(table.runId)]);

export const agentSources = sqliteTable('agent_sources', {
  id: text('id').notNull(),
  runId: text('run_id').notNull(),
  kind: text('kind').notNull(),
  title: text('title').notNull(),
  url: text('url'),
  retrievedAt: text('retrieved_at').notNull(),
}, (table) => [primaryKey({ columns: [table.runId, table.id] })]);

export const verdicts = sqliteTable('verdicts', {
  runId: text('run_id').primaryKey(),
  verdict: text('verdict').notNull(),
  reduceToLots: integer('reduce_to_lots'),
  delayTo: text('delay_to'),
  bodyJson: text('body_json').notNull(),
  createdAt: text('created_at').notNull(),
});

export const analystReportCache = sqliteTable('analyst_report_cache', {
  symbol: text('symbol').notNull(),
  tradingDate: text('trading_date').notNull(),
  role: text('role').notNull(),
  reportJson: text('report_json').notNull(),
  createdAt: text('created_at').notNull(),
}, (table) => [primaryKey({ columns: [table.symbol, table.tradingDate, table.role] })]);
