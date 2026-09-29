import { env } from 'cloudflare:workers';
import { drizzle } from 'drizzle-orm/d1';

import * as schema from './schema';

export function getDatabaseBinding() {
  if (!env.DB) throw new Error('The DB D1 binding is not configured.');
  return env.DB;
}

export function getDb() {
  return drizzle(getDatabaseBinding(), { schema });
}
