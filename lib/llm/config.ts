import { z } from 'zod';

import type { ProviderConfig } from './types';

const entrySchema = z.object({
  name: z.string().min(1),
  baseUrl: z.url(),
  apiKeyEnv: z.string().min(1),
  model: z.string().min(1),
  requestsPerMinute: z.number().positive(),
  dailyTokenQuota: z.number().positive(),
  costPer1kTokensInr: z.number().nonnegative().optional(),
});

// The env record is injected so provider keys are never read from a global. No provider is hardcoded.
export function parseProviders(env: Record<string, string | undefined>): ProviderConfig[] {
  const raw = env.LLM_PROVIDERS;
  if (!raw) return [];
  let json: unknown;
  try { json = JSON.parse(raw); } catch { throw new Error('LLM_PROVIDERS is not valid JSON.'); }
  const parsed = z.array(entrySchema).safeParse(json);
  if (!parsed.success) throw new Error(`LLM_PROVIDERS is invalid: ${parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ')}`);
  const providers: ProviderConfig[] = [];
  for (const entry of parsed.data) {
    const apiKey = env[entry.apiKeyEnv];
    if (!apiKey) continue;
    providers.push({ name: entry.name, baseUrl: entry.baseUrl, apiKey, model: entry.model, requestsPerMinute: entry.requestsPerMinute, dailyTokenQuota: entry.dailyTokenQuota, costPer1kTokensInr: entry.costPer1kTokensInr ?? 0 });
  }
  return providers;
}
