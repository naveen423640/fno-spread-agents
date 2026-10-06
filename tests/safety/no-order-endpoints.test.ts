import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const ALLOWED_FYERS_PATHS = new Set(['', '/api/v3/generate-authcode', '/api/v3/validate-authcode', '/data', '/data/history', '/data/quotes', '/data/options-chain-v3', '/sym_details/NSE_FO']);
// '/sym_details/NSE_FO' is FYERS's public, read-only symbol master (a CSV of contracts and lot sizes) used by the Screener tab.
const ALLOWED_DATA_SUFFIXES = new Set(['quotes', 'history', 'options-chain-v3']);
const DENY_TERMS = /place_?order|create_?order|cancel_?order|modify_?order|exit_?positions|multi_?order|convert_?position|\bgtt\b/i;
const SCAN_DIRS = ['app', 'lib', 'db', 'components', 'hooks', 'scripts'];

function sourceFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((name) => {
    const path = join(directory, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.(ts|tsx|mjs|js)$/.test(name) && !/\.test\.(ts|tsx)$/.test(name) ? [path] : [];
  });
}

export function findViolations(root: string): string[] {
  const violations: string[] = [];
  for (const dir of SCAN_DIRS) {
    let files: string[] = [];
    try { files = sourceFiles(join(root, dir)); } catch { continue; }
    for (const file of files) {
      const text = readFileSync(file, 'utf8');
      for (const match of text.matchAll(/https?:\/\/[a-z0-9.-]*fyers\.in(\/[A-Za-z0-9/_-]*)?/gi)) {
        if (!ALLOWED_FYERS_PATHS.has(match[1] ?? '')) violations.push(`${file}: FYERS path ${match[1]}`);
      }
      for (const match of text.matchAll(/FYERS_DATA_BASE\}\/([A-Za-z0-9_-]+)/g)) {
        if (!ALLOWED_DATA_SUFFIXES.has(match[1])) violations.push(`${file}: FYERS data suffix ${match[1]}`);
      }
      if (DENY_TERMS.test(text)) violations.push(`${file}: order-related term`);
    }
  }
  return violations;
}

describe('no FYERS order endpoints', () => {
  it('the application source references only allowed FYERS auth and data endpoints', () => {
    expect(findViolations(process.cwd())).toEqual([]);
  });

  it('the scanner itself catches an order endpoint (it can fail)', async () => {
    const { mkdtempSync, mkdirSync, writeFileSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const root = mkdtempSync(join(tmpdir(), 'scan-'));
    mkdirSync(join(root, 'lib'));
    writeFileSync(join(root, 'lib', 'bad.ts'), "fetch('https://api-t1.fyers.in/api/v3/orders/sync');");
    writeFileSync(join(root, 'lib', 'bad2.ts'), 'const x = `${FYERS_DATA_BASE}/orders`;');
    writeFileSync(join(root, 'lib', 'bad3.ts'), 'export const place_order = 1;');
    expect(findViolations(root).length).toBe(3);
  });
});
