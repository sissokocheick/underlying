"""
Portfolio evaluation: turn a list of holdings into a book, then roll it up.

The whole point of the app is in this file. A holding is a *token*; what you are
actually exposed to is the *underlying*; and who you owe that exposure to is the
*issuer*. Three different answers to "what do I own", from one list of tokens.

    12 token wrappers  ->  7 underlying assets  ->  5 issuers

Most people can answer the first number and have never seen the third. That gap
is the product.
"""

from __future__ import annotations

import math
from collections import defaultdict


def _num(x):
    return x if isinstance(x, (int, float)) and not math.isnan(x) else None


def evaluate(cmc, positions: list[dict]) -> dict:
    """Enrich positions with live values and produce every roll-up the UI shows.

    A position is {id, crypto_id, quantity, cost_basis}. cost_basis is the average
    USD paid per unit -- the user supplies it, because this plan has no historical
    quotes endpoint to recover it from.
    """
    universe = cmc.universe()
    quotes = cmc.quotes([p["crypto_id"] for p in positions if p.get("crypto_id")])
    assets = cmc.asset_map()

    rows, missing = [], []
    for p in positions:
        cid = p.get("crypto_id")
        meta = universe.get(cid) or {}
        quote = quotes.get(cid) or {}
        price = _num(quote.get("price"))

        qty = float(p.get("quantity") or 0)
        cost_each = _num(p.get("cost_basis"))
        cost = cost_each * qty if cost_each is not None else None
        value = price * qty if price is not None else None

        rwa_id = meta.get("rwa_id")
        asset = assets.get(rwa_id) or {}
        is_rwa = rwa_id is not None

        rows.append(
            {
                "id": p.get("id"),
                "crypto_id": cid,
                "symbol": quote.get("symbol") or meta.get("symbol"),
                "name": quote.get("name") or meta.get("name"),
                "kind": "rwa" if is_rwa else "crypto",
                "quantity": qty,
                "cost_basis": cost_each,
                "price": price,
                "value": value,
                "cost": cost,
                "pnl": (value - cost) if (value is not None and cost is not None) else None,
                "pnl_pct": (
                    (value / cost - 1) if (value and cost) else None
                ),
                "market_cap": _num(quote.get("market_cap")),
                "volume_24h": _num(quote.get("volume_24h")),
                "change_24h": _num(quote.get("percent_change_24h")),
                "chain": quote.get("chain"),
                "rwa_id": rwa_id,
                "issuer_id": meta.get("issuer_id"),
                "issuer_name": meta.get("issuer_name"),
                "asset_name": asset.get("name"),
                "asset_symbol": asset.get("symbol"),
                "asset_type": asset.get("asset_type") if is_rwa else "crypto",
                "last_updated": quote.get("last_updated"),
            }
        )
        if price is None:
            missing.append(cid)

    # Company metadata for each underlying, so the roll-up can name the company
    # behind the token rather than just its ticker.
    for r in rows:
        if r["rwa_id"] is not None:
            info = cmc.asset_info(r["rwa_id"]) or {}
            r["company"] = {
                "name": info.get("name") or r.get("asset_name"),
                "symbol": info.get("symbol") or r.get("asset_symbol"),
                "website": info.get("website"),
                "industry": info.get("industry"),
                "cik": info.get("cik"),
                "employees": info.get("employees"),
                "founded": info.get("founded"),
            }
        else:
            r["company"] = None

    # Named `roll` rather than `totals`: assigning `totals = totals(rows)`
    # would shadow the function and UnboundLocalError on the very call.
    roll = totals(rows)
    issuers = by_issuer(rows)

    # Institutional Counterparty Concentration (Herfindahl-Hirschman Index / HHI)
    hhi = round(sum((iss["share"] * 100) ** 2 for iss in issuers), 1) if issuers else 0.0
    hhi_level = "critical" if hhi >= 2500 else ("moderate" if hhi >= 1500 else "diversified")
    stress_test = None
    if issuers:
        largest = issuers[0]
        stress_test = {
            "issuer_id": largest["issuer_id"],
            "name": largest["name"],
            "capital_at_risk": largest["value"],
            "capital_share": largest["share"],
            "scenario": f"If {largest['name']} halts redemptions, ${largest['value']:,.0f} ({largest['share']:.1%}) of your tokenised portfolio is immediately frozen."
        }
    roll["counterparty_hhi"] = hhi
    roll["hhi_level"] = hhi_level
    roll["stress_test"] = stress_test

    return {
        "positions": rows,
        "totals": roll,
        "by_issuer": issuers,
        "by_underlying": by_underlying(rows),
        "by_class": by_class(rows),
        "flags": _flags(rows, roll, issuers),
        # The buying decision: given you want exposure to this company, which
        # wrapper do you buy? Same underlying, different issuers, different
        # liquidity -- ranked so the answer isn't "whichever ticker I saw first".
        "wrapper_comparison": compare_wrappers(rows),
    }


