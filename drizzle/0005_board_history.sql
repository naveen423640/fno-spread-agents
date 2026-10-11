CREATE TABLE IF NOT EXISTS board_m5 (
  symbol TEXT NOT NULL,
  day TEXT NOT NULL,
  candles_json TEXT NOT NULL,
  PRIMARY KEY (symbol, day)
);
CREATE TABLE IF NOT EXISTS board_hist (
  kind TEXT NOT NULL,
  symbol TEXT NOT NULL,
  data_json TEXT NOT NULL,
  loaded_day TEXT NOT NULL,
  PRIMARY KEY (kind, symbol)
);
