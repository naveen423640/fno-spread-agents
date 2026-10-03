import { describe, expect, it } from 'vitest';

import { createD1Fake } from './support/d1-fake';

const MIGRATIONS = ['drizzle/0000_preflight.sql', 'drizzle/0001_strategy_lab_reports.sql', 'drizzle/0002_agent_team.sql'];
const NOW = '2026-10-03T10:00:00.000Z';

describe('agent team tables', () => {
  it('round-trips a row in each of the six tables', async () => {
    const db = createD1Fake(MIGRATIONS);
    await db.prepare('INSERT INTO agent_runs (id, symbol, as_of, trading_date, status, candidate_json, prompt_set, model_note, created_at, completed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .bind('r1', 'NSE:TCS-EQ', '2026-10-01', '2026-10-01', 'running', '{}', 'agents-v1', '', NOW, null).run();
    await db.prepare('INSERT INTO agent_steps (run_id, role, status, output_json, error, started_at, completed_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .bind('r1', 'technical', 'ok', '{}', null, NOW, NOW).run();
    await db.prepare('INSERT INTO llm_calls (run_id, role, provider, model, prompt_hash, tokens_in, tokens_out, cost_inr, latency_ms, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .bind('r1', 'technical', 'p', 'm', 'h', 10, 5, 0, 120, 'ok', NOW).run();
    await db.prepare('INSERT INTO agent_sources (id, run_id, kind, title, url, retrieved_at) VALUES (?, ?, ?, ?, ?, ?)')
      .bind('s1', 'r1', 'regime', 'Regime', null, NOW).run();
    await db.prepare('INSERT INTO verdicts (run_id, verdict, reduce_to_lots, delay_to, body_json, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      .bind('r1', 'VETO', null, null, '{}', NOW).run();
    await db.prepare('INSERT INTO analyst_report_cache (symbol, trading_date, role, report_json, created_at) VALUES (?, ?, ?, ?, ?)')
      .bind('NSE:TCS-EQ', '2026-10-01', 'technical', '{}', NOW).run();

    for (const [table, count] of [['agent_runs', 1], ['agent_steps', 1], ['llm_calls', 1], ['agent_sources', 1], ['verdicts', 1], ['analyst_report_cache', 1]] as const) {
      const row = await db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).first<{ n: number }>();
      expect(row?.n, table).toBe(count);
    }
    const run = await db.prepare('SELECT symbol, status FROM agent_runs WHERE id = ?').bind('r1').first<{ symbol: string; status: string }>();
    expect(run).toEqual({ symbol: 'NSE:TCS-EQ', status: 'running' });
  });

  it('rejects a duplicate (symbol, trading_date, role) in analyst_report_cache', async () => {
    const db = createD1Fake(MIGRATIONS);
    const insert = () => db.prepare('INSERT INTO analyst_report_cache (symbol, trading_date, role, report_json, created_at) VALUES (?, ?, ?, ?, ?)')
      .bind('NSE:TCS-EQ', '2026-10-01', 'technical', '{}', NOW).run();
    await insert();
    await expect(insert()).rejects.toThrow();
  });
});
