import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

// The agent paper-trades only. Nothing in its package may reach order placement, modification or cancellation, and it may import only the
// LTP engine, the LLM client and a few libraries. This test fails the build if that changes.
const DENY_TERMS = /place_?order|create_?order|cancel_?order|modify_?order|exit_?positions|multi_?order|convert_?position|\bgtt\b|execution-mode|screener\/broker|agent-service/i;
const ALLOWED_IMPORT = /^(\.\/|\.\.\/|@\/lib\/ltp\/|@\/lib\/ltp-agent\/|@\/lib\/llm\/|@\/lib\/agents\/store$|node:|zod$|yaml$)/;

export function violationsIn(path: string, text: string): string[] {
  const out: string[] = [];
  if (DENY_TERMS.test(text)) out.push(`${path}: order-related term`);
  for (const m of text.matchAll(/(?:from|import)\s+['"]([^'"]+)['"]/g)) if (!ALLOWED_IMPORT.test(m[1])) out.push(`${path}: import of ${m[1]}`);
  return out;
}

function sourceFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? sourceFiles(p) : /\.(ts|tsx)$/.test(name) ? [p] : [];
  });
}

describe('agent package never touches order code', () => {
  it('the scanner itself catches an order call and a forbidden import', () => {
    expect(violationsIn('x.ts', "import { placeOrder } from '@/lib/screener/broker/fyers'; place_order()")).toHaveLength(2);
    expect(violationsIn('x.ts', "import { z } from 'zod'; import { analyzeSession } from '@/lib/ltp/analyze';")).toEqual([]);
  });
  it('every file under lib/ltp-agent and the runner script is clean', () => {
    const files = [...sourceFiles('lib/ltp-agent'), ...(existsSync('scripts/ltp-agent.ts') ? ['scripts/ltp-agent.ts'] : [])].filter((f) => !f.endsWith('.test.ts'));
    expect(files.length).toBeGreaterThan(0);
    expect(files.flatMap((f) => violationsIn(f, readFileSync(f, 'utf8')))).toEqual([]);
  });
});
