// The cloud copy of the app sits behind Cloudflare Access (email one-time code). Access puts a signed token on every request it lets through;
// this checks it, so the Worker stays closed even if Access is switched off or misconfigured. Fails closed: with CLOUD_MODE on and no Access
// settings, or keys that cannot be fetched, every request is refused. On the Mac CLOUD_MODE is not set and none of this runs.
export type CloudEnv = { CLOUD_MODE?: string; CF_ACCESS_TEAM_DOMAIN?: string; CF_ACCESS_AUD?: string };
type Deps = { fetchImpl?: typeof fetch; now?: () => number };
type Jwks = { keys: (JsonWebKey & { kid?: string })[] };

const KEYS_TTL_MS = 10 * 60 * 1000;
let cache: { team: string; fetchedAt: number; keys: Jwks['keys'] } | null = null;
export const resetAccessCache = () => { cache = null; };

const text = (status: number, message: string) => new Response(message, { status, headers: { 'Cache-Control': 'no-store', 'Content-Type': 'text/plain; charset=utf-8' } });
const decode = (part: string) => JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(part.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0)))) as Record<string, unknown>;

async function signingKeys(team: string, deps: Deps) {
  const now = (deps.now ?? Date.now)();
  if (cache && cache.team === team && now - cache.fetchedAt < KEYS_TTL_MS) return cache.keys;
  const response = await (deps.fetchImpl ?? fetch)(`https://${team}/cdn-cgi/access/certs`);
  if (!response.ok) throw new Error('keys unavailable');
  const keys = ((await response.json()) as Jwks).keys;
  cache = { team, fetchedAt: now, keys };
  return keys;
}

async function validToken(token: string, team: string, aud: string, deps: Deps): Promise<boolean> {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return false;
    const header = decode(parts[0]);
    if (header.alg !== 'RS256' || typeof header.kid !== 'string') return false;
    const jwk = (await signingKeys(team, deps)).find((k) => k.kid === header.kid);
    if (!jwk) return false;
    const key = await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
    const signature = Uint8Array.from(atob(parts[2].replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
    if (!(await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, signature, new TextEncoder().encode(`${parts[0]}.${parts[1]}`)))) return false;
    const claims = decode(parts[1]);
    const nowSec = Math.floor((deps.now ?? Date.now)() / 1000);
    const audience = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
    return audience.includes(aud) && claims.iss === `https://${team}` && typeof claims.exp === 'number' && claims.exp > nowSec && (typeof claims.nbf !== 'number' || claims.nbf <= nowSec);
  } catch { return false; }
}

// The cloud copy only reads. Recording, the agent runner and its experiments run on the Mac (or in the recorder Worker); pulling is pointless here,
// since the app already reads the recorder's database. Reading the agent, and sending the FYERS token on to the recorder, stay allowed.
export function blockedInCloud(method: string, pathname: string): boolean {
  const mutates = method !== 'GET' && method !== 'HEAD';
  if (pathname === '/api/ltp/record') return mutates;
  if (pathname === '/api/ltp/cloud-pull') return true;
  if (pathname.startsWith('/api/ltp/agent/')) return mutates;
  return false;
}

// Null when the request may go on to the app, else the response to send.
export async function cloudGuard(request: Request, env: CloudEnv, deps: Deps = {}): Promise<Response | null> {
  if (env.CLOUD_MODE !== 'true') return null;
  if (!env.CF_ACCESS_TEAM_DOMAIN || !env.CF_ACCESS_AUD) return text(503, 'This copy is closed: Cloudflare Access is not configured.');
  const cookie = (request.headers.get('cookie') ?? '').split(';').map((p) => p.trim()).find((p) => p.startsWith('CF_Authorization='));
  const token = request.headers.get('cf-access-jwt-assertion') ?? cookie?.slice('CF_Authorization='.length);
  if (!token || !(await validToken(token, env.CF_ACCESS_TEAM_DOMAIN, env.CF_ACCESS_AUD, deps))) return text(401, 'Sign in through Cloudflare Access.');
  if (blockedInCloud(request.method, new URL(request.url).pathname)) return text(403, 'This is not available on the cloud copy.');
  return null;
}

// True in the cloud copy (the tablet's), false on the Mac. The tabs hide what only works on the Mac, such as recording and pausing the agent.
export const isCloudMode = (env: CloudEnv): boolean => env.CLOUD_MODE === 'true';
