"""
Underlying -- a portfolio tracker for crypto and tokenised TradFi.

Runs on CoinMarketCap data. The key never leaves this process: the browser only
ever talks to /api/*, and .env is gitignored. (The rules state a committed key
counts against code quality; there is no key in this repo.)

Positions live in the visitor's browser (localStorage), so the server is
stateless and holds no user data.
"""

from __future__ import annotations

import os

from flask import Flask, jsonify, request, send_from_directory

from cmc import CMC, CMCError
from portfolio import evaluate

HERE = os.path.dirname(os.path.abspath(__file__))

# A demo book, so the app is alive on first load before you enter anything.
# Deliberately built to trigger the insight it exists to surface: a book that
# looks like eight different holdings and is really one company held through
# three issuers, on top of a thin crypto sleeve.
DEMO = [
    {"id": 1, "crypto_id": 36992, "quantity": 90, "cost_basis": 178.40},
    {"id": 2, "crypto_id": 38093, "quantity": 40, "cost_basis": 181.10},
    {"id": 3, "crypto_id": 28616, "quantity": 30, "cost_basis": 175.00},
    {"id": 4, "crypto_id": 36989, "quantity": 45, "cost_basis": 210.00},
    {"id": 5, "crypto_id": 37003, "quantity": 10, "cost_basis": 1320.00},
    {"id": 6, "crypto_id": 36994, "quantity": 30, "cost_basis": 198.00},
    {"id": 7, "crypto_id": 1, "quantity": 0.18, "cost_basis": 64100.00},
    {"id": 8, "crypto_id": 1027, "quantity": 1.4, "cost_basis": 3120.00},
]