def compare_wrappers(rows):
    """For each underlying held more than one way, rank the wrappers.

    A wrapper is scored on the two things that actually bite at exit: can you
    price it, and is the market deep enough to leave. Unpriced wrappers sort
    last -- an unquotable claim is not an alternative, it's a warning.
    """
    groups = defaultdict(list)
    for r in rows:
        if r["rwa_id"] is None:
            continue
        groups[r["rwa_id"]].append(r)

    out = []
    for rwa_id, group in groups.items():
        if len(group) < 2:
            continue
        ranked = sorted(
            group,
            key=lambda r: (
                r["value"] is None,                      # unpriced sorts last
                -(r["volume_24h"] or 0),                  # then deepest market first
            ),
        )
        deepest = ranked[0]
        deepest_price = deepest.get("price")
        deepest_vol = deepest.get("volume_24h") or 0.0

        wrappers_out = []
        for i, w in enumerate(ranked):
            p = w.get("price")
            vol = w.get("volume_24h") or 0.0
            spread_bps = None
            if i > 0 and p and deepest_price and deepest_price > 0:
                spread_bps = round(((p - deepest_price) / deepest_price) * 10000, 1)
            liquidity_ratio = None
            if i > 0 and deepest_vol and vol and vol > 0:
                liquidity_ratio = round(deepest_vol / vol, 1)

            wrappers_out.append(
                {
                    "symbol": w.get("symbol"),
                    "issuer_name": w.get("issuer_name"),
                    "price": p,
                    "value": w.get("value"),
                    "volume_24h": w.get("volume_24h"),
                    "chain": w.get("chain"),
                    "priced": w.get("value") is not None,
                    "spread_bps": spread_bps,
                    "liquidity_ratio": liquidity_ratio,
                }
            )

        out.append(
            {
                "rwa_id": rwa_id,
                "name": (group[0].get("company") or {}).get("name")
                        or group[0].get("asset_name")
                        or group[0].get("symbol"),
                "wrappers": wrappers_out,
            }
        )
    return out


def totals(rows):
    value = sum(r["value"] for r in rows if r["value"])
    cost = sum(r["cost"] for r in rows if r["cost"])
    priced = sum(1 for r in rows if r["value"] is not None)
    # An issuer is only a counterparty for tokenised positions -- native crypto
    # has none, so it is excluded from the issuer count rather than bucketed as
    # "unattributed" (which would otherwise look like one dominant issuer).
    rwa_rows = [r for r in rows if r["rwa_id"] is not None]
    return {
        "value": value,
        "cost": cost,
        "pnl": value - cost if (value and cost) else None,
        "pnl_pct": (value / cost - 1) if (value and cost) else None,
        "positions": len(rows),
        "priced": priced,
        "unpriced": len(rows) - priced,
        # The headline: how many wrappers, how many assets, how many issuers.
        "n_underlying": len({r["rwa_id"] for r in rows if r["rwa_id"] is not None})
        + len({r["crypto_id"] for r in rows if r["rwa_id"] is None}),
        "n_issuers": len({r["issuer_id"] for r in rwa_rows if r["issuer_id"]}),
    }


def by_issuer(rows):
    """Counterparty concentration. Native crypto is excluded outright -- it has
    no issuer, and including it would invent a fake 'unattributed' issuer.

    Unpriced wrappers are kept, contributing no value but still counting as a
    position: an issuer holding a claim you cannot price is a counterparty you
    want on the list, not one to hide. Shares stay over priced value only.
    """
    groups = defaultdict(lambda: {"value": 0.0, "cost": 0.0, "ids": []})
    for r in rows:
        if r["rwa_id"] is None or not r["issuer_id"]:
            continue
        g = groups[r["issuer_id"]]
        g["value"] += r["value"] or 0.0
        g["cost"] += r["cost"] or 0.0
        g["name"] = r["issuer_name"]
        g["ids"].append(r["id"])
    out = []
    total = sum(g["value"] for g in groups.values()) or 1.0
    for iid, g in sorted(groups.items(), key=lambda kv: -kv[1]["value"]):
        out.append(
            {
                "issuer_id": iid,
                "name": g["name"],
                "value": g["value"],
                "cost": g["cost"],
                "pnl": g["value"] - g["cost"],
                "share": g["value"] / total,
                "n_positions": len(g["ids"]),
            }
        )
    return out


def by_class(rows):
    """Allocation by asset class: stock, commodity, crypto, and so on. Unpriced
    positions still count -- a holding you cannot price is still a holding."""
    groups = defaultdict(lambda: {"value": 0.0, "cost": 0.0, "ids": []})
    for r in rows:
        g = groups[r.get("asset_type") or "crypto"]
        g["value"] += r["value"] or 0.0
        g["cost"] += r["cost"] or 0.0
        g["ids"].append(r["id"])
    out = []
    total = sum(g["value"] for g in groups.values()) or 1.0
    for name, g in sorted(groups.items(), key=lambda kv: -kv[1]["value"]):
        out.append(
            {
                "name": name,
                "value": g["value"],
                "cost": g["cost"],
                "pnl": g["value"] - g["cost"],
                "share": g["value"] / total,
                "n_positions": len(g["ids"]),
            }
        )
    return out


