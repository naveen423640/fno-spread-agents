import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { findViolations } from './no-order-endpoints.test';

function sourceFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((name) => {
    const path = join(directory, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.(ts|tsx)$/.test(name) && !/\.test\.(ts|tsx)$/.test(name) ? [path] : [];
  });
}

const AGENT_FORBIDDEN: [string, RegExp][] = [
  ['process.env', /process\.env/],
  ['cloudflare:workers', /cloudflare:workers/],
  ['FYERS_ variable', /FYERS_/],
  ['access token', /access_?token/i],
  ['FYERS module import', /from\s+['"](?:@\/lib\/|\.\.?\/)+(?:fyers|backtest|agent-inputs|agent-service)/],
  ['app import', /from\s+['"]@\/app/],
  ['database import', /from\s+['"]@\/db/],
];

describe('agent code isolation', () => {
  it('lib/agents never reaches env, the FYERS token, FYERS modules or the database binding', () => {
    const files = sourceFiles(join(process.cwd(), 'lib', 'agents'));
    expect(files.length).toBeGreaterThan(0);
    const violations = files.flatMap((file) => {
      const text = readFileSync(file, 'utf8');
      return AGENT_FORBIDDEN.filter(([, pattern]) => pattern.test(text)).map(([label]) => `${file}: ${label}`);
    });
    expect(violations).toEqual([]);
  });

  it('lib/llm has no FYERS reference and reads no global env', () => {
    const files = sourceFiles(join(process.cwd(), 'lib', 'llm'));
    expect(files.length).toBeGreaterThan(0);
    const violations = files.flatMap((file) => {
      const text = readFileSync(file, 'utf8');
      return [/FYERS/i, /process\.env/, /@\/lib\/fyers/].filter((pattern) => pattern.test(text)).map((pattern) => `${file}: ${pattern}`);
    });
    expect(violations).toEqual([]);
  });

  it('the order-endpoint scan still passes with the agent directories present', () => {
    expect(findViolations(process.cwd())).toEqual([]);
  });
});
