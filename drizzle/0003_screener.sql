CREATE TABLE IF NOT EXISTS screener_candles (
  source TEXT NOT NULL,
  symbol TEXT NOT NULL,
  candles_json TEXT NOT NULL,
  first_date TEXT NOT NULL,
  last_date TEXT NOT NULL,
  covers_from TEXT NOT NULL,
  refreshed_at TEXT NOT NULL,
  PRIMARY KEY (source, symbol)
);
CREATE TABLE IF NOT EXISTS screener_jobs (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  source TEXT NOT NULL,
  params_json TEXT NOT NULL,
  status TEXT NOT NULL,
  progress INTEGER NOT NULL,
  message TEXT NOT NULL,
  result_json TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  completed_at TEXT
);
CREATE INDEX IF NOT EXISTS screener_jobs_kind ON screener_jobs(kind, source, created_at);
