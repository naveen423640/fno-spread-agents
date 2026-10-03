// A cross-site page can send a "simple" request (text/plain body) without a preflight, so the route
// requires an application/json body and rejects cross-site browser fetches. This is not authentication.
export function checkRequestOrigin(headers: Headers): string | null {
  if (!/^application\/json\b/i.test(headers.get('content-type') ?? '')) return 'Send the request as application/json.';
  const site = headers.get('sec-fetch-site');
  if (site && site !== 'same-origin' && site !== 'none') return 'Cross-site requests are not allowed.';
  const origin = headers.get('origin');
  const host = headers.get('host');
  if (origin && host) {
    let originHost = '';
    try { originHost = new URL(origin).host; } catch { return 'Cross-site requests are not allowed.'; }
    if (originHost !== host) return 'Cross-site requests are not allowed.';
  }
  return null;
}
