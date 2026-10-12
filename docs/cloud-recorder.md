# Cloud recorder

Keeps recording the option chains while the Mac is off. A Cloudflare Worker runs the same minute recorder as the app (`lib/ltp/recorder.ts`) on a cron trigger, every minute from 09:15 to 15:30 IST on trading days, into its own D1 database. Read-only market data: nothing in it can place an order.

You put the FYERS access token in by hand each morning. The Worker never logs in for you and never stores a PIN or refresh token.

## One-time setup

You need a Cloudflare account and `npx wrangler login`. The Workers **Paid** plan ($5 a month) is recommended: one recording minute makes about 60 database calls, and the free plan allows 50 per run, so the third index could be skipped.

1. Create the database: `npx wrangler d1 create ltp-recorder --config cloud-recorder/wrangler.jsonc`. Copy the `database_id` it prints into `cloud-recorder/wrangler.jsonc`.
2. Put your FYERS app id (not a secret) in `vars.FYERS_CLIENT_ID` in the same file.
3. Create the tables: `npm run cloud:db`.
4. Set a long random admin secret: `npx wrangler secret put ADMIN_SECRET --config cloud-recorder/wrangler.jsonc`.
5. Deploy: `npm run cloud:deploy`. It prints the Worker's address.
6. In `.env.local` add `LTP_RECORDER_URL` (that address) and `LTP_RECORDER_SECRET` (the admin secret), for the pull button and script below.

## Every morning, before 09:15

In the LTP Levels tab, logged in to FYERS, click **Send token to cloud**. That is all. Without the app, put today's access token in `.env.local` as `FYERS_ACCESS_TOKEN` and send it:

```bash
npm run ltp:token
```

or, with `curl` (paste the token in place of `TOKEN`; the admin secret is the one from step 4):

```bash
curl -X PUT "$LTP_RECORDER_URL/token" -H "Authorization: Bearer $LTP_RECORDER_SECRET" -H "content-type: application/json" -d '{"token":"TOKEN"}'
```

Check it took with `npm run ltp:health` (or `curl -H "Authorization: Bearer $LTP_RECORDER_SECRET" "$LTP_RECORDER_URL/health"`), which shows `token.present: true`, the last snapshot time per index and the day's gaps. The token itself is never shown. If you forget, each minute is logged as a `login_required` gap and nothing is recorded; send the token later and recording resumes from that minute.

## Pulling the data to the Mac

The LTP Levels tab has a **Pull from cloud** button, and `npm run ltp:pull` does the same from a terminal. Either fetches today and yesterday from the Worker and merges them into the local database (`--date YYYY-MM-DD` for one day). Rows already here are kept, so the Mac's own recording and the cloud's combine, with the cloud filling the minutes the Mac missed. Tabs, replay, the agent and the Backtest tab then see them as usual.

## What this does not do

- It does not renew the FYERS token. A token expires every day, so a morning without the PUT means no data that day.
- The agent still runs on the Mac (`npm run agent-run`) against the pulled data. Moving it to the cloud is a separate step.
- NSE holidays come from `reference/nse_holidays.json`, which is marked unverified; on a missed holiday the Worker records a day of login or upstream gaps, which is harmless.
