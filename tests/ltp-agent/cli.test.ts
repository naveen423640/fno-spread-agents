import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { createLtpStore } from '@/lib/ltp/store';
import { createSqliteD1 } from '../../scripts/lib/sqlite-d1';
import { DAY, pathDay } from '../support/ltp-agent-day';

describe('agent-replay command', () => {
  it('re-runs a recorded day into a throwaway journal, prints a summary and writes the result file', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'agent-cli-'));
    const db = join(dir, 'app.sqlite');
    const store = createLtpStore(createSqliteD1(db, ['drizzle/0008_ltp.sql', 'drizzle/0009_ltp_bidask.sql']));
    for (const s of pathDay([['10:00', 23880], ['10:01', 23862], ['10:02', 23900]])) await store.insertSnapshot(s);
    const out = execFileSync('npx', ['tsx', 'scripts/ltp-agent.ts', 'replay', '--db', db, '--from', DAY, '--to', DAY, '--version', '0.1'], { encoding: 'utf8', timeout: 120_000 });
    expect(out).toContain('agent-replay v0.1');
    expect(out).toContain(DAY);
    const file = `data/agent_replay/${DAY}_${DAY}_v0.1.json`;
    expect(existsSync(file)).toBe(true);
    expect(JSON.parse(readFileSync(file, 'utf8'))[0].day).toBe(DAY);
    rmSync(file);
    rmSync(dir, { recursive: true });
  }, 150_000);
  it('says plainly when there is nothing recorded in the range', () => {
    const dir = mkdtempSync(join(tmpdir(), 'agent-cli-'));
    const db = join(dir, 'empty.sqlite');
    createSqliteD1(db, ['drizzle/0008_ltp.sql', 'drizzle/0009_ltp_bidask.sql']);
    const out = execFileSync('npx', ['tsx', 'scripts/ltp-agent.ts', 'replay', '--db', db, '--from', '2026-01-01', '--to', '2026-01-02'], { encoding: 'utf8', timeout: 120_000 });
    expect(out).toContain('No recorded days between 2026-01-01 and 2026-01-02');
    rmSync(dir, { recursive: true });
  }, 150_000);
});
