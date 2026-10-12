// The daily FYERS token of the cloud recorder: how it is checked and stored. Shared by the recorder Worker (PUT /token) and by the cloud copy of
// the app, which writes straight into the same database because one Worker cannot call another through workers.dev.
import type { D1Like } from '@/lib/agents/store';

export const MAX_TOKEN_LENGTH = 4000;

export type TokenInput = { token: string; clientId: string | null };

// The FYERS app id is optional: tokens only work with the app that issued them, and the cloud app and the Mac may use different FYERS apps.
export function parseTokenInput(token: unknown, clientId: unknown): { ok: true; value: TokenInput } | { ok: false; error: string } {
  const trimmed = typeof token === 'string' ? token.trim() : '';
  if (!trimmed || trimmed.length > MAX_TOKEN_LENGTH) return { ok: false, error: 'Send {"token": "<today\'s FYERS access token>"}.' };
  if (clientId !== undefined && clientId !== null && (typeof clientId !== 'string' || !/^[A-Za-z0-9-]{1,100}$/.test(clientId))) return { ok: false, error: 'clientId must be the FYERS app id (letters, digits and dashes).' };
  return { ok: true, value: { token: trimmed, clientId: typeof clientId === 'string' ? clientId : null } };
}

export async function saveRecorderToken(db: D1Like, input: TokenInput, nowTs: number): Promise<void> {
  await db.prepare('INSERT INTO recorder_token (id, token, saved_at, client_id) VALUES (1, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET token = excluded.token, saved_at = excluded.saved_at, client_id = excluded.client_id').bind(input.token, nowTs, input.clientId).run();
}
