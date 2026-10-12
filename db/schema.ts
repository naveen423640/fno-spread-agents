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

export const screenerCandles = sqliteTable('screener_candles', {
  source: text('source').notNull(),
  symbol: text('symbol').notNull(),
  candlesJson: text('candles_json').notNull(),
  firstDate: text('first_date').notNull(),
  lastDate: text('last_date').notNull(),
  coversFrom: text('covers_from').notNull(),
  refreshedAt: text('refreshed_at').notNull(),
}, (table) => [primaryKey({ columns: [table.source, table.symbol] })]);

export const screenerJobs = sqliteTable('screener_jobs', {
  id: text('id').primaryKey(),
  kind: text('kind').notNull(),
  source: text('source').notNull(),
  paramsJson: text('params_json').notNull(),
  status: text('status').notNull(),
  progress: integer('progress').notNull(),
  message: text('message').notNull(),
  resultJson: text('result_json'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
  completedAt: text('completed_at'),
}, (table) => [index('screener_jobs_kind').on(table.kind, table.source, table.createdAt)]);

export const boardSnapshots = sqliteTable('board_snapshots', {
  symbol: text('symbol').notNull(),
  ts: integer('ts').notNull(),
  day: text('day').notNull(),
  ltp: real('ltp').notNull(),
  volume: real('volume'),
  oi: real('oi'),
  prevOi: real('prev_oi'),
  open: real('open'),
  high: real('high'),
  low: real('low'),
  prevClose: real('prev_close'),
  vwap: real('vwap'),
}, (table) => [primaryKey({ columns: [table.symbol, table.ts] }), index('board_snapshots_ts').on(table.ts), index('board_snapshots_day').on(table.day, table.ts)]);

export const boardBaselines = sqliteTable('board_baselines', {
  symbol: text('symbol').primaryKey(),
  refreshedDay: text('refreshed_day').notNull(),
  asOf: text('as_of').notNull(),
  atrPct: real('atr_pct').notNull(),
  avgVolume: real('avg_volume').notNull(),
  prevClose: real('prev_close').notNull(),
});

export const boardIntradayState = sqliteTable('board_intraday_state', {
  symbol: text('symbol').notNull(),
  day: text('day').notNull(),
  vwapSide: integer('vwap_side').notNull(),
  openSide: integer('open_side').notNull(),
  vwapCrossings: integer('vwap_crossings').notNull(),
  openCrossings: integer('open_crossings').notNull(),
}, (table) => [primaryKey({ columns: [table.symbol, table.day] })]);

export const boardOi = sqliteTable('board_oi', {
  symbol: text('symbol').primaryKey(),
  oi: real('oi').notNull(),
  prevOi: real('prev_oi'),
  asOfDay: text('as_of_day').notNull(),
  updatedTs: integer('updated_ts').notNull(),
});

export const boardM5 = sqliteTable('board_m5', {
  symbol: text('symbol').notNull(),
  day: text('day').notNull(),
  candlesJson: text('candles_json').notNull(),
}, (table) => [primaryKey({ columns: [table.symbol, table.day] })]);

export const boardHist = sqliteTable('board_hist', {
  kind: text('kind').notNull(),
  symbol: text('symbol').notNull(),
  dataJson: text('data_json').notNull(),
  loadedDay: text('loaded_day').notNull(),
}, (table) => [primaryKey({ columns: [table.kind, table.symbol] })]);

export const vwapDayTotals = sqliteTable('vwap_day_totals', {
  symbol: text('symbol').notNull(),
  month: text('month').notNull(),
  day: text('day').notNull(),
  sumPv: real('sum_pv').notNull(),
  sumV: real('sum_v').notNull(),
  lastClose: real('last_close').notNull(),
  lastVwap: real('last_vwap'),
  dayOpen: real('day_open').notNull(),
  dayVolume: real('day_volume').notNull(),
}, (table) => [primaryKey({ columns: [table.symbol, table.day] }), index('vwap_day_totals_month').on(table.symbol, table.month, table.day)]);

export const vwapMonthState = sqliteTable('vwap_month_state', {
  symbol: text('symbol').notNull(),
  month: text('month').notNull(),
  checkedThrough: text('checked_through').notNull(),
  unreliable: integer('unreliable').notNull().default(0),
  unreliableNote: text('unreliable_note').notNull().default(''),
}, (table) => [primaryKey({ columns: [table.symbol, table.month] })]);

export const vwapUniverse = sqliteTable('vwap_universe', {
  name: text('name').primaryKey(),
  symbolsJson: text('symbols_json').notNull(),
  fetchedDay: text('fetched_day').notNull(),
});

export const vwapM5Month = sqliteTable('vwap_m5_month', {
  symbol: text('symbol').notNull(),
  month: text('month').notNull(),
  through: text('through').notNull(),
  candlesJson: text('candles_json').notNull(),
}, (table) => [primaryKey({ columns: [table.symbol, table.month] })]);

export const ltpSnapshots = sqliteTable('ltp_snapshots', {
  underlying: text('underlying').notNull(),
  expiry: text('expiry').notNull(),
  snapshotTs: integer('snapshot_ts').notNull(),
  tradeDate: text('trade_date').notNull(),
  strike: real('strike').notNull(),
  side: text('side').notNull(),
  ltp: real('ltp'),
  oi: real('oi'),
  oiChange: real('oi_change'),
  volume: real('volume'),
  spot: real('spot').notNull(),
  step: real('step').notNull(),
  fetchLatencyMs: integer('fetch_latency_ms'),
  flags: text('flags').notNull().default(''),
}, (table) => [primaryKey({ columns: [table.underlying, table.expiry, table.snapshotTs, table.strike, table.side] }), index('ltp_snapshots_day').on(table.tradeDate, table.underlying, table.snapshotTs)]);

export const recorderGaps = sqliteTable('recorder_gaps', {
  underlying: text('underlying').notNull(),
  minuteTs: integer('minute_ts').notNull(),
  tradeDate: text('trade_date').notNull(),
  reason: text('reason').notNull(),
  detail: text('detail').notNull().default(''),
}, (table) => [primaryKey({ columns: [table.underlying, table.minuteTs] })]);

export const ltpLines0920 = sqliteTable('ltp_lines_0920', {
  tradeDate: text('trade_date').notNull(),
  underlying: text('underlying').notNull(),
  json: text('json').notNull(),
}, (table) => [primaryKey({ columns: [table.tradeDate, table.underlying] })]);

export const ltpWeeklyRange = sqliteTable('ltp_weekly_range', {
  weekStart: text('week_start').notNull(),
  underlying: text('underlying').notNull(),
  json: text('json').notNull(),
}, (table) => [primaryKey({ columns: [table.weekStart, table.underlying] })]);

export const ltpCalibration = sqliteTable('ltp_calibration', {
  id: text('id').primaryKey(),
  underlying: text('underlying').notNull(),
  entryTs: integer('entry_ts').notNull(),
  label: text('label').notNull(),
  actual: real('actual').notNull(),
  snapshotTs: integer('snapshot_ts').notNull(),
  proxiesJson: text('proxies_json').notNull(),
});
