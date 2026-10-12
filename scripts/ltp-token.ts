// Sends today's FYERS access token to the cloud recorder, so it can keep recording while the Mac is off. Run once each morning before 09:15 IST,
// after you have put the new FYERS_ACCESS_TOKEN in .env.local (the same one the local runner uses). The token is sent as a header-protected PUT and never printed.
const base = process.env.LTP_RECORDER_URL?.replace(/\/$/, '');
const secret = process.env.LTP_RECORDER_SECRET;
const token = process.env.FYERS_ACCESS_TOKEN;
if (!base || !secret) { console.error('Set LTP_RECORDER_URL and LTP_RECORDER_SECRET in .env.local.'); process.exit(1); }
if (!token) { console.error('Set today\'s FYERS_ACCESS_TOKEN in .env.local first.'); process.exit(1); }
const response = await fetch(`${base}/token`, { method: 'PUT', headers: { Authorization: `Bearer ${secret}`, 'content-type': 'application/json' }, body: JSON.stringify({ token }) });
if (!response.ok) { console.error(`The recorder answered ${response.status}${response.status === 401 ? ': the secret in .env.local is not the one set on the Worker.' : '.'}`); process.exit(1); }
console.log('Token saved on the cloud recorder. Check it with: npm run ltp:health');

export {};
