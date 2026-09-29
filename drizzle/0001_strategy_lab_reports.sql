CREATE TABLE IF NOT EXISTS strategy_lab_daily_reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ticker TEXT NOT NULL,
  expiry_date TEXT NOT NULL,
  trading_date TEXT NOT NULL,
  rows_json TEXT NOT NULL,
  row_count INTEGER NOT NULL,
  source TEXT NOT NULL,
  fetched_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS strategy_lab_report_contract_day
ON strategy_lab_daily_reports(ticker, expiry_date, trading_date);
CREATE INDEX IF NOT EXISTS strategy_lab_report_coverage
ON strategy_lab_daily_reports(ticker, expiry_date, trading_date);
PRAGMA optimize;
