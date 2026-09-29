function cookieValue(request: Request, name: string) {
  const cookies = request.headers.get('cookie') ?? '';
  const prefix = `${name}=`;
  const match = cookies.split(';').map((part) => part.trim()).find((part) => part.startsWith(prefix));
  return match ? decodeURIComponent(match.slice(prefix.length)) : undefined;
}

function cookie(name: string, value: string, maxAge: number) {
  return `${name}=${encodeURIComponent(value)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAge}`;
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const authCode = url.searchParams.get('auth_code');
  const state = url.searchParams.get('state');
  const expectedState = cookieValue(request, 'fyers_oauth_state');
  const clientId = process.env.FYERS_CLIENT_ID;
  const secretKey = process.env.FYERS_SECRET_KEY;

  if (!authCode || !state || !expectedState || state !== expectedState) {
    return Response.json({ error: 'FYERS login state was missing or invalid. Start again from Connect FYERS.' }, { status: 400 });
  }

  if (!clientId || !secretKey) {
    return Response.json({ error: 'FYERS_CLIENT_ID and FYERS_SECRET_KEY are not configured for this deployment.' }, { status: 500 });
  }

  const hashInput = new TextEncoder().encode(`${clientId}:${secretKey}`);
  const digest = await crypto.subtle.digest('SHA-256', hashInput);
  const appIdHash = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');

  const tokenResponse = await fetch('https://api-t1.fyers.in/api/v3/validate-authcode', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ grant_type: 'authorization_code', appIdHash, code: authCode }),
  });
  const tokenPayload = await tokenResponse.json() as { s?: string; code?: number; message?: string; access_token?: string };

  if (!tokenResponse.ok || tokenPayload.s !== 'ok' || !tokenPayload.access_token) {
    return Response.json({ error: tokenPayload.message ?? `FYERS token exchange failed (${tokenResponse.status}).` }, { status: 502 });
  }

  const destination = new URL('/', request.url);
  const headers = new Headers({ Location: destination.toString() });
  headers.append('Set-Cookie', cookie('fyers_access_token', tokenPayload.access_token, 72_000));
  headers.append('Set-Cookie', cookie('fyers_oauth_state', '', 0));
  return new Response(null, { status: 302, headers });
}
