CREATE TABLE IF NOT EXISTS vwap_day_totals (
  symbol TEXT NOT NULL,
  month TEXT NOT NULL,
  day TEXT NOT NULL,
  sum_pv REAL NOT NULL,
  sum_v REAL NOT NULL,
  last_close REAL NOT NULL,
  last_vwap REAL,
  day_open REAL NOT NULL,
  day_volume REAL NOT NULL,
  PRIMARY KEY (symbol, day)
);
CREATE INDEX IF NOT EXISTS vwap_day_totals_month ON vwap_day_totals(symbol, month, day);
CREATE TABLE IF NOT EXISTS vwap_month_state (
  symbol TEXT NOT NULL,
  month TEXT NOT NULL,
  checked_through TEXT NOT NULL,
  unreliable INTEGER NOT NULL DEFAULT 0,
  unreliable_note TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (symbol, month)
);
CREATE TABLE IF NOT EXISTS vwap_universe (
  name TEXT PRIMARY KEY,
  symbols_json TEXT NOT NULL,
  fetched_day TEXT NOT NULL
);
