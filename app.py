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

    @app.post("/api/evaluate")
    def evaluate_positions():
        """Price a book and produce every roll-up. Positions come from the
        caller's browser; nothing is stored server-side."""
        if cmc is None:
            return jsonify({"error": "CMC_API_KEY not configured"}), 503
        body = request.get_json(silent=True) or {}
        positions = body.get("positions")
        demo = bool(body.get("demo"))
        if demo or not positions:
            positions = DEMO
        try:
            return jsonify(evaluate(cmc, positions))
        except CMCError as exc:
            return jsonify({"error": str(exc), "code": exc.error_code}), 502

    @app.get("/api/demo")
    def demo_book():
        if cmc is None:
            return jsonify({"error": "CMC_API_KEY not configured"}), 503
        try:
            return jsonify(evaluate(cmc, DEMO))
        except CMCError as exc:
            return jsonify({"error": str(exc)}), 502

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