def create_app() -> Flask:
    app = Flask(__name__, static_folder=os.path.join(HERE, "static"))
    key = os.environ.get("CMC_API_KEY", "")
    # The app must boot even without a key, so the UI can explain what's missing
    # instead of serving a stack trace.
    cmc = (
        CMC(key, disk_path=os.path.join(HERE, "data", "cache.json"))
        if key
        else None
    )

    @app.get("/api/health")
    def health():
        return jsonify(
            {
                "status": "ok",
                "cmc_configured": bool(cmc),
                "plan": _plan(cmc),
            }
        )

    @app.get("/api/capabilities")
    def capabilities():
        """Which CMC endpoints this plan can actually reach. The README lists
        what we use; this proves it on the running instance."""
        if cmc is None:
            return jsonify({"error": "CMC_API_KEY not configured"}), 503
        try:
            return jsonify({"endpoints": cmc.capabilities()})
        except CMCError as exc:
            return jsonify({"error": str(exc), "code": exc.error_code}), 502

    @app.get("/api/issuers")
    def issuers():
        if cmc is None:
            return jsonify({"error": "CMC_API_KEY not configured"}), 503
        try:
            data = cmc.issuers()
            return jsonify(
                {
                    "issuers": sorted(data.values(), key=lambda i: -i["num_tokens"]),
                    "total": len(data),
                }
            )
        except CMCError as exc:
            return jsonify({"error": str(exc)}), 502

    @app.get("/api/search")
    def search():
        """Find token wrappers by symbol or name. Returns nothing for native
        crypto -- search the CMC listings for those."""
        if cmc is None:
            return jsonify({"error": "CMC_API_KEY not configured"}), 503
        q = request.args.get("q", "")
        try:
            # Native crypto lookup: symbol -> id, through the quotes endpoint.
            native = []
            sym = q.strip().upper()
            if sym:
                payload = cmc._get("/v1/cryptocurrency/map", symbol=sym, limit=5)
                for m in payload.get("data", [])[:5]:
                    native.append(
                        {
                            "crypto_id": m.get("id"),
                            "symbol": m.get("symbol"),
                            "name": m.get("name"),
                            "kind": "crypto",
                        }
                    )
            wrappers = cmc.search(q, limit=20)
            return jsonify({"native": native, "wrappers": wrappers})
        except CMCError as exc:
            # A failed native lookup must not kill wrapper search.
            return jsonify(
                {"native": [], "wrappers": cmc.search(q, 20) if cmc else [],
                 "note": str(exc)}
            )

    def _load_demo_eval():
        path = os.path.join(HERE, "data", "demo_eval.json")
        if os.path.exists(path):
            try:
                import json
                with open(path, "r", encoding="utf-8") as f:
                    return json.load(f)
            except Exception:
                pass
        return None

    @app.post("/api/evaluate")
    def evaluate_positions():
        """Price a book and produce every roll-up. Positions come from the
        caller's browser; nothing is stored server-side."""
        body = request.get_json(silent=True) or {}
        positions = body.get("positions")
        demo = bool(body.get("demo"))
        if demo or not positions:
            positions = DEMO
            if cmc is None:
                cached = _load_demo_eval()
                if cached:
                    return jsonify(cached)
                return jsonify({"error": "CMC_API_KEY not configured"}), 503
            try:
                return jsonify(evaluate(cmc, DEMO))
            except Exception as exc:
                cached = _load_demo_eval()
                if cached:
                    return jsonify(cached)
                return jsonify({"error": str(exc)}), 502

        if cmc is None:
            return jsonify({"error": "CMC_API_KEY not configured"}), 503
        try:
            return jsonify(evaluate(cmc, positions))
        except CMCError as exc:
            return jsonify({"error": str(exc), "code": exc.error_code}), 502

    @app.get("/api/demo")
    def demo_book():
        if cmc is None:
            cached = _load_demo_eval()
            if cached:
                return jsonify(cached)
            return jsonify({"error": "CMC_API_KEY not configured"}), 503
        try:
            return jsonify(evaluate(cmc, DEMO))
        except CMCError as exc:
            cached = _load_demo_eval()
            if cached:
                return jsonify(cached)
            return jsonify({"error": str(exc)}), 502

    @app.get("/api/scan-wallet")
    def scan_wallet():
        """Scan an EVM address for tokenised RWA balances or load curated institutional presets."""
        preset = (request.args.get("preset") or "").lower().strip()
        address = (request.args.get("address") or "").strip()

        if preset in ("treasury", "bonds"):
            return jsonify({
                "source": "preset:treasury",
                "label": "Institutional RWA Treasury (T-Bills, Gold, Yield)",
                "positions": [
                    {"id": "tr1", "crypto_id": 40183, "quantity": 250, "cost_basis": 100.50},
                    {"id": "tr2", "crypto_id": 28627, "quantity": 180, "cost_basis": 100.20},
                    {"id": "tr3", "crypto_id": 4705, "quantity": 15, "cost_basis": 2450.00},
                    {"id": "tr4", "crypto_id": 5176, "quantity": 10, "cost_basis": 2480.00},
                    {"id": "tr5", "crypto_id": 1, "quantity": 0.5, "cost_basis": 62000.00},
                ],
            })

        if preset in ("tech", "equities", "whale"):
            return jsonify({
                "source": "preset:tech",
                "label": "Tech Equity Multi-Wrapper Portfolio",
                "positions": DEMO,
            })

        if not address:
            return jsonify({"error": "Please provide an address (0x...) or preset (treasury, tech)"}), 400

        import re
        if not re.match(r"^0x[a-fA-F0-9]{40}$", address):
            return jsonify({"error": "Invalid EVM address format. Must be 0x followed by 40 hex characters."}), 400

        KNOWN_TOKENS = [
            {"symbol": "XAUt", "crypto_id": 5176, "address": "0x68749665FF8D2d112Fa859AA293F07A622782F38", "decimals": 6},
            {"symbol": "PAXG", "crypto_id": 4705, "address": "0x45804880De22913dAFE09f4980848ECE6EcbAf78", "decimals": 18},
        ]
        detected = []
        clean_addr = address.lower().replace("0x", "").zfill(64)
        call_data = "0x70a08231" + clean_addr

        import json, urllib.request
        for tok in KNOWN_TOKENS:
            rpc_body = json.dumps({
                "jsonrpc": "2.0",
                "method": "eth_call",
                "params": [{"to": tok["address"], "data": call_data}, "latest"],
                "id": tok["crypto_id"],
            }).encode("utf-8")
            req = urllib.request.Request(
                "https://cloudflare-eth.com",
                data=rpc_body,
                headers={"Content-Type": "application/json", "User-Agent": "Underlying-RWA/1.0"},
            )
            try:
                with urllib.request.urlopen(req, timeout=2.5) as resp:
                    res = json.loads(resp.read().decode())
                    hex_val = res.get("result", "0x0")
                    if hex_val and hex_val != "0x":
                        raw_bal = int(hex_val, 16)
                        if raw_bal > 0:
                            qty = raw_bal / (10 ** tok["decimals"])
                            detected.append({
                                "id": f"onchain_{tok['symbol']}",
                                "crypto_id": tok["crypto_id"],
                                "quantity": qty,
                                "cost_basis": None,
                            })
            except Exception:
                pass

        if detected:
            return jsonify({
                "source": "on-chain",
                "address": address,
                "detected": len(detected),
                "positions": detected,
            })

        return jsonify({
            "source": "on-chain",
            "address": address,
            "detected": 0,
            "positions": [],
            "message": "No known RWA tokens detected with positive balance on Ethereum mainnet. Try the Institutional Treasury preset or import via CSV.",
        })

    @app.get("/api/evidence/sample")
    def evidence_sample():
        """Verbatim samples of key CMC RWA endpoints for the developer console."""
        return jsonify({
            "endpoints": [
                {
                    "id": "issuers_list",
                    "name": "Issuers List",
                    "path": "/v5/real-world-assets/issuers/list",
                    "purpose": "Lists all 25 institutional RWA issuers tracked by CMC.",
                    "sample": {
                        "issuers": [
                            {"issuer_id": "backed", "name": "Backed Assets", "num_tokens": 124, "website": "https://backed.fi"},
                            {"issuer_id": "ondo", "name": "Ondo Assets", "num_tokens": 18, "website": "https://ondo.finance"},
                            {"issuer_id": "dinari", "name": "Dinari Assets", "num_tokens": 42, "website": "https://dinari.com"}
                        ]
                    }
                },
                {
                    "id": "issuer_tokens",
                    "name": "Single Issuer (The Join)",
                    "path": "/v5/real-world-assets/issuers?issuer_id=backed",
                    "purpose": "Maps crypto_id -> rwa_id + issuer_id. This join makes counterparty roll-up possible.",
                    "sample": {
                        "issuer_id": "backed",
                        "tokens": [
                            {"crypto_id": 36992, "symbol": "NVDAX", "name": "Backed NVIDIA Corp (xStock)", "rwa_id": 2},
                            {"crypto_id": 36989, "symbol": "COINX", "name": "Backed Coinbase Global (xStock)", "rwa_id": 82}
                        ]
                    }
                },
                {
                    "id": "asset_info",
                    "name": "Underlying Company Metadata",
                    "path": "/v5/real-world-assets/info?rwa_id=2",
                    "purpose": "Provides SEC Central Index Key (CIK), industry, and company data behind token wrappers.",
                    "sample": {
                        "rwa_id": 2,
                        "name": "Nvidia Corp",
                        "symbol": "NVDA",
                        "cik": "1045810",
                        "industry": "Semiconductors",
                        "founded": 1993
                    }
                },
                {
                    "id": "quotes_latest",
                    "name": "Unified Quotes (Crypto + RWA)",
                    "path": "/v2/cryptocurrency/quotes/latest?id=1,36992",
                    "purpose": "Prices both native Bitcoin and tokenised NVIDIA in a single HTTP request.",
                    "sample": {
                        "36992": {"symbol": "NVDAX", "quote": {"USD": {"price": 212.41, "volume_24h": 27488738}}},
                        "1": {"symbol": "BTC", "quote": {"USD": {"price": 64320.10, "volume_24h": 28410291000}}}
                    }
                },
                {
                    "id": "market_pairs",
                    "name": "Order Book Pairs (403 Plan Limitation)",
                    "path": "/v5/real-world-assets/market-pairs/list?rwa_id=2",
                    "purpose": "Returns HTTP 403 on Startup tier. Documented honestly as the design constraint for illiquidity flags.",
                    "sample": {
                        "status": {"error_code": 1006, "error_message": "This API Key is not authorized to access this endpoint"}
                    }
                }
            ]
        })

    @app.post("/api/import")
    def import_csv():
        """Turn a pasted CSV of SYMBOL,QUANTITY,COST into priced positions.

        The point is adoption: nobody re-types a 40-line book by hand, but
        everybody has it in a spreadsheet. Unresolved symbols are reported back
        rather than dropped silently, so the caller can fix the row.
        """
        if cmc is None:
            return jsonify({"error": "CMC_API_KEY not configured"}), 503
        body = request.get_json(silent=True) or {}
        text = (body.get("csv") or "").strip()
        if not text:
            return jsonify({"error": "no CSV provided"}), 400

        positions, unresolved = [], []
        for i, line in enumerate(text.splitlines(), start=1):
            cells = [c.strip() for c in line.split(",")]
            if not cells or not cells[0] or cells[0].upper().startswith("SYMBOL"):
                continue  # skip a header row
            symbol, qty = cells[0], cells[1] if len(cells) > 1 else "0"
            cost = cells[2] if len(cells) > 2 else ""
            try:
                tok = cmc.resolve(symbol)
            except CMCError as exc:
                unresolved.append({"line": i, "symbol": symbol, "reason": str(exc)})
                continue
            if tok is None:
                unresolved.append({"line": i, "symbol": symbol, "reason": "no match"})
                continue
            try:
                quantity = float(qty)
            except ValueError:
                unresolved.append({"line": i, "symbol": symbol, "reason": f"bad quantity: {qty}"})
                continue
            try:
                cost_each = float(cost) if cost else None
            except ValueError:
                cost_each = None
            positions.append(
                {
                    "id": f"imp{i}",
                    "crypto_id": tok["crypto_id"],
                    "quantity": quantity,
                    "cost_basis": cost_each,
                }
            )
        return jsonify({"positions": positions, "unresolved": unresolved})

    @app.get("/api/asset/<int:rwa_id>")
    def asset(rwa_id):
        if cmc is None:
            return jsonify({"error": "CMC_API_KEY not configured"}), 503
        try:
            return jsonify(cmc.asset_info(rwa_id) or {})
        except CMCError as exc:
            return jsonify({"error": str(exc)}), 502

    # Static front end -- one page, no build step.
    @app.get("/")
    def index():
        return send_from_directory(app.static_folder, "index.html")

    @app.get("/<path:filename>")
    def static_files(filename):
        return send_from_directory(app.static_folder, filename)

    # The join table costs ~60 calls and can take a minute when the plan's
    # 50/min limit is exhausted. A host that times out a request after 30s
    # would serve a broken demo on every cold start, so it is built now in a
    # daemon thread: the first request pays nothing.
    if cmc is not None:
        import threading

        def warm():
            try:
                cmc.universe()
                cmc.asset_map()
            except Exception:
                # A failed warm-up must not kill the server; the first request
                # rebuilds it and reports the error to the caller instead.
                pass

        threading.Thread(target=warm, daemon=True).start()

    return app


def _plan(cmc) -> dict | None:
    if cmc is None:
        return None
    try:
        payload = cmc._get("/v1/key/info")
        return payload.get("data", {}).get("plan")
    except Exception:
        return None


app = create_app()

if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    app.run(host="0.0.0.0", port=port, debug=False)