def by_underlying(rows):
    """Roll up to the real asset -- the company or commodity, not the wrapper.

    Unpriced wrappers are kept and flagged, so the roll-up never silently drops
    a holding; they just contribute no value to the shares.
    """
    groups = defaultdict(lambda: {"value": 0.0, "cost": 0.0, "positions": [], "company": None})
    for r in rows:
        key = r["rwa_id"] if r["rwa_id"] is not None else f"c{r['crypto_id']}"
        g = groups[key]
        g["value"] += r["value"] or 0.0
        g["cost"] += r["cost"] or 0.0
        g["positions"].append(r)
        g["company"] = g["company"] or r.get("company")
        g["asset_type"] = r.get("asset_type")
        g["rwa_id"] = r.get("rwa_id")
        g["unpriced"] = g.get("unpriced", 0) + (1 if r["value"] is None else 0)
    out = []
    total = sum(g["value"] for g in groups.values()) or 1.0
    for key, g in sorted(groups.items(), key=lambda kv: -kv[1]["value"]):
        company = g.get("company") or {}
        first = g["positions"][0]
        cik = company.get("cik")
        edgar_url = f"https://www.sec.gov/edgar/browse/?CIK={str(cik).zfill(10)}" if cik else None
        out.append(
            {
                "key": key,
                "rwa_id": g.get("rwa_id"),
                "name": company.get("name") or first.get("asset_name") or first.get("symbol") or key,
                "symbol": company.get("symbol") or first.get("asset_symbol"),
                "asset_type": g.get("asset_type"),
                "industry": company.get("industry"),
                "website": company.get("website"),
                "cik": cik,
                "edgar_url": edgar_url,
                "value": g["value"] or None,
                "cost": g["cost"] or None,
                "pnl": (g["value"] - g["cost"]) if (g["value"] and g["cost"]) else None,
                "share": g["value"] / total,
                "n_wrappers": len(g["positions"]),
                "unpriced": g["unpriced"],
                # The second-order insight: one company, several counterparties.
                "issuers": sorted({p["issuer_name"] for p in g["positions"] if p["issuer_name"]}),
            }
        )
    return out


def _flags(rows, totals, issuers):
    """Risk signals that only appear once you look past the symbol column."""
    flags = []

    if totals["unpriced"]:
        flags.append(
            {
                "level": "warn",
                "code": "untracked",
                "title": f"{totals['unpriced']} holding(s) with no tracked market",
                "detail": "CoinMarketCap returns no price for this wrapper, so it "
                "contributes nothing to the book. Check the issuer's market before "
                "relying on it.",
            }
        )

    for issuer in issuers[:1]:
        # share() is already over the tokenised book only -- native crypto is not
        # an issuer exposure and must not dilute this number.
        share = issuer["share"]
        if share >= 0.5:
            flags.append(
                {
                    "level": "high",
                    "code": "issuer_concentration",
                    "title": f"{share:.0%} of the tokenised book runs through one issuer: {issuer['name']}",
                    "detail": "Every tokenised position is a claim on an issuer, not "
                    "on the underlying. If that issuer halts redemptions, the whole "
                    "book re-prices -- whatever it holds.",
                }
            )
        elif share >= 0.25:
            flags.append(
                {
                    "level": "warn",
                    "code": "issuer_concentration",
                    "title": f"Largest issuer is {share:.0%} of the tokenised book",
                    "detail": "Spreading wrappers across issuers diversifies "
                    "counterparties even when it does not diversify assets.",
                }
            )

    illiquid = [
        r for r in rows if r["value"] and r["volume_24h"] is not None and r["volume_24h"] < 1000
    ]
    if illiquid:
        names = ", ".join(sorted({r["symbol"] for r in illiquid})[:4])
        flags.append(
            {
                "level": "warn",
                "code": "illiquid",
                "title": f"{len(illiquid)} holding(s) in sub-$1k 24h markets",
                "detail": f"{names}. A thin wrapper market means the price you see "
                "is not the price you can exit at.",
            }
        )

    for asset in by_underlying(rows):
        if asset["n_wrappers"] > 1 and (asset["share"] >= 0.2 or asset["unpriced"]):
            flags.append(
                {
                    "level": "info",
                    "code": "same_asset_many_wrappers",
                    "title": f"{asset['name']}: {asset['n_wrappers']} wrappers, one position",
                    "detail": "These look like separate holdings but they are the same "
                    f"exposure held through {len(asset['issuers'])} issuer(s): "
                    + ", ".join(asset["issuers"]) + ".",
                }
            )
    return flags
