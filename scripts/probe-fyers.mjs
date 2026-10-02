// Usage (PowerShell, you set the variables yourself in that session):
//   $env:FYERS_CLIENT_ID="..."; $env:FYERS_ACCESS_TOKEN="..."; node scripts/probe-fyers.mjs <expired-option-symbol>
const clientId = process.env.FYERS_CLIENT_ID;
const token = process.env.FYERS_ACCESS_TOKEN;
if (!clientId || !token) throw new Error('Set FYERS_CLIENT_ID and FYERS_ACCESS_TOKEN in this shell first.');
const headers = { Authorization: `${clientId}:${token}`, Accept: 'application/json' };
const base = 'https://api-t1.fyers.in/data';
const iso = (offsetDays) => new Date(Date.now() + offsetDays * 86_400_000).toISOString().slice(0, 10);

async function history(symbol, resolution, fromOffset, toOffset) {
  const url = new URL(`${base}/history`);
  for (const [k, v] of Object.entries({ symbol, resolution, date_format: '1', range_from: iso(fromOffset), range_to: iso(toOffset), cont_flag: '1' })) url.searchParams.set(k, v);
  const res = await fetch(url, { headers });
  const body = await res.json().catch(() => ({}));
  return { status: res.status, s: body.s, code: body.code, message: body.message, candles: Array.isArray(body.candles) ? body.candles.length : null, first: body.candles?.[0]?.[0], last: body.candles?.at(-1)?.[0] };
}

const out = {};
for (const resolution of ['D', '1D']) out[`daily_${resolution}_90d`] = await history('NSE:SBIN-EQ', resolution, -90, -1);
for (const days of [360, 365, 366, 400, 730]) out[`daily_range_${days}d`] = await history('NSE:SBIN-EQ', 'D', -days, -1);
out.futures_daily = await history('NSE:SBIN26OCTFUT', 'D', -60, -1);
const expired = process.argv[2];
if (expired) out.expired_option_daily = await history(expired, 'D', -120, -1);
const burst = [];
for (let i = 0; i < 25; i += 1) burst.push((await fetch(`${base}/quotes?symbols=NSE:SBIN-EQ`, { headers })).status);
out.burst_25_quotes_statuses = [...new Set(burst)];
console.log(JSON.stringify(out, null, 2));
