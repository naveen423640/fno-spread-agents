import { describe, expect, it } from 'vitest';

import { blockedInCloud, cloudGuard, isCloudMode, resetAccessCache } from '@/lib/cloud/access';

const TEAM = 'fnocalculator.cloudflareaccess.com';
const AUD = 'aud-tag-123';
const env = { CLOUD_MODE: 'true', CF_ACCESS_TEAM_DOMAIN: TEAM, CF_ACCESS_AUD: AUD };
const NOW = 1_800_000_000;

const b64 = (data: string | ArrayBuffer) => Buffer.from(typeof data === 'string' ? data : new Uint8Array(data)).toString('base64url');
async function keypair() {
  const pair = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
  const jwk = (await crypto.subtle.exportKey('jwk', pair.publicKey)) as JsonWebKey;
  return { privateKey: pair.privateKey, jwk };
}
async function jwt(privateKey: CryptoKey, over: { kid?: string; alg?: string; claims?: Record<string, unknown> } = {}) {
  const header = { alg: over.alg ?? 'RS256', kid: over.kid ?? 'key-1', typ: 'JWT' };
  const claims = { aud: [AUD], iss: `https://${TEAM}`, exp: NOW + 3600, nbf: NOW - 60, email: 'me@example.com', ...over.claims };
  const signed = `${b64(JSON.stringify(header))}.${b64(JSON.stringify(claims))}`;
  const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', privateKey, new TextEncoder().encode(signed));
  return `${signed}.${b64(signature)}`;
}
const jwks = (jwk: JsonWebKey, kid = 'key-1') => {
  const calls: string[] = [];
  const fetchImpl = (async (url: string) => { calls.push(url); return Response.json({ keys: [{ ...jwk, kid, alg: 'RS256', use: 'sig' }] }); }) as unknown as typeof fetch;
  return { calls, fetchImpl };
};
const req = (path = '/', headers: Record<string, string> = {}, method = 'GET') => new Request(`https://app.example${path}`, { method, headers });
const guard = (request: Request, e: Record<string, string | undefined>, fetchImpl: typeof fetch) => cloudGuard(request, e, { fetchImpl, now: () => NOW * 1000 });

