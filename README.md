# Underlying — you don't hold tokens, you hold counterparties

A portfolio tracker for crypto **and** tokenised real-world assets, built on the
CoinMarketCap API for the **Build with CMC** hackathon, Real World Assets track.

The one thing it does that a spreadsheet doesn't: it answers three different
questions at once about the same list of holdings.

| You enter | What you see | Endpoint |
|---|---|---|
| 8 token positions | 6 underlying assets | `real-world-assets/map` |
| | 3 issuers | `real-world-assets/issuers` |
| | one book value + P&L | `cryptocurrency/quotes/latest` |

Most people can answer the first number and have never seen the third. That gap
is the product.

The demo book is deliberately built to make the gap visible: eight holdings that
*look* like a diversified book and are in fact **43% one company, held through
three different issuers, with 82% of the tokenised book running through a single
counterparty.**

---

## Track

**Real World Assets.** Chosen because the field is a monoculture — of the 39
BUIDLs already submitted, roughly two thirds are read-only screeners, agent
wrappers, or dashboards. **None of them is a portfolio tracker**, even though
"portfolio tracker" is named in the briefs of two of the four tracks. The
research behind that claim is in [`docs/RESEARCH_competitors.md`](docs/RESEARCH_competitors.md).

## Live demo

The app is a single page. Enter positions (or load the demo book) and the
roll-ups recompute against live prices.

```
POST /api/evaluate {"demo": true}
```

---

## CoinMarketCap endpoints used

Every endpoint the app talks to, and what it's for.

| Endpoint | Purpose | Called |
|---|---|---|
| `/v5/real-world-assets/issuers/list` | all 25 RWA issuers | universe build |
| `/v5/real-world-assets/issuers` | each issuer's tokens: joins `crypto_id` → `rwa_id` + `issuer_id` | universe build |
| `/v5/real-world-assets/map` | `rwa_id` → company name, symbol, asset type | on demand, cached 24h |
| `/v5/real-world-assets/info` | company metadata: SEC CIK, industry, founded, employees | per underlying |
| `/v5/real-world-assets/assets/list` | the ranked RWA universe | diagnostics |
| `/v2/cryptocurrency/quotes/latest` | **prices both native crypto and tokenised wrappers in one call** | every refresh |
| `/v1/cryptocurrency/map` | symbol → id for native crypto search | search box |
| `/v1/key/info` | plan + credit status | health check |
| `/v5/real-world-assets/market-pairs/list` | *intended* — **403 on this plan** | see below |

### The join that isn't one call

There is no endpoint that returns `crypto_id → {symbol, issuer, rwa_id}`. The
app builds it by walking the issuer family: `issuers/list` gives the 25 issuers,
then `issuers` (single) lists each one's tokens with both ids attached. That's
~60 calls, so the result is cached for 6 hours in memory **and on disk** — a
restart costs zero credits rather than re-hitting the 50-calls-per-minute limit.
The write is atomic (`os.replace`) and a corrupt file is rebuilt rather than
crashing the app.

### Evidence of a real call

The running app proves it uses these endpoints instead of just claiming to —
`GET /api/capabilities` probes each one and reports pass/fail:

```python
# app.py
@app.get("/api/capabilities")
def capabilities():
    """Which CMC endpoints this plan can actually reach. The README lists
    what we use; this proves it on the running instance."""
    return jsonify({"endpoints": cmc.capabilities()})
```

Current output on the submitted plan:

```
OK   assets/list
OK   assets/map
OK   info
OK   issuers
OK   issuers/list
FAIL market-pairs/list  /v5/real-world-assets/market-pairs/list: HTTP 403
OK   quotes/latest (v2)
```

And the payload itself, verbatim from the live API for one position in the demo
book (`GET /v5/real-world-assets/info?rwa_id=2`):

```json
{
  "rwa_id": 2,
  "name": "Nvidia Corp",
  "symbol": "NVDA",
  "slug": "nvidia-corp",
  "asset_type": "stock",
  "cik": "1045810",
  "industry": "Semiconductors",
  "founded": 1993
}
```

That `cik` is a real SEC Central Index Key, and it is what lets the roll-up say
"these three tickers are one company" rather than "here are three rows".

---

## What the API made possible

- **One pricing call for both worlds.** `/v2/cryptocurrency/quotes/latest` prices
  a native coin and a tokenised share of NVIDIA in the same request, and returns
  `platform.symbol` so the chain shows up in the table too. A portfolio that
  mixes the two needs no second code path.
- **The issuer join exists at all.** Tokenised stock is a *claim on an issuer*,
  and the RWA family exposes that relationship directly. That is the entire basis
  for the counterparty roll-up — it cannot be built from the crypto-only
  endpoints.
- **`asset_type` on the map endpoint** drives the allocation donut without any
  hand-maintained classifier.
- **SEC CIK and industry on `info`** turn a ticker into a named company with a
  sector, which is what makes "six underlying assets" legible.

## Where the API got in the way

Stated plainly, because it shaped the design:

