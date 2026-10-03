// Applies drizzle/*.sql to the local dev D1 sqlite file(s). Every migration is idempotent (IF NOT EXISTS).
// The dev server does not apply drizzle/ itself; the deploy host applies it from the build output.
// Usage: node scripts/migrate-local.mjs [path/to/file.sqlite]
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

export function applyMigrations(databaseFile, migrationsDir = 'drizzle') {
  const files = readdirSync(migrationsDir).filter((name) => name.endsWith('.sql')).sort();
  const db = new DatabaseSync(databaseFile);
  try {
    for (const name of files) db.exec(readFileSync(join(migrationsDir, name), 'utf8'));
  } finally {
    db.close();
  }
  return files;
}

export function findLocalDatabases(stateDir = join('.wrangler', 'state', 'v3', 'd1')) {
  if (!existsSync(stateDir)) return [];
  const found = [];
  for (const name of readdirSync(stateDir)) {
    const path = join(stateDir, name);
    if (statSync(path).isDirectory()) found.push(...findLocalDatabases(path));
    else if (name.endsWith('.sqlite') && name !== 'metadata.sqlite') found.push(path);
  }
  return found;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const targets = process.argv[2] ? [process.argv[2]] : findLocalDatabases();
  if (!targets.length) {
    console.error('No local D1 database found. Start the dev server once, then run this again.');
    process.exit(1);
  }
  for (const target of targets) console.log(`${target}: applied ${applyMigrations(target).join(', ')}`);
}
