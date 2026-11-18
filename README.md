# token-radar

[![make.fun bounty](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/Fa277322/token-radar-01/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/Fa277322/token-radar-01/reward.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

Token Radar takes one DefiLlama snapshot and ranks pre-token protocols — protocols with no token on
record — by an implied value: what each protocol might be worth if it priced like the live-token
protocols it most resembles. The watchlist is the floor (every slug is scored), and the early radar
adds the strongest pre-token protocols below the watchlist's TVL floor. Everything runs offline from
one static dashboard that reads one generated `data.js` — no framework, no network.

## The comparable-multiple model

    implied = round( tvl_usd x comparable(category) x (1 + clamp(change_7d, -60, 120) / 100 x 0.5) x (0.7 + min(age_days, 1095) / 1095 x 0.6) )

- `comparable(category)` is the median `mcap_usd / tvl_usd` of the snapshot's live-token protocols of
  the same category, clamped into [0.15, 6]; the default 0.35 is used when the category's sample is
  thinner than 3 live peers, or the protocol has no category.
- Growth is the seven-day TVL change, clamped to [-60, 120] per cent and weighted at 0.5.
- Maturity runs from 0.7 to 1.3 over 1,095 days since first listing (an unknown age counts as 365 days).
- No protocol name is special-cased: one function scores every row, and the dashboard recomputes each
  row with the same arithmetic and flags any drift from `board.json`.

## Farm plans

Every row carries a six-step farm plan derived from the protocol's own record, never a hand-written
list of names: the category picks the action (supply to a lender, provide liquidity, bridge, stake,
and so on), the TVL picks the capital ($50–$250), the first chain names where to do it, and the age
picks how long to hold the position. Each step states its action, its cost and its time.

## Run it

    mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input ../input/snapshot.json

`--input` names the snapshot file, or a directory holding `snapshot.json`. This scores the snapshot and
writes `out/board.json`, `out/data.js`, `out/dashboard/`, `out/screenshots/` and `out/dossier.json`. Open
`out/dashboard/index.html` in a browser — it renders with no network. Node 22, standard library only; no
dependencies.

<sub>Entered on [make.fun](https://make.fun/?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>
