function cookie(name: string, value: string, maxAge: number) {
  return `${name}=${encodeURIComponent(value)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAge}`;
}

export async function GET(request: Request) {
  const clientId = process.env.FYERS_CLIENT_ID;
  const redirectUri = process.env.FYERS_REDIRECT_URI ?? new URL('/api/fyers/callback', request.url).toString();

  if (!clientId) {
    return Response.json({ error: 'FYERS_CLIENT_ID is not configured for this deployment.' }, { status: 500 });
  }

  const state = crypto.randomUUID();
  const loginUrl = new URL('https://api-t1.fyers.in/api/v3/generate-authcode');
  loginUrl.searchParams.set('client_id', clientId);
  loginUrl.searchParams.set('redirect_uri', redirectUri);
  loginUrl.searchParams.set('response_type', 'code');
  loginUrl.searchParams.set('state', state);

  const headers = new Headers({ Location: loginUrl.toString() });
  headers.append('Set-Cookie', cookie('fyers_oauth_state', state, 600));
  return new Response(null, { status: 302, headers });
}
