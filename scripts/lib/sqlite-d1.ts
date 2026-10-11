// A D1-shaped wrapper over node:sqlite so the CLI can use the same cache code as the app, outside Cloudflare.
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

import type { D1Like } from '../../lib/agents/store';

type Bindable = string | number | null;

export function createSqliteD1(path: string, migrations: string[] = []): D1Like {
  const sqlite = new DatabaseSync(path);
  for (const file of migrations) sqlite.exec(readFileSync(file, 'utf8'));
  return {
    prepare(sql: string) {
      const statement = sqlite.prepare(sql);
      const build = (values: Bindable[]) => ({
        async run() { statement.run(...values); return { success: true }; },
        async first<T = Record<string, unknown>>() { return (statement.get(...values) as T | undefined) ?? null; },
        async all<T = Record<string, unknown>>() { return { results: statement.all(...values) as T[] }; },
      });
      return { ...build([]), bind: (...values: Bindable[]) => build(values) };
    },
  };
}
