export type ProviderConfig = {
  name: string;
  baseUrl: string;
  apiKey: string;
  model: string;
  requestsPerMinute: number;
  dailyTokenQuota: number;
  costPer1kTokensInr: number;
};

export type LlmMessage = { role: 'system' | 'user' | 'assistant'; content: string };
export type LlmRequest = { role: string; runId: string; messages: LlmMessage[]; maxTokens: number };

export type LlmError = 'QUOTA_EXHAUSTED' | 'RATE_LIMITED' | 'PROVIDER_ERROR' | 'REPLAY_MISS';
export type LlmResult =
  | { ok: true; text: string; provider: string; model: string; tokensIn: number; tokensOut: number; finishReason?: string }
  | { ok: false; error: LlmError; detail: string };

export type LlmClient = { complete(request: LlmRequest): Promise<LlmResult> };

export type CallLogEntry = {
  runId: string;
  role: string;
  provider: string;
  model: string;
  promptHash: string;
  tokensIn: number;
  tokensOut: number;
  costInr: number;
  latencyMs: number;
  status: string;
};
export type CallLogger = (entry: CallLogEntry) => Promise<void>;
