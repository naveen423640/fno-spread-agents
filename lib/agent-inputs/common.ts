import type { AnalystInput } from '../agents/orchestrator';
import type { AnalystRole } from '../agents/prompts';
import type { loadOptionChain, loadQuote } from '../fyers-analyst-tools';
import type { fetchDailyCandles } from '../regime/fyers-daily';

export type Credentials = { clientId: string; accessToken: string };
export type GatherArgs = { symbol: string; asOf: string; now: Date; credentials: Credentials | null };
export type GatherDeps = {
  fetchDaily: typeof fetchDailyCandles;
  loadQuote: typeof loadQuote;
  loadOptionChain: typeof loadOptionChain;
  fetchImpl: typeof fetch;
};

export function unavailable(role: AnalystRole, asOf: string, reason: string): AnalystInput {
  return { role, asOf, available: false, reason, sources: [], payload: {} };
}

// Error text from upstream calls may echo request details; never let the token through.
export function safeReason(error: unknown, credentials: Credentials | null): string {
  const text = error instanceof Error ? error.message : String(error);
  return credentials ? text.split(credentials.accessToken).join('[redacted]') : text;
}
