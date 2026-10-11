CREATE TABLE IF NOT EXISTS board_snapshots (
  symbol TEXT NOT NULL,
  ts INTEGER NOT NULL,
  day TEXT NOT NULL,
  ltp REAL NOT NULL,
  volume REAL,
  oi REAL,
  prev_oi REAL,
  open REAL,
  high REAL,
  low REAL,
  prev_close REAL,
  vwap REAL,
  PRIMARY KEY (symbol, ts)
);
CREATE INDEX IF NOT EXISTS board_snapshots_ts ON board_snapshots(ts);
CREATE INDEX IF NOT EXISTS board_snapshots_day ON board_snapshots(day, ts);
CREATE TABLE IF NOT EXISTS board_baselines (
  symbol TEXT PRIMARY KEY,
  refreshed_day TEXT NOT NULL,
  as_of TEXT NOT NULL,
  atr_pct REAL NOT NULL,
  avg_volume REAL NOT NULL,
  prev_close REAL NOT NULL
);
CREATE TABLE IF NOT EXISTS board_intraday_state (
  symbol TEXT NOT NULL,
  day TEXT NOT NULL,
  vwap_side INTEGER NOT NULL,
  open_side INTEGER NOT NULL,
  vwap_crossings INTEGER NOT NULL,
  open_crossings INTEGER NOT NULL,
  PRIMARY KEY (symbol, day)
);
CREATE TABLE IF NOT EXISTS board_oi (
  symbol TEXT PRIMARY KEY,
  oi REAL NOT NULL,
  prev_oi REAL,
  as_of_day TEXT NOT NULL,
  updated_ts INTEGER NOT NULL
);
