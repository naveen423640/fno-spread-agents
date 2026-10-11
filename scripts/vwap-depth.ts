// How far back does FYERS serve 5-minute candles?
//   npm run vwap:depth                       (TCS)
//   npm run vwap:depth -- --symbol NSE:INFY-EQ
// Needs FYERS_CLIENT_ID and FYERS_ACCESS_TOKEN (the npm script loads .env.local if it exists). Makes up to 15 paced history requests.
import { probeHistoryDepth } from '../lib/vwap/depth';
import { createFyersProvider } from '../lib/vwap/provider';

const argv = process.argv.slice(2);
const symbol = argv[argv.indexOf('--symbol') + 1] && argv.includes('--symbol') ? argv[argv.indexOf('--symbol') + 1] : 'NSE:TCS-EQ';

async function main() {
  const clientId = process.env.FYERS_CLIENT_ID, accessToken = process.env.FYERS_ACCESS_TOKEN;
  if (!clientId || !accessToken) throw new Error('FYERS_CLIENT_ID and FYERS_ACCESS_TOKEN are not set. Put the access token in .env.local.');
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
  console.log(`Probing 5-minute history depth for ${symbol} back from ${today}…`);
  const r = await probeHistoryDepth(createFyersProvider({ credentials: { clientId, accessToken } }), symbol, today);
  for (const w of r.windows) console.log(`  ${w.from} to ${w.to}: ${w.candles} candles${w.firstDay ? `, sessions ${w.firstDay} to ${w.lastDay}` : ''}`);
  console.log(`\nOldest 5-minute candle found: ${r.earliestDay ?? 'none'} (${r.sessionsSeen} sessions). Stopped because: ${r.stoppedBecause}${r.error ? ` (${r.error})` : ''}.`);
  console.log(`Calendar months whose first session is present (usable for the monthly VWAP): ${r.monthsFullyCovered.join(', ') || 'none'}`);
}
main().catch((e) => { console.error(e instanceof Error ? e.message : 'probe failed'); process.exitCode = 1; });
