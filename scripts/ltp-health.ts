// Asks the cloud recorder how it is doing: last snapshot per index, today's counts and gaps, and whether today's token is in (never the token itself).
// Needs LTP_RECORDER_URL and LTP_RECORDER_SECRET in .env.local; the secret is sent as a header and never printed.
const base = process.env.LTP_RECORDER_URL?.replace(/\/$/, '');
const secret = process.env.LTP_RECORDER_SECRET;
if (!base || !secret) { console.error('Set LTP_RECORDER_URL and LTP_RECORDER_SECRET in .env.local.'); process.exit(1); }
const response = await fetch(`${base}/health`, { headers: { Authorization: `Bearer ${secret}` } });
const body = (await response.json().catch(() => null)) as Record<string, unknown> | null;
if (!response.ok) { console.error(`The recorder answered ${response.status}${response.status === 401 ? ': the secret in .env.local is not the one set on the Worker.' : '.'}`); process.exit(1); }
const ts = (v: unknown) => (typeof v === 'number' ? new Date(v * 1000).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }) : 'never');
const token = (body?.token ?? {}) as { present?: boolean; savedAt?: number | null; clientId?: string | null };
console.log(`badge ${body?.badge} | recording now: ${body?.recordingNow} | last snapshot: ${ts(body?.lastSuccessTs)} IST | gaps today: ${body?.gapsToday}`);
console.log(`token: ${token.present ? `present, saved ${ts(token.savedAt)} IST, FYERS app ${token.clientId ?? 'from the Worker config'}` : 'NOT set'}`);
console.log('snapshots today:', JSON.stringify(body?.snapshotsToday));

export {};
