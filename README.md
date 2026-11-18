# token-radar

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/Fa277322/token-radar-01/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/Fa277322/token-radar-01/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

A token launch radar for the make.fun bounty [token-radar-01](https://make.fun/bounty/token-radar-01). It reads a sealed snapshot of DefiLlama's protocol index, finds every protocol whose token does not exist yet, ranks them by an implied value, and tells a reader how to farm each one before a launch.

## The model

Every pre-token protocol is priced by one function of the snapshot's own figures — no hardcoded names, no hand-picked rows:

```
implied = round( tvl_usd
               x comparable(category)                                  // the market's own pricing
               x (1 + clamp(change_7d, -60, 120) / 100 x 0.5)          // seven-day momentum
               x (0.7 + min(age_days, 1095) / 1095 x 0.6) )            // how long it has run with no token
```

`comparable(category)` is the median of `mcap_usd / tvl_usd` over the snapshot's live-token protocols of the same category, clamped into [0.15, 6] and used when at least 3 comparables exist; a thinner category is priced at the default 0.35. So a protocol's token, if issued on today's record, is priced the way the market already prices its peers — and the dashboard shows each row's comparable multiple and how many live peers set it.

Protocols whose token already trades are set aside in a separate live view with their market caps shown as facts, never mixed into the ranking. The watchlist (40 protocols at or above the $50M floor with no token on record) is fully covered, and the early radar adds 160 pre-token protocols below the floor — the rows the radar exists to find first.

## Farm plans

Every row carries a 6-step plan derived from the protocol's own record (category, chains, TVL, age): what to do, what capital it needs, the gas cost, and how long to hold. Each step states its cost and its time; nothing is a slogan.

## Dashboard

`dashboard/` is a static page, no framework and no network: a sortable, filterable board (search, category filter, pre-token / live-token tabs), a per-protocol detail view with the model's own inputs, and a model panel stating the arithmetic. The page recomputes each row's implied value from the same figures and checks the number `board.json` carries.

## Run it

```sh
node main.ts --input /input/snapshot.json   # writes /output (board.json, data.js, dashboard/, dossier.json)
# outside the grader's container:
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input ../input/snapshot.json
```

Node.js 22.18 or later, standard library only.

---

<sub>Entered on [make.fun](https://make.fun/?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>
