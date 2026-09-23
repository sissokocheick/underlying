# Research: the 39 submitted BUIDLs (fetched 2026-09-23 from the DoraHacks hub API)

`GET https://dorahacks.io/api/v1/hub/hackathons/2363/buidls?limit=100`
(hackathon id 2363 = `coinmarketcap-api-202609`, resolved via
`GET https://dorahacks.io/api/v1/hub/hackathons/coinmarketcap-api-202609`)

Raw dump: `scratch/buidls_all.json` (39 records), `scratch/hackathon.json`.

## 1. Distribution by track

| track | submissions |
|---|---|
| AI Agents and Automation | 13 |
| Real World Assets | 11 |
| Markets and Trading Tools | 8 |
| Data and Visualisation | 7 |

One person (`edycutjong`) submitted **four** projects (Middleman, Shelfware,
Forwarding Address, Elephant Tracks), so unique builders are fewer than 39.

## 2. What everyone built — the field is a monoculture of read-only tools

| actual category | count |
|---|---|
| AI agent / MCP server | 14 |
| Screener / scanner / ranked list | 11 |
| Dashboard / index page | 10 |
| Issuer / wrapper-spread ranker (RWA only) | 5 |
| Data-gap / coverage auditor (RWA only) | 4 |
| Alert notifier | 1 |
| **Portfolio / PnL tracker** | **0** |

Every entry looks at the *market*. Not one entry looks at *the user's own book*.

## 3. The gap the organizers named and nobody filled

Track briefs, quoted from the Tracks tab:

- **Markets and Trading Tools** — "Screeners, alert bots, scanners,
  **portfolio and PnL trackers**, backtesting utilities, anything that turns raw
  market data into a decision."
- **Real World Assets** — "RWA screeners, issuer explorers, tools that compare a
  tokenised asset against its underlying, **portfolio trackers that hold crypto
  and tokenised TradFi in the same view**."

**"Portfolio tracker" is named in two of four briefs. Zero of 39 entries built one.**
Same for "backtesting utilities" (0 of 39).

This is the differentiator: it is asked for by the organizers, empty in the field,
and it is the only category that creates a *repeat* user — a judge asks "would I
open this again next week?", and a screener gets one visit while a portfolio gets
daily ones. That directly serves the 25-point "usefulness to a real person"
criterion.

## 4. The RWA track is crowded but homogeneous

All 11 RWA entries are market-side data tools:

| entry | what it does |
|---|---|
| Shelfware | counts wrappers with no tracked market, grades issuers |
| Bedrock | ranks wrapper spreads, issuers, chains, SEC filings |
| Parity | fair-price + wrapper-spread layer for tokenised stocks |
| Backstop | value concentration per token, publishes data holes |
| RWA X-Ray | volume / concentration / freshness / data gaps |
| Investor Intel | issuer + filings + liquidity behind a number |
| RWAT SCORE | risk score per asset |
| Signal Desk | resolves a tokenised stock to its issuing company |
| UnderScope | joins assets ↔ issuers ↔ tokens |
| RWA Compass | AI agent over RWA endpoints |
| Verigate | (no stated vision) |

Five of them rank wrappers or issuers; four audit CMC's own data coverage. A
portfolio tracker is a **different category from all eleven**, not a better
version of one of them. And it is the only RWA entry that composes *all seven*
endpoints the brief lists (ID map, info, list, quotes latest, market pairs,
issuers list, single issuer) — which is how "Interesting use of the API" (20
points) gets maxed.

## 5. Weak tracks

**Data and Visualisation (7)** is the shallowest field: two of seven are a
higher/lower guessing game ("Cap or No Cap") and a private trade journal. But
its 25-point criterion is "reveals something genuinely non-obvious", which is the
hardest to satisfy honestly, and a portfolio tool would have to strain to fit it.

**AI Agents (13)** is the most crowded, and 2026 judges see dozens of MCP servers
per hackathon. Not entering.

## 6. Judging criteria — RWA track, out of 100

| criterion | weight | how our entry wins it |
|---|---|---|
| Does it work | 30 | live deployed app, real positions, no mock data |
| Usefulness to someone tracking tokenised assets | 25 | the only personal utility in the track; repeat use |
| Interesting use of the API | 20 | composes all 7 RWA endpoints + crypto quotes |
| Code quality and documentation | 15 | clean repo, no key committed, README + API note |
| Presentation | 10 | one-screen portfolio, issuer roll-up as the hero |

## 7. Non-obvious insight worth building around

None of the 11 RWA entries notices the thing a holder actually needs: **when you
buy a tokenised stock you are not buying the stock — you are buying an issuer's
promise.** Three NVDA wrappers from three issuers is one equity position and
three counterparties. Rolling a portfolio up by **issuer**, not by symbol, is
genuinely non-obvious (it also happens to be what the single-issuer endpoint is
for, and no entry uses it that way).

## 8. Required deliverables — rules compliance checklist

From the "What Counts as a Submission" and "Rules" sections:

- [ ] **Public repository**
- [ ] **Working demo / deployed link / screen recording**
- [ ] **X/Twitter post** linking the DoraHacks submission + demo video,
      hashtag `#BuildwithCMC` (also a *required form field* on submission)
- [ ] **CMC API endpoints named explicitly** (list them in the README)
- [ ] **Visible evidence of a real API call** — code *and* response shown
- [ ] **Short note** on what the API made possible and where it got in the way
- [ ] **One track selected** (multi-track is disabled: `is_multi_tracks_allowed: false`)
- [ ] **Mandatory fields on the form**: GitHub repo link, demo video link
- [ ] **API key NOT committed to the public repo** — quote: "We will ask you to
      rotate it and it will count against code quality". Key stays in `.env`.

Timeline: submissions close **Wed 30 Sep 2026 23:59 UTC**; judging 1–16 Oct;
results 19 Oct. Prize pool $10K; top-3 get a free year of CMC API; top-30 swag.
