# token-radar

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/Fa277322/token-radar-01/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/Fa277322/token-radar-01/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

Token Radar prices pre-token DeFi protocols the way a market might: it takes each protocol's TVL, asks what multiple live tokens of the same category already command over their own TVL, and adjusts for a week of growth and for age. The result — an implied value — ranks a watchlist plus an early radar of 160 protocols, and hands every row a six-step farm plan whose costs and times come only from the record.

## The comparable-multiple model

Every board row is scored with one formula:

```
implied = round( tvl_usd x comparable(category) x (1 + clamp(change_7d, -60, 120) / 100 x 0.5) x (0.7 + min(age_days, 1095) / 1095 x 0.6) )
```

- **comparable(category)** — the median market-cap/TVL of the snapshot's live-token protocols of the same category, clamped into [0.15, 6] when at least 3 comparables exist; with fewer, the default 0.35 applies.
- **growth** — the 7-day TVL change, clamped into [-60, 120] and applied at half weight.
- **maturity** — scales 0.7 up to 1.3 over a protocol's first 1,095 days; an unknown age is treated as 365 days.

`age_days` counts whole UTC days from the snapshot date to the token's listing date, and the two multipliers are fixed to 4 decimals before the product — so any row's implied value can be recomputed from the board alone, which the dashboard does and states.

## Farm plans

Each row ships exactly six steps — fresh wallet, the category's main action, a weekly qualifying action, a hold window, a points-page check, and a farm log. The record decides the money: capital of $250 / $150 / $100 / $50 by TVL tier, a hold of 60 / 45 / 30 days by protocol age, small gas estimates, and the main action by category — supply into lending or CDP, liquidity on dexes or yield, bridges, staking and restaking, perps, prediction markets, vaults and curators, stables or RWA, insurance cover, or a plain USDC deposit. Step 5 is the guardrail: check the protocol's own points page, and never pay anyone to claim.

## Dashboard

`dashboard/index.html` renders `out/data.js` (`window.RADAR`) with no framework and no network: a sortable board with implied-value bars and watchlist/early pills, a detail dialog that rebuilds the equation from the row and confirms it matches `board.json`, a live-token table of market caps that already trade, and the model panel above. Search, category filter, and the open dialog are address-bar state: `#q=`, `#category=`, `#p=`.

## Layout

- `lib/model.ts` — parsing, the valuation, board construction, farm plans, and the radar payload
- `main.ts` — the build step: reads the snapshot, writes `board.json`, `data.js`, and the dossier
- `dashboard/` — `index.html` plus the stylesheet and script the page renders with
- `screenshots/` — three views of the final dashboard, copied into every build

## Run it

```bash
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input ../input/snapshot.json
```

Node.js 22.18 or later, standard library only. The build writes `out/board.json` and `out/data.js`, copies `dashboard/` and `screenshots/` into `out/`, and writes `out/dossier.json` last.

<sub>Entered on [make.fun](https://make.fun/?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>
