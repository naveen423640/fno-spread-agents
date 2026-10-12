import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { loadActiveStrategy, loadStrategy } from '@/lib/ltp-agent/strategy-store';
import { parseStrategy } from '@/lib/ltp-agent/strategy';
import { freshStores } from '../support/ltp-agent-day';

const v01Text = readFileSync('strategies/ltp_v0.1.yaml', 'utf8');

describe('the live agent gets its strategy from the database, with v0.1 bundled as the fallback', () => {
  it('with nothing stored, the active strategy is the bundled v0.1, identical to the file', async () => {
    const { journal } = freshStores();
    expect(await loadActiveStrategy(journal)).toEqual(parseStrategy(v01Text));
  });
  it('a stored version wins over the bundled one, and the active version is read from the state', async () => {
    const { journal } = freshStores();
    await journal.saveStrategy('0.2', v01Text.replace('version: "0.1"', 'version: "0.2"').replace('touch_tolerance_pts: 5', 'touch_tolerance_pts: 8'), 'EXP-001');
    await journal.setState('active_version', '0.2');
    const s = await loadActiveStrategy(journal);
    expect(s.version).toBe('0.2');
    expect(s.touch_tolerance_pts).toBe(8);
    expect((await loadStrategy(journal, '0.1')).touch_tolerance_pts).toBe(5);
  });
  it('an unknown version is an error, not a silent fallback', async () => {
    const { journal } = freshStores();
    await journal.setState('active_version', '9.9');
    await expect(loadActiveStrategy(journal)).rejects.toThrow(/9\.9/);
  });
});
