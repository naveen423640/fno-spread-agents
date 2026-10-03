CREATE TABLE IF NOT EXISTS agent_runs (
  id TEXT PRIMARY KEY,
  symbol TEXT NOT NULL,
  as_of TEXT NOT NULL,
  trading_date TEXT NOT NULL,
  status TEXT NOT NULL,
  candidate_json TEXT NOT NULL,
  prompt_set TEXT NOT NULL,
  model_note TEXT NOT NULL,
  created_at TEXT NOT NULL,
  completed_at TEXT
);
CREATE TABLE IF NOT EXISTS agent_steps (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id TEXT NOT NULL,
  role TEXT NOT NULL,
  status TEXT NOT NULL,
  output_json TEXT,
  error TEXT,
  started_at TEXT NOT NULL,
  completed_at TEXT
);
CREATE INDEX IF NOT EXISTS agent_steps_run ON agent_steps(run_id);
CREATE TABLE IF NOT EXISTS llm_calls (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id TEXT NOT NULL,
  role TEXT NOT NULL,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  prompt_hash TEXT NOT NULL,
  tokens_in INTEGER NOT NULL,
  tokens_out INTEGER NOT NULL,
  cost_inr REAL NOT NULL,
  latency_ms INTEGER NOT NULL,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS llm_calls_run ON llm_calls(run_id);
CREATE TABLE IF NOT EXISTS agent_sources (
  id TEXT NOT NULL,
  run_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  title TEXT NOT NULL,
  url TEXT,
  retrieved_at TEXT NOT NULL,
  PRIMARY KEY (run_id, id)
);
CREATE TABLE IF NOT EXISTS verdicts (
  run_id TEXT PRIMARY KEY,
  verdict TEXT NOT NULL,
  reduce_to_lots INTEGER,
  delay_to TEXT,
  body_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS analyst_report_cache (
  symbol TEXT NOT NULL,
  trading_date TEXT NOT NULL,
  role TEXT NOT NULL,
  report_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (symbol, trading_date, role)
);
