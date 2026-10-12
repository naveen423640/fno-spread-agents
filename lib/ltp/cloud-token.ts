// Sends the FYERS access token the app is logged in with to the cloud recorder (cloud-recorder/), so it can keep recording while the Mac is off.
// Server-side only: the token and the recorder secret never reach the browser, and neither is ever put in a message.
export type CloudTokenResult = { ok: true } | { ok: false; status: number; error: string };

export async function sendTokenToCloud(deps: { accessToken: string | undefined; url: string | undefined; secret: string | undefined; fetchImpl?: typeof fetch }): Promise<CloudTokenResult> {
  if (!deps.accessToken) return { ok: false, status: 401, error: 'Connect FYERS first, then send the token.' };
  if (!deps.url || !deps.secret) return { ok: false, status: 503, error: 'Set LTP_RECORDER_URL and LTP_RECORDER_SECRET in .env.local and restart the app.' };
  try {
    const response = await (deps.fetchImpl ?? fetch)(`${deps.url.replace(/\/$/, '')}/token`, {
      method: 'PUT', headers: { Authorization: `Bearer ${deps.secret}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ token: deps.accessToken }),
    });
    if (response.ok) return { ok: true };
    return { ok: false, status: 502, error: `The cloud recorder answered ${response.status}${response.status === 401 ? ': LTP_RECORDER_SECRET is not the secret set on the Worker.' : '.'}` };
  } catch {
    return { ok: false, status: 502, error: 'Could not reach the cloud recorder.' };
  }
}
