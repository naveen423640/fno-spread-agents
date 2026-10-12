# Cloud copy of the app (for the tablet)

A second deployment of this app on Cloudflare, so a Samsung tablet can show the F&O heat map (live), LTP Levels and LTP Agent when the Mac is off. It is **read-only for the agent**: the agent keeps running on the Mac and only its journal is copied up.

- **Address:** https://fno-calculator.fnocalculator.workers.dev (Worker `fno-calculator`, config in `cloud-app/wrangler.jsonc`).
- **Database:** the same D1 database as the cloud recorder (`ltp-recorder`), so the tablet sees every recorded chain. The other app tables are created in it by `npm run cloud:app:db`.
- **Lock:** Cloudflare Access (email one-time code). The Worker also checks Access's signed token itself (`lib/cloud/access.ts`), so with Access misconfigured or off it answers 503/401 to everyone instead of running open.
- **What it will not do:** record chains, run or change the agent, pull from the cloud (`blockedInCloud`). It can still send the FYERS token on to the recorder, so you can do the morning token from the tablet. Because one Worker cannot call another through `workers.dev`, the cloud copy writes the token straight into the shared database instead of calling the recorder.

## Setup

1. `npm run cloud:app:db` creates the app's tables in the shared database.
2. Secrets (type each value when asked; do not paste them anywhere else):
   - `npx wrangler secret put FYERS_SECRET_KEY --config cloud-app/wrangler.jsonc` (your FYERS app secret)
   - `npx wrangler secret put LTP_RECORDER_SECRET --config cloud-app/wrangler.jsonc` (the same admin secret as the recorder's `ADMIN_SECRET`)
3. `npm run cloud:app:deploy` builds and deploys. Until step 5 it answers 503 to everyone.
4. In the FYERS developer dashboard, add `https://fno-calculator.fnocalculator.workers.dev/api/fyers/callback` as a redirect URL of your app (keep the existing one for the Mac).
5. Cloudflare dashboard, Zero Trust, Access, Applications: add a **Self-hosted** application for `fno-calculator.fnocalculator.workers.dev`, with a policy "Allow" for your email and the **One-time PIN** login method. Copy the application's **Audience (AUD) tag** and your team domain (`<team>.cloudflareaccess.com`).
6. Put them in `cloud-app/wrangler.jsonc` as `CF_ACCESS_AUD` and `CF_ACCESS_TEAM_DOMAIN`, then `npm run cloud:app:deploy` again.

## Using it

Open the address on the tablet, enter your email, type the code Cloudflare sends. Then **Connect FYERS** on the heat map (its own login, separate from the Mac's) for live data.

LTP Levels reads what the cloud recorder captured. For LTP Agent, click **Send journal to cloud** on the Mac's LTP Agent tab (the last 7 days of decisions, trades and outcomes, plus strategies and state); the tablet shows what was last sent.
