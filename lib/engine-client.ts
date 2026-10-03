export type EngineUniverse = { date: string; entries: { ticker: string; lotSize: number | null }[] };

const DEFAULT_BASE = 'http://127.0.0.1:8765';

// Server-side only. Any failure (engine down, slow, wrong shape) returns null so the caller can fall back visibly.
export async function fetchEngineUniverse(day: string, fetchImpl: typeof fetch = fetch, baseUrl: string = process.env.FNO_ENGINE_URL ?? DEFAULT_BASE, timeoutMs = 2000): Promise<EngineUniverse | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(`${baseUrl}/universe/${encodeURIComponent(day)}`, { cache: 'no-store', signal: controller.signal });
    if (!response.ok) return null;
    const body = await response.json() as { date?: unknown; entries?: unknown };
    if (typeof body.date !== 'string' || !Array.isArray(body.entries)) return null;
    const entries = body.entries.filter((e): e is { ticker: string; lotSize: number | null } => typeof (e as { ticker?: unknown }).ticker === 'string');
    return { date: body.date, entries };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
