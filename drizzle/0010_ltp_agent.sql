-- LTP agent journal. Decisions are written once: the triggers below abort any UPDATE or DELETE, so outcomes and reviews can never leak into the "why".
CREATE TABLE IF NOT EXISTS agent_decisions (
  decision_id TEXT PRIMARY KEY,
  ts INTEGER NOT NULL,
  trade_date TEXT NOT NULL,
  underlying TEXT NOT NULL,
  strategy_version TEXT NOT NULL,
  setup TEXT NOT NULL,
  direction TEXT NOT NULL,
  book TEXT NOT NULL,
  taken INTEGER NOT NULL,
  skip_reason TEXT,
  context_json TEXT NOT NULL,
  trace_json TEXT NOT NULL,
  reason TEXT NOT NULL,
  expectation_json TEXT NOT NULL,
  data_quality_json TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS agent_decisions_day ON agent_decisions(trade_date, underlying, ts);
CREATE TRIGGER IF NOT EXISTS agent_decisions_no_update BEFORE UPDATE ON agent_decisions BEGIN SELECT RAISE(ABORT, 'agent decisions are immutable'); END;
CREATE TRIGGER IF NOT EXISTS agent_decisions_no_delete BEFORE DELETE ON agent_decisions BEGIN SELECT RAISE(ABORT, 'agent decisions are immutable'); END;

-- One row per taken decision and book: the live position, until it closes.
CREATE TABLE IF NOT EXISTS agent_trades (
  decision_id TEXT NOT NULL,
  book TEXT NOT NULL,
  status TEXT NOT NULL,
  opened_ts INTEGER NOT NULL,
  position_json TEXT NOT NULL,
  PRIMARY KEY (decision_id, book)
);

-- Results, written once when a trade closes. Never part of the decision record.
CREATE TABLE IF NOT EXISTS trade_outcomes (
  decision_id TEXT NOT NULL,
  book TEXT NOT NULL,
  trade_date TEXT NOT NULL,
  closed_ts INTEGER NOT NULL,
  net_pnl REAL NOT NULL,
  outcome_json TEXT NOT NULL,
  PRIMARY KEY (decision_id, book)
);
CREATE INDEX IF NOT EXISTS trade_outcomes_day ON trade_outcomes(trade_date);

CREATE TABLE IF NOT EXISTS trade_reviews (
  decision_id TEXT PRIMARY KEY,
  model TEXT NOT NULL,
  review_json TEXT NOT NULL,
  created_ts INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS agent_experiments (
  id TEXT PRIMARY KEY,
  status TEXT NOT NULL,
  json TEXT NOT NULL,
  created_ts INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS agent_state (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- Strategy versions as text. The app cannot read files at run time, so the active strategy comes from here (seeded from the bundled v0.1);
-- the strategies/ folder holds the committed copies.
CREATE TABLE IF NOT EXISTS agent_strategies (
  version TEXT PRIMARY KEY,
  yaml TEXT NOT NULL,
  changelog TEXT NOT NULL,
  created_ts INTEGER NOT NULL
);
