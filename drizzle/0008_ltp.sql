CREATE TABLE IF NOT EXISTS ltp_snapshots (
  underlying TEXT NOT NULL,
  expiry TEXT NOT NULL,
  snapshot_ts INTEGER NOT NULL,
  trade_date TEXT NOT NULL,
  strike REAL NOT NULL,
  side TEXT NOT NULL,
  ltp REAL,
  oi REAL,
  oi_change REAL,
  volume REAL,
  spot REAL NOT NULL,
  step REAL NOT NULL,
  fetch_latency_ms INTEGER,
  flags TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (underlying, expiry, snapshot_ts, strike, side)
);
CREATE INDEX IF NOT EXISTS ltp_snapshots_day ON ltp_snapshots(trade_date, underlying, snapshot_ts);
CREATE TABLE IF NOT EXISTS recorder_gaps (
  underlying TEXT NOT NULL,
  minute_ts INTEGER NOT NULL,
  trade_date TEXT NOT NULL,
  reason TEXT NOT NULL,
  detail TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (underlying, minute_ts)
);
CREATE TABLE IF NOT EXISTS ltp_lines_0920 (
  trade_date TEXT NOT NULL,
  underlying TEXT NOT NULL,
  json TEXT NOT NULL,
  PRIMARY KEY (trade_date, underlying)
);
CREATE TABLE IF NOT EXISTS ltp_weekly_range (
  week_start TEXT NOT NULL,
  underlying TEXT NOT NULL,
  json TEXT NOT NULL,
  PRIMARY KEY (week_start, underlying)
);
CREATE TABLE IF NOT EXISTS ltp_calibration (
  id TEXT PRIMARY KEY,
  underlying TEXT NOT NULL,
  entry_ts INTEGER NOT NULL,
  label TEXT NOT NULL,
  actual REAL NOT NULL,
  snapshot_ts INTEGER NOT NULL,
  proxies_json TEXT NOT NULL
);
