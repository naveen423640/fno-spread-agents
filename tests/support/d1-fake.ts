import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

type Bindable = string | number | null;

// A D1-shaped adapter over node:sqlite so store code can be tested without a real D1 binding.
export function createD1Fake(migrationFiles: string[]) {
  const sqlite = new DatabaseSync(':memory:');
  for (const file of migrationFiles) sqlite.exec(readFileSync(file, 'utf8'));
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

export type D1Fake = ReturnType<typeof createD1Fake>;
