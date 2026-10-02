import { describe, expect, it } from 'vitest';

import { readExecutionSettings } from '@/lib/execution-mode';

describe('readExecutionSettings', () => {
  it('defaults to paper with live execution off when nothing is set', () => {
    expect(readExecutionSettings({})).toEqual({ executionMode: 'paper', liveExecutionEnabled: false });
  });

  it('accepts the explicit safe values', () => {
    expect(readExecutionSettings({ EXECUTION_MODE: 'paper', LIVE_EXECUTION_ENABLED: 'false' }).executionMode).toBe('paper');
  });

  it('refuses any other mode, including near misses', () => {
    for (const mode of ['live', 'Paper', ' paper', 'paper ', '', 'real']) {
      expect(() => readExecutionSettings({ EXECUTION_MODE: mode }), mode).toThrow(/paper/i);
    }
  });

  it('refuses any live-execution value other than the exact string false', () => {
    for (const value of ['true', 'TRUE', 'False', '0', '1', 'yes', ' false', '']) {
      expect(() => readExecutionSettings({ LIVE_EXECUTION_ENABLED: value }), value).toThrow(/LIVE_EXECUTION_ENABLED/);
    }
  });
});
