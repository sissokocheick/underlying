# Submission checklist

Everything the project needs before 23:59 UTC on **30 September 2026**.

The code is done, committed, and verified locally. What remains is the five
steps that need a human identity or an account — none of them can be done from
this machine.

## Done and verified

- [x] App boots and every endpoint returns 200 locally
- [x] The full chain works live: 8 token positions → 6 underlying assets →
      3 issuers, with NVIDIA held through Backed / Ondo / Dinari
- [x] `/api/capabilities` probes each endpoint; `market-pairs/list` honestly
      reports 403
- [x] 22 unit tests pass over the roll-up logic, no network needed
- [x] CSV import: paste a spreadsheet, get priced positions; unresolved rows
      reported, not swallowed
- [x] Wrapper comparison: same company, several issuers, ranked by exit
      liquidity — the buying decision
- [x] No native `prompt()` dialogs; inline forms throughout
- [x] `README.md` names every endpoint, shows a verbatim API response, and
      states what the API made possible and where it got in the way
- [x] No key in the repo (`.env` gitignored; `CMC_API_KEY` marked `sync: false`
      in `render.yaml` so Render prompts for it)
- [x] Git repo initialised, 7 commits, clean tree

## Remaining — in order

### 1. Push to a public GitHub repo

`gh` is not installed here, so create the repo yourself, then:

```bash
cd /e/PROJET/cmc_rwa
git remote add origin git@github.com:<your-handle>/underlying.git
git branch -M main
git push -u origin main
```

Verify before pushing that `.env` and `data/cache.json` are not tracked — they
are gitignored, but check: `git ls-files | grep -E "env|cache"` should print
nothing. A committed key counts against code quality.

If you want the commit author changed from the placeholder I used:

```bash
git rebase -r --root --exec 'git commit --amend --no-edit --reset-author'
```

after setting `git config user.name` / `user.email`.

### 2. Deploy a live demo

Render, free tier — the app is a plain Flask service with no build step:

1. render.com → **New +** → **Blueprint**, paste the GitHub repo URL
2. `render.yaml` drives the rest; it will ask for `CMC_API_KEY` (that is
   deliberate — it never reads the key from the repo)
3. Confirm the deploy comes up green; `/api/health` is the health check path

Sanity-check the deployed demo:

```bash
curl -s <demo-url>/api/health
curl -s -X POST <demo-url>/api/evaluate -H 'Content-Type: application/json' \
  -d '{"demo":true}' | python -m json.tool | head -20
curl -s -X POST <demo-url>/api/import -H 'Content-Type: application/json' \
  -d '{"csv":"NVDAX,90,178.40"}' | head -5
```

You should see 8 positions, 6 underlying, 3 issuers, the
`issuer_concentration` flag at 82%, and a `wrapper_comparison` entry for
Nvidia with three wrappers. If the first call is slow, that is the one-off
universe build; it is cached to disk after.

### 3. Screen recording (required form field)

60–90 seconds is enough. The arc that lands:

1. Open the demo — the funnel narrows 8 wrappers → 6 assets → 3 issuers
2. Scroll to "Which wrapper do you buy?" — three NVIDIA wrappers ranked by
   exit liquidity, Dinari's unpriced one last
3. The roll-up: three tickers collapse to one company held through three issuers
4. The high flag: 82% of the tokenised book through one issuer
5. Import CSV → paste a line → priced instantly, showing you can bring a real
   book in seconds
6. `/api/capabilities` showing the real endpoint probe, with the 403 on
   `market-pairs/list` — that is the honest limitation

OBS Studio is free on Windows. Upload unlisted to YouTube or to the GitHub
repo and link that URL.

### 4. X/Twitter post (required form field)

The form requires a post URL containing `#BuildwithCMC`. It has to come from
your account. Something like:

> Built for the @coinmarketcap API hackathon: a portfolio tracker that rolls
> your tokenised RWA positions up to the *issuer*, not the symbol. Eight
> holdings → six assets → three counterparties. #BuildwithCMC
> [demo url]

Attach the screen recording if it fits. Copy the post URL once it is live.

### 5. Submit on DoraHacks

https://dorahacks.io/hackathon/coinmarketcap-api-202609/buidl → **Submit BUIDL**

Required fields, all needed:

| Field | Value |
|---|---|
| Project name | Underlying |
| Track | **Real World Assets** — only one; multiple tracks are not allowed |
| Repo | the GitHub URL from step 1 |
| Demo | the live URL from step 2 |
| Video | the recording from step 3 |
| Tweet | the URL from step 4, must contain `#BuildwithCMC` |
| Description | one paragraph + the three-numbers framing, link the README |

Deadline: **23:59 UTC, Wednesday 30 September 2026**. Judging 1–16 Oct,
results 19 Oct.

## Pre-submit proofread

- The README's endpoint table matches `/api/capabilities` output.
- The demo book on the live deploy shows **3 issuers** in both the headline and
  the issuer panel. If the panel shows 2 and the headline 3, the deploy is
  running stale code — redeploy.
- `wrapper_comparison` contains one entry (Nvidia) with 3 wrappers.
- `python -m unittest discover -s tests` prints `OK` (22 tests).
