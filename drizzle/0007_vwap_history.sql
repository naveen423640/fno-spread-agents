CREATE TABLE IF NOT EXISTS vwap_m5_month (
  symbol TEXT NOT NULL,
  month TEXT NOT NULL,
  through TEXT NOT NULL,
  candles_json TEXT NOT NULL,
  PRIMARY KEY (symbol, month)
);
