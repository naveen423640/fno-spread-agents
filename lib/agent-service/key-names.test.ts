import { describe, expect, it } from 'vitest';

import { keyVariableNames } from './key-names';

describe('keyVariableNames', () => {
  it('lists only the names of API-key-style variables that have a value, never the values', () => {
    const names = keyVariableNames({ GEMINI_API_KEY: 'secret-1', DEEPSEEK_KEY: 'secret-2', EMPTY_API_KEY: '', PATH: '/usr/bin', FYERS_SECRET_KEY: 'secret-3', OPENAI_API_KEY: 'secret-4' });
    expect(names).toEqual(['DEEPSEEK_KEY', 'GEMINI_API_KEY', 'OPENAI_API_KEY']);
    expect(JSON.stringify(names)).not.toMatch(/secret/);
  });
});
