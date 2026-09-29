# NSE F&O Heat Map — cloud copy

This folder is an independent, cloud-ready copy of the local application. It has
no copied `.env.local`, build cache, Git history, or Sites project identity.

## Required deployment values

- `FYERS_CLIENT_ID` — secret
- `FYERS_SECRET_KEY` — secret
- `SITE_URL` — deployed site origin
- `FYERS_REDIRECT_URI` — `SITE_URL` plus `/api/fyers/callback`

Add the exact `FYERS_REDIRECT_URI` to the FYERS API dashboard. The value must
match the deployed callback URL exactly.

The deployment uses a D1 database binding named `DB` for backtest research
records. Live access tokens are stored only in an HTTP-only browser cookie and
are not committed to this folder.

## Local validation

```powershell
npm ci
npm run build
```

The original local application remains in the sibling `fno-heatmap-site`
folder and is not modified by this cloud copy.
