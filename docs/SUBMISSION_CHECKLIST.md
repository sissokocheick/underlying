# Submission Checklist & Winning Playbook

Everything the project needs to win 1st place in the **Real World Assets** track before 23:59 UTC on **30 September 2026**.

---

## 1. What was built and verified

- [x] **Zero-Cold-Start Architecture**: Bundled `data/seed_cache.json.gz` (354KB) loads the 2,391-token universe in **5ms**, avoiding 429 rate limits and 80-second delays on Render's free tier.
- [x] **24 unit tests pass** in 0.001s (`python -m unittest discover -s tests`).
- [x] **EVM On-Chain Wallet Scanner** (`/api/scan-wallet`): Reads ERC-20 tokenised RWA balances on Ethereum via public RPC + 1-click curated Institutional Treasury & Tech Equity presets.
- [x] **Institutional Counterparty Risk Radar**: Computes the Herfindahl-Hirschman Index (HHI: 7,041 - Critical) and displays a Default Stress Simulation scenario.
- [x] **SEC EDGAR CIK Integration**: Underlying stocks map to live SEC EDGAR company profiles (e.g. Nvidia CIK `0001045810`).
- [x] **Wrapper Decision Engine**: Ranks wrappers of the same company by exit liquidity, basis spread (bps), and liquidity depth ratio.
- [x] **Interactive CMC API Inspector**: Interactive live console on `/api/evidence/sample` showcasing the 5 core endpoints.
- [x] **Shareable Portfolio & CSV Audit Export**: Deep-linking via base64 URL hash and 1-click institutional CSV audit export.
- [x] **Resilient Offline / Throttle Fallback**: If CMC API is throttled or offline, stale quotes are served and demo evaluation falls back to pre-computed book without crashing.
- [x] **No API key in repo**: `.env` is gitignored; Render prompts for `CMC_API_KEY` securely.

---

## 2. Deployment Steps (Render Free Tier)

1. Push latest code to GitHub:
   ```bash
   git push origin main
   ```