- **`/v5/real-world-assets/market-pairs/list` returns 403 (error 1006)** on this
  plan. That's the order-book endpoint, so the app has **no depth or spread data**
  — it cannot tell you a wrapper's market is thin, only that its 24h volume is
  low. The illiquidity flag is built on volume as a result, and is labelled as
  such.
- **`/v1/cryptocurrency/ohlcv/historical` is also unavailable**, so there is no
  price history to recover a cost basis from. **Cost basis is entered by hand**,
  and the UI says so where it asks. The honest consequence: P&L is only as good
  as what you type in.
- **`status.error_code` comes back as the string `"0"`**, not an integer 0 — a
  naive truthiness check raises on every healthy call. Coerced in
  `CMC._decode` before comparison.
- **`/v5/real-world-assets/map` rejects `limit=500`** with HTTP 400; the real
  maximum is 250, so the map is paginated.
- **The 50-requests-per-minute limit is smaller than the universe build**, which
  needs ~60 calls. Handled by caching to disk (above) rather than by accepting
  429s.

---

## The insight, end to end

One demo book, eight positions:

```
Token wrappers           8      what you bought
Underlying assets        6      what you're exposed to
Issuers                  3      who you owe it to
```

and the roll-up that only the third view makes possible:

```
Nvidia Corp          $29,355  43%   3 wrappers, 3 issuers:
                                   Backed Assets, Dinari Assets, Ondo Assets
Bitcoin              $15,176  22%
Apple Inc.           $10,125  15%   1 wrapper, Backed Assets
Coinbase Global       $8,894  13%   1 wrapper, Backed Assets
Ethereum              $3,740   5%
MicroStrategy Inc     $1,620   2%
```

Three different tickers for NVIDIA. Three different counterparties. One
position. Nobody buying `NVDAX`, `NVDAon` and `NVDA.D` thinks they bought the
same stock three times — but that is what they did, and one of the three has no
quoted market at all, which the app flags rather than silently dropping.

The risk flags this surfaces:

- **`issuer_concentration` (high)** — 82% of the tokenised book runs through one
  issuer. Every tokenised position is a claim on the *issuer*, not on the
  underlying; if that issuer halts redemptions the whole book re-prices whatever
  it holds. Native crypto is excluded from this share, because it has no issuer
  and would otherwise dilute the number into harmlessness.
- **`untracked` (warn)** — 1 holding has no quoted market. It is kept in the
  roll-up with a count rather than vanishing, so a holding you can't price is
  still a holding.
- **`illiquid` (warn)** — sub-$1k 24h volume; the price you see is not the price
  you can exit at. (Volume is the available proxy — see the 403 above.)
- **`same_asset_many_wrappers` (info)** — the NVIDIA case.

---

## Architecture

Four files, no build step, one dependency.

```
cmc.py         the API client: transport, TTL cache (memory + disk), the join
portfolio.py   positions -> book; the three roll-ups and the risk flags
app.py         Flask: /api/* and the static front end
static/        one HTML page, hand-rolled SVG donuts, localStorage
```

- **stdlib only** for the client (`urllib`, `threading`, `json`). The single
  pip dependency is Flask.
- **Stateless.** Positions live in the visitor's `localStorage`; the server
  holds no user data.
- **The key never reaches the browser.** `.env` is gitignored; the front end
  only ever talks to `/api/*`. (Committed keys count against code quality per
  the rules — there is no key in this repo.)
- **It boots without a key at all**, so the UI can explain what's missing
  instead of serving a stack trace.
- **Both roll-up functions are pure** — `totals`, `by_issuer`, `by_underlying`
  and `by_class` take rows and return dicts, so the logic is testable without a
  network call.

## Run it

```bash
pip install -r requirements.txt
export CMC_API_KEY=your-key-here        # .env works too
python app.py                           # http://127.0.0.1:5000
```

## Endpoint reference

| Method | Path | Notes |
|---|---|---|
| `GET` | `/api/health` | plan, credit budget, whether a key is configured |
| `GET` | `/api/capabilities` | live probe of every endpoint above |
| `GET` | `/api/issuers` | all issuers, most tokens first |
| `GET` | `/api/search?q=` | native crypto + tokenised wrappers |
| `POST` | `/api/evaluate` | the whole roll-up; `{"positions": [...]}` or `{"demo": true}` |
| `GET` | `/api/demo` | the demo book above |
| `GET` | `/api/asset/<rwa_id>` | underlying company metadata |

A position is `{id, crypto_id, quantity, cost_basis}` — `cost_basis` is average
USD paid per unit, entered by hand because there is no price-history endpoint.

---

## Rules compliance

- **No committed key.** `.env` is gitignored and the key is read from the
  environment at startup. The browser never sees it.
- **Original work**, built for this hackathon, using the campaign-issued key.
- **One track** selected: Real World Assets (the rules disallow multiple).
- Competitor research and the gap analysis: [`docs/RESEARCH_competitors.md`](docs/RESEARCH_competitors.md).
