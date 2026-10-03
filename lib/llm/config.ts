import { z } from 'zod';

import { DEFAULT_PROVIDERS } from './defaults';
import type { ProviderConfig } from './types';

const entrySchema = z.object({
  name: z.string().min(1),
  baseUrl: z.url(),
  apiKeyEnv: z.union([z.string().min(1), z.array(z.string().min(1)).min(1)]),
  model: z.string().min(1),
  requestsPerMinute: z.number().positive(),
  dailyTokenQuota: z.number().positive(),
  costPer1kTokensInr: z.number().nonnegative().optional(),
});

export type ProviderEntry = z.infer<typeof entrySchema>;

function entries(env: Record<string, string | undefined>): ProviderEntry[] {
  const raw = env.LLM_PROVIDERS;
  if (!raw) return DEFAULT_PROVIDERS;
  let json: unknown;
  try { json = JSON.parse(raw); } catch { throw new Error('LLM_PROVIDERS is not valid JSON.'); }
  const parsed = z.array(entrySchema).safeParse(json);
  if (!parsed.success) throw new Error(`LLM_PROVIDERS is invalid: ${parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ')}`);
  return parsed.data;
}

function keyOf(entry: ProviderEntry, env: Record<string, string | undefined>) {
  const names = Array.isArray(entry.apiKeyEnv) ? entry.apiKeyEnv : [entry.apiKeyEnv];
  for (const name of names) if (env[name]) return env[name];
  return undefined;
}

// The env record is injected so provider keys are never read from a global. A provider without a key is skipped.
// With LLM_PROVIDERS unset, the committed default list is used; an explicit LLM_PROVIDERS replaces it.
export function parseProviders(env: Record<string, string | undefined>): ProviderConfig[] {
  const providers: ProviderConfig[] = [];
  for (const entry of entries(env)) {
    const apiKey = keyOf(entry, env);
    if (!apiKey) continue;
    providers.push({ name: entry.name, baseUrl: entry.baseUrl, apiKey, model: entry.model, requestsPerMinute: entry.requestsPerMinute, dailyTokenQuota: entry.dailyTokenQuota, costPer1kTokensInr: entry.costPer1kTokensInr ?? 0 });
  }
  return providers;
}

// For a status view: which configured providers have a key loaded. Never returns a key.
export function describeProviders(env: Record<string, string | undefined>): { name: string; model: string; keyPresent: boolean }[] {
  return entries(env).map((entry) => ({ name: entry.name, model: entry.model, keyPresent: keyOf(entry, env) !== undefined }));
}

// For diagnosing a missing key: the names (never the values) of API-key-style variables that have a value. FYERS variables are left out.
export function keyVariableNames(env: Record<string, string | undefined>): string[] {
  return Object.keys(env).filter((name) => env[name] && /(API_?KEY|_KEY)$/i.test(name) && !/^FYERS_/i.test(name)).sort();
}