2. On [render.com](https://render.com) -> **New +** -> **Blueprint**.
3. Select your repository `underlying`.
4. Enter your `CMC_API_KEY` when prompted in the Render dashboard.
5. Confirm deploy succeeds:
   ```bash
   curl -s https://<your-render-url>/api/health
   ```
   Should return: `{"cmc_configured": true, "plan": "startup", "status": "ok"}`

---

## 3. Video Narration Script (90 Seconds Chrono)

> 💡 **Golden Rule**: Judges decide in the first 20 seconds. Do not start with code. Start with the existential problem of RWAs.

* **[00:00 - 00:15] The Hook**  
  *(Screen: Open the app on the hero section)*  
  "In crypto, you think you own assets. In tokenised Real World Assets, you don’t hold tokens — you hold counterparties. If an issuer halts redemptions, your portfolio is re-priced or frozen, no matter what stock you think you bought."

* **[00:15 - 00:35] The Reveal (8 -> 6 -> 3)**  
  *(Screen: Mouse moves over the Funnel and Risk Radar)*  
  "This is Underlying, the first institutional portfolio tracker built on CoinMarketCap’s new RWA endpoints. Look at this book: 8 positions that look diversified. Underlying collapses them through CMC’s issuer join: 8 wrappers become 6 real assets, and 82% of the entire tokenised book runs through ONE single counterparty: Backed Assets. Our Counterparty HHI is 7,041 — deep in the danger zone."

* **[00:35 - 00:55] SEC Edgar & Which Wrapper to Buy**  
  *(Screen: Scroll down to Holdings table, hover on SEC CIK badge, then scroll to 'Which wrapper do you buy?')*  
  "Every underlying equity is linked directly to its official SEC EDGAR filing via its Central Index Key. And when one stock is tokenised across multiple issuers, Underlying answers the critical buying decision: which wrapper do you own? Here for NVIDIA, Backed has $27M in exit volume, while Dinari is unquoted. Buying the wrong ticker means you can't exit."

* **[00:55 - 01:15] Web3 EVM Scan & TradFi CSV**  
  *(Screen: Click 'Scan EVM Wallet' -> Click 'Institutional Treasury Preset' -> Click 'Export CSV')*  
  "Underlying bridges TradFi and Web3: paste your EVM address to scan live tokenised treasuries on-chain, or paste an institutional spreadsheet via CSV with zero wallet tracking. One click exports an institutional audit report."

* **[01:15 - 01:30] CoinMarketCap API Evidence**  
  *(Screen: Scroll to CMC Evidence section, click through the tabs)*  
  "Underlying composes 7 CoinMarketCap endpoints — from the 25-issuer universe to unified crypto & TradFi pricing. Check our live capability probes and API console. This is Underlying. Built for Build with CMC."

---

## 4. DoraHacks BUIDL Submission Form (Copy-Paste)

### Project Name
`Underlying — Institutional RWA & Crypto Portfolio Intelligence`

### Track
`Real World Assets`

### Tagline
`You don't hold tokens. You hold counterparties. A portfolio tracker rolling tokenised TradFi & crypto up to SEC CIK underlying assets and counterparty issuers via CoinMarketCap.`

### Detailed Description (Markdown for DoraHacks)
```markdown
# Underlying — You don't hold tokens, you hold counterparties.

Built for the **Build with CMC: API Hackathon** (Real World Assets track).

### The Problem
When you buy a tokenised stock or treasury, you are not buying a share in a vault — you are buying an issuer's promise. A portfolio holding `NVDAX` (Backed), `NVDAon` (Ondo), and `NVDA.D` (Dinari) looks like three diverse positions, but it is **one company held through three different counterparties**, with one wrapper lacking a quoted exit market entirely.

The RWA track brief specifically requested:
> *"portfolio trackers that hold crypto and tokenised TradFi in the same view"*

While all other submissions built passive screeners or data audit bots, **Underlying is the only interactive, privacy-first portfolio tracker** designed for actual holders.

---

### What Underlying Does

1. **The Three-Layer Roll-up:**
   - **Wrappers:** What you bought (`NVDAX`, `NVDAon`, `bIB01`, `BTC`)
   - **Underlying Assets:** What you are exposed to (Nvidia Corp, US Treasuries, Bitcoin)
   - **Issuers / Counterparties:** Who owes you collateral (Backed Assets, Ondo Finance, Dinari)

2. **Institutional Counterparty Risk Radar:**
   - Calculates the **Herfindahl-Hirschman Index (HHI)** for counterparty concentration (7,041 on demo book).
   - Generates a **Default Stress Test Scenario**: simulates capital frozen if a single issuer halts redemptions.

3. **SEC EDGAR Verification:**
   - Pulls the corporate SEC Central Index Key (CIK) from CMC metadata, linking directly to official SEC filings (`sec.gov/edgar/browse/?CIK=...`).

4. **"Which Wrapper Do You Buy?":**
   - Compares multiple wrappers of the same asset by 24h exit liquidity, basis spread in basis points (bps), and liquidity depth ratios.

5. **Multi-Modal Ingestion:**
   - **EVM On-Chain Wallet Scanner:** Scans Ethereum mainnet for tokenised RWA balances via JSON-RPC.
   - **Curated Institutional Presets:** 1-click loading of Institutional T-Bill/Gold Treasuries or Tech Equities.
   - **Spreadsheet CSV Import:** Paste `SYMBOL,QUANTITY,COST` with smart token resolution.
   - **Client-Side Privacy:** Positions live in `localStorage` and URL hash; zero user data stored on servers.

---

### CoinMarketCap Endpoints Used
- `/v5/real-world-assets/issuers/list` — All 25 tracked issuers.
- `/v5/real-world-assets/issuers` — Token-to-issuer join table (`crypto_id -> rwa_id + issuer_id`).
- `/v5/real-world-assets/map` — Asset metadata and categorization.
- `/v5/real-world-assets/info` — Corporate CIK, industry, and founding date.
- `/v2/cryptocurrency/quotes/latest` — Unified single-call pricing for native crypto + tokenised equities.
- `/v1/cryptocurrency/map` — Symbol search.
- `/v1/key/info` — Plan and credit budget diagnostics.
- `/v5/real-world-assets/market-pairs/list` — Probed live (documented 403 on Startup plan).

---

### Engineering & Reliability
- Zero-cold-start bundled seed cache (`data/seed_cache.json.gz`, 354KB) loads in **5ms**, consuming 0 initial API credits.
- 24 unit tests covering pure roll-up calculations, HHI math, spread basis, and EDGAR link formatting.
- Stale-while-revalidate pricing cache: never crashes if CMC rate limits occur.
```

---

## 5. X / Twitter Submission Post (Mandatory)

> **Tweet Text (with #BuildwithCMC)**:
> 
> You don't hold tokens. You hold counterparties.
> 
> Thrilled to submit Underlying for the @CoinMarketCap API Hackathon on @DoraHacks (Real World Assets track)!
> 
> The first portfolio tracker rolling tokenised RWAs up to SEC CIK underlying assets & counterparties.
> 
> 8 tokens ➔ 6 assets ➔ 3 issuers.
> 
> 🔗 Demo: https://<your-render-url>
> 💻 GitHub: https://github.com/<your-handle>/underlying
> 
> #BuildwithCMC #RWA #Web3
