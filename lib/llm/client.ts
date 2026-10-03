import type { Limiter } from './limits';
import type { CallLogger, LlmClient, LlmError, LlmMessage, LlmResult, ProviderConfig } from './types';

export async function hashPrompt(messages: LlmMessage[]): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(messages));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

const redact = (text: string, key: string) => (key ? text.split(key).join('[redacted]') : text);

export function createLlmClient(options: { providers: ProviderConfig[]; limiter: Limiter; log: CallLogger; fetchImpl?: typeof fetch; now?: () => number; timeoutMs?: number }): LlmClient {
  const { providers, limiter, log } = options;
  const fetchImpl = options.fetchImpl ?? fetch;
  const now = options.now ?? Date.now;
  const timeoutMs = options.timeoutMs ?? 30_000;

  return {
    async complete(request) {
      const promptHash = await hashPrompt(request.messages);
      let quotaHit = false;
      let rateHit = false;
      let lastDetail = providers.length ? 'every provider failed' : 'no LLM provider configured';

      for (const provider of providers) {
        const gate = limiter.tryAcquire(provider);
        if (gate === 'QUOTA_EXHAUSTED') { quotaHit = true; continue; }
        if (gate === 'RATE_LIMITED') { rateHit = true; continue; }

        const started = now();
        const entry = { runId: request.runId, role: request.role, provider: provider.name, model: provider.model, promptHash, tokensIn: 0, tokensOut: 0, costInr: 0 };
        try {
          const response = await fetchImpl(`${provider.baseUrl}/chat/completions`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${provider.apiKey}` },
            body: JSON.stringify({ model: provider.model, messages: request.messages, max_tokens: request.maxTokens }),
            signal: AbortSignal.timeout(timeoutMs),
          });
          if (!response.ok) {
            lastDetail = `${provider.name} answered HTTP ${response.status}`;
            const head = redact((await response.text().catch(() => '')).replace(/\s+/g, ' ').slice(0, 160), provider.apiKey);
            await log({ ...entry, latencyMs: now() - started, status: head ? `http_${response.status} ${head}` : `http_${response.status}` });
            continue;
          }
          const body = await response.json() as { choices?: { message?: { content?: unknown }; finish_reason?: unknown }[]; usage?: { prompt_tokens?: number; completion_tokens?: number } };
          const text = body.choices?.[0]?.message?.content;
          if (typeof text !== 'string' || !text) {
            lastDetail = `${provider.name} returned no content`;
            await log({ ...entry, latencyMs: now() - started, status: 'empty' });
            continue;
          }
          const tokensIn = body.usage?.prompt_tokens ?? 0;
          const tokensOut = body.usage?.completion_tokens ?? 0;
          limiter.recordTokens(provider.name, tokensIn + tokensOut);
          const costInr = ((tokensIn + tokensOut) / 1000) * provider.costPer1kTokensInr;
          await log({ ...entry, tokensIn, tokensOut, costInr, latencyMs: now() - started, status: 'ok' });
          const finish = body.choices?.[0]?.finish_reason;
          return { ok: true, text, provider: provider.name, model: provider.model, tokensIn, tokensOut, finishReason: typeof finish === 'string' ? finish : undefined };
        } catch (error) {
          lastDetail = redact(`${provider.name} failed: ${error instanceof Error ? error.message : String(error)}`, provider.apiKey);
          await log({ ...entry, latencyMs: now() - started, status: 'network_error' });
        }
      }

      const error: LlmError = quotaHit ? 'QUOTA_EXHAUSTED' : rateHit ? 'RATE_LIMITED' : 'PROVIDER_ERROR';
      const detail = quotaHit ? 'daily token quota exhausted on a provider' : rateHit ? 'rate limited on every available provider' : lastDetail;
      return { ok: false, error, detail } satisfies LlmResult;
    },
  };
}

export function createReplayClient(fixtures: Record<string, string>, log: CallLogger): LlmClient {
  return {
    async complete(request) {
      const promptHash = await hashPrompt(request.messages);
      const text = fixtures[promptHash];
      if (text === undefined) return { ok: false, error: 'REPLAY_MISS', detail: `no recorded reply for prompt ${promptHash.slice(0, 12)}` };
      await log({ runId: request.runId, role: request.role, provider: 'replay', model: 'replay', promptHash, tokensIn: 0, tokensOut: 0, costInr: 0, latencyMs: 0, status: 'ok' });
      return { ok: true, text, provider: 'replay', model: 'replay', tokensIn: 0, tokensOut: 0 };
    },
  };
}
