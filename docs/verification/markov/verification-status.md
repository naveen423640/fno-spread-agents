# Markov regime tab: verification status (2026-09-30)

## Checked by the assistant (fresh runs, evidence in the commit history)

| Check | Result |
|---|---|
| `npx vitest run` | 156 passed, 10 files (includes fixture parity for all 8 window x method cases and the no-future-data proof) |
| `npx tsc --noEmit` | exit 0 |
| `npm run build` | exit 0 |
| `npm run lint` | 29 errors, all pre-existing in other files; none in `lib/regime` or `app/markov-regime.tsx` |
| Order endpoints in the regime code | none; the route only reads `data/history` and only answers GET |
| Tracked `.env*` files | 0 |
| No-token state, error states, "Not enough history", corporate-action banner, n-step matrix, keyboard control, no stale data while loading, drill-down button | checked in the running app using the real no-token responses and responses **synthesised from the synthetic fixture** (rendering only, not market data) |
| Code review | done, see `code-review.md`; all Important findings fixed |

## Done by the user, not independently verified by the assistant

| Plan task | What the user reported |
|---|---|
| Task 8: FYERS split/bonus adjustment evidence | "checked it is fine". Details not provided. The code still reports the adjustment status as **unverified** and always shows the >0.25 log-move warning. |
| Task 11: live sweep (3 real stocks x 2 methods x 4 windows, screenshots, other tabs) | done manually. No screenshots or output were shared with the assistant. |
| Task 12: final verification against the brief | done manually. The fresh runs above are the assistant's only evidence. |

## Still unverified by the assistant

- The FYERS daily resolution code `D`, the 360-day chunk limit and the epoch-to-IST-date mapping for daily candles, against real responses.
- The FYERS token-error codes -22 and "could not authenticate" (from community posts; see `code-review.md`).
- The tab's appearance with real data, fine visual layout against the mockup, and mobile width.
- Split/bonus adjustment of FYERS daily history (see above).
