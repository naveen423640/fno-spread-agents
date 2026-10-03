import type { ProviderEntry } from './config';

// Default provider list, used only when LLM_PROVIDERS is unset. It holds no secrets: each entry names the
// env vars that may hold its key, and a provider with no key present is skipped.
// Base URLs, model names and limits are from memory and UNVERIFIED against each provider's current docs; edit them here
// or override the whole list with LLM_PROVIDERS. costPer1kTokensInr is 0 until real rates are filled in, so the cost log
// shows ₹0 for these calls. Order is the fallback order (free-friendly first).
export const DEFAULT_PROVIDERS: ProviderEntry[] = [
  { name: 'google', baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai', apiKeyEnv: ['GEMINI_API_KEY', 'GOOGLE_API_KEY', 'GOOGLE_GENERATIVE_AI_API_KEY'], model: 'gemini-2.5-flash', requestsPerMinute: 10, dailyTokenQuota: 250_000 },
  { name: 'groq', baseUrl: 'https://api.groq.com/openai/v1', apiKeyEnv: ['GROQ_API_KEY'], model: 'llama-3.3-70b-versatile', requestsPerMinute: 25, dailyTokenQuota: 200_000 },
  { name: 'deepseek', baseUrl: 'https://api.deepseek.com', apiKeyEnv: ['DEEPSEEK_API_KEY'], model: 'deepseek-chat', requestsPerMinute: 30, dailyTokenQuota: 200_000 },
  { name: 'xai', baseUrl: 'https://api.x.ai/v1', apiKeyEnv: ['XAI_API_KEY', 'GROK_API_KEY'], model: 'grok-4', requestsPerMinute: 30, dailyTokenQuota: 100_000 },
  { name: 'anthropic', baseUrl: 'https://api.anthropic.com/v1', apiKeyEnv: ['ANTHROPIC_API_KEY'], model: 'claude-haiku-4-5-20251001', requestsPerMinute: 30, dailyTokenQuota: 100_000 },
];
