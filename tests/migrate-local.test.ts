import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { describe, expect, it } from 'vitest';

import { applyMigrations, findLocalDatabases } from '../scripts/migrate-local.mjs';

describe('local migration script', () => {
  it('applies every drizzle file in order and is safe to run twice', () => {
    const dir = mkdtempSync(join(tmpdir(), 'migrate-'));
    const file = join(dir, 'local.sqlite');
    const first = applyMigrations(file, 'drizzle');
    expect(first).toEqual(['0000_preflight.sql', '0001_strategy_lab_reports.sql', '0002_agent_team.sql', '0003_screener.sql', '0004_board.sql', '0005_board_history.sql']);
    applyMigrations(file, 'drizzle');
    const db = new DatabaseSync(file);
    const tables = (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[]).map((row) => row.name);
    expect(tables).toEqual(expect.arrayContaining(['agent_runs', 'agent_steps', 'llm_calls', 'agent_sources', 'verdicts', 'analyst_report_cache', 'preflight_runs', 'screener_candles', 'screener_jobs']));
    db.close();
  });

  it('finds local D1 files and ignores miniflare metadata', () => {
    const dir = mkdtempSync(join(tmpdir(), 'state-'));
    const found = findLocalDatabases(dir);
    expect(found).toEqual([]);
  });
});