describe('the cloud copy only answers someone Cloudflare Access has let in', () => {
  it('on the Mac (CLOUD_MODE not set) it does nothing', async () => {
    resetAccessCache();
    expect(await cloudGuard(req(), {}, { fetchImpl: (async () => { throw new Error('no network'); }) as never })).toBeNull();
  });
  it('in the cloud with no Access settings it refuses everything rather than run open', async () => {
    resetAccessCache();
    const { privateKey, jwk } = await keypair();
    const token = await jwt(privateKey);
    for (const e of [{ CLOUD_MODE: 'true' }, { CLOUD_MODE: 'true', CF_ACCESS_TEAM_DOMAIN: TEAM }, { CLOUD_MODE: 'true', CF_ACCESS_AUD: AUD }]) {
      const res = await guard(req('/', { 'cf-access-jwt-assertion': token }), e, jwks(jwk).fetchImpl);
      expect(res?.status).toBe(503);
    }
  });
  it('a request without a token is refused with 401', async () => {
    resetAccessCache();
    const { jwk } = await keypair();
    expect((await guard(req(), env, jwks(jwk).fetchImpl))?.status).toBe(401);
  });
  it('a valid token, in the header or in the CF_Authorization cookie, lets the request through', async () => {
    resetAccessCache();
    const { privateKey, jwk } = await keypair();
    const token = await jwt(privateKey);
    const { fetchImpl } = jwks(jwk);
    expect(await guard(req('/', { 'cf-access-jwt-assertion': token }), env, fetchImpl)).toBeNull();
    expect(await guard(req('/', { cookie: `a=b; CF_Authorization=${token}` }), env, fetchImpl)).toBeNull();
  });
  it('fetches the signing keys from the team domain once and reuses them', async () => {
    resetAccessCache();
    const { privateKey, jwk } = await keypair();
    const token = await jwt(privateKey);
    const { calls, fetchImpl } = jwks(jwk);
    await guard(req('/', { 'cf-access-jwt-assertion': token }), env, fetchImpl);
    await guard(req('/', { 'cf-access-jwt-assertion': token }), env, fetchImpl);
    expect(calls).toEqual([`https://${TEAM}/cdn-cgi/access/certs`]);
  });
  it('refuses a token that is expired, for another application, from another issuer, or not yet valid', async () => {
    resetAccessCache();
    const { privateKey, jwk } = await keypair();
    const { fetchImpl } = jwks(jwk);
    for (const claims of [{ exp: NOW - 1 }, { aud: ['someone-else'] }, { iss: 'https://evil.cloudflareaccess.com' }, { nbf: NOW + 600 }]) {
      const token = await jwt(privateKey, { claims });
      expect((await guard(req('/', { 'cf-access-jwt-assertion': token }), env, fetchImpl))?.status).toBe(401);
    }
  });
  it('refuses a token signed by a different key, with an unknown key id, or with alg none', async () => {
    resetAccessCache();
    const real = await keypair();
    const other = await keypair();
    const { fetchImpl } = jwks(real.jwk);
    expect((await guard(req('/', { 'cf-access-jwt-assertion': await jwt(other.privateKey) }), env, fetchImpl))?.status).toBe(401);
    expect((await guard(req('/', { 'cf-access-jwt-assertion': await jwt(real.privateKey, { kid: 'other-kid' }) }), env, fetchImpl))?.status).toBe(401);
    expect((await guard(req('/', { 'cf-access-jwt-assertion': await jwt(real.privateKey, { alg: 'none' }) }), env, fetchImpl))?.status).toBe(401);
    expect((await guard(req('/', { 'cf-access-jwt-assertion': 'not.a.jwt' }), env, fetchImpl))?.status).toBe(401);
  });
  it('if the keys cannot be fetched it refuses rather than let anyone in', async () => {
    resetAccessCache();
    const { privateKey } = await keypair();
    const down = (async () => { throw new Error('offline'); }) as unknown as typeof fetch;
    expect((await guard(req('/', { 'cf-access-jwt-assertion': await jwt(privateKey) }), env, down))?.status).toBe(401);
  });
});

describe('what the cloud copy never does', () => {
  it('blocks recording, the agent runner and pulling, but allows reading the agent and sending the token', () => {
    expect(blockedInCloud('POST', '/api/ltp/record')).toBe(true);
    expect(blockedInCloud('POST', '/api/ltp/agent/step')).toBe(true);
    expect(blockedInCloud('POST', '/api/ltp/agent/review')).toBe(true);
    expect(blockedInCloud('PUT', '/api/ltp/agent/anything')).toBe(true);
    expect(blockedInCloud('POST', '/api/ltp/cloud-pull')).toBe(true);
    expect(blockedInCloud('GET', '/api/ltp/agent/state')).toBe(false);
    expect(blockedInCloud('GET', '/api/ltp/state')).toBe(false);
    expect(blockedInCloud('GET', '/api/ltp/record')).toBe(false);
    expect(blockedInCloud('POST', '/api/ltp/cloud-token')).toBe(false);
  });
  it('a blocked request answers 403 after the login check passes', async () => {
    resetAccessCache();
    const { privateKey, jwk } = await keypair();
    const token = await jwt(privateKey);
    const res = await guard(req('/api/ltp/agent/step', { 'cf-access-jwt-assertion': token }, 'POST'), env, jwks(jwk).fetchImpl);
    expect(res?.status).toBe(403);
  });
});

describe('cloud mode', () => {
  it('is on only when CLOUD_MODE is exactly "true"', () => {
    expect(isCloudMode({ CLOUD_MODE: 'true' })).toBe(true);
    for (const v of [undefined, '', 'false', 'TRUE', '1']) expect(isCloudMode({ CLOUD_MODE: v })).toBe(false);
  });
});
