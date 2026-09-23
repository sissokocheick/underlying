"""
CoinMarketCap client for Underlying.

One job: turn the RWA endpoint family into a single join table, then price it.

The join we need is `crypto_id -> {symbol, name, issuer, rwa_id}`. CoinMarketCap
does not expose that join in one call, so we build it by walking the issuer
family: `issuers/list` gives the 25 issuers, and `issuers` (single) lists each
issuer's tokens with both `crypto_id` and `rwa_id`. That walk is ~60 calls, so
it is cached for hours.

Pricing goes through `/v2/cryptocurrency/quotes/latest`, which prices native
crypto and tokenised wrappers in the same call -- no separate RWA pricing path
is needed.
"""

from __future__ import annotations

import os
import time
import urllib.parse
import urllib.request
from threading import RLock

API_BASE = "https://pro-api.coinmarketcap.com"

# How long each kind of response is trusted before we ask again.
TTL_UNIVERSE = 6 * 3600     # the issuer/token join; issuer membership barely moves
TTL_STATIC = 24 * 3600      # company metadata, asset map
TTL_QUOTES = 60             # prices move constantly; CMC refreshes every minute too

QUOTE_CHUNK = 100           # ids per /v2/quotes call


class CMCError(RuntimeError):
    """An error from the CoinMarketCap API, with its status payload attached."""

    def __init__(self, message: str, error_code=None, status_code=None):
        super().__init__(message)
        self.error_code = error_code
        self.status_code = status_code


class Cache:
    """Tiny TTL cache, backed by memory and an optional JSON file.

    The join table costs ~60 calls to build and changes slowly, so it is also
    written to disk: a restart then costs zero credits instead of re-walking
    25 issuers and hitting the 50-calls-per-minute rate limit.
    """

    def __init__(self, disk_path: str | None = None):
        self._store: dict[str, tuple[float, object]] = {}
        self._lock = RLock()
        self.disk_path = disk_path
        if disk_path and os.path.exists(disk_path):
            try:
                with open(disk_path, encoding="utf-8") as fh:
                    self._store = json_loads(fh.read().encode())
                    # See _intkeys: without this, a warm restart silently loses
                    # every token -> issuer -> underlying link.
                    for k, v in self._store.items():
                        self._store[k] = (v[0], Cache._intkeys(v[1]))
            except Exception:
                # A corrupt cache file must never stop the app; rebuild instead.
                self._store = {}

    def get(self, key, max_age):
        with self._lock:
            hit = self._store.get(key)
            if hit and time.time() - hit[0] < max_age:
                return True, hit[1]
            return False, None

    @staticmethod
    def _intkeys(obj):
        """JSON turns int dict keys into strings, which would make
        universe.get(36992) miss the \"36992\" entry and silently demote every
        tokenised position to plain crypto. Restore integer keys where the key
        is all digits -- inner payloads use descriptive string keys, so this
        only touches the int-keyed tables we build ourselves.
        """
        if not isinstance(obj, dict):
            return obj
        out = {}
        for k, v in obj.items():
            v = Cache._intkeys(v)
            out[int(k) if isinstance(k, str) and k.isdigit() else k] = v
        return out

    def set(self, key, value, disk=False):
        with self._lock:
            self._store[key] = (time.time(), value)
            if disk and self.disk_path:
                # Cache keys must stay JSON-serializable (see _qkey) or the
                # persist fails; a failure here must never lose the entry we
                # just cached in memory, so it is swallowed.
                try:
                    tmp = self.disk_path + ".tmp"
                    with open(tmp, "w", encoding="utf-8") as fh:
                        fh.write(json_dumps(self._store))
                    os.replace(tmp, self.disk_path)
                except Exception:
                    pass


class CMC:
    def __init__(self, api_key: str | None = None, base: str = API_BASE,
                 disk_path: str | None = None):
        self.key = api_key or os.environ.get("CMC_API_KEY", "")
        if not self.key:
            raise CMCError("CMC_API_KEY is not set")
        self.base = base
        # The universe costs ~60 calls to build and the plan allows 50/minute,
        # so it is persisted: a restart reuses it and burns no credits.
        self.cache = Cache(disk_path)
        # crypto_id -> token descriptor
        self._universe: dict[int, dict] = {}
        self._universe_built = 0.0
        # crypto_ids claimed by more than one issuer (should stay empty)
        self._collisions: list[int] = []
        # issuer_id -> issuer descriptor
        self._issuers: dict[str, dict] = {}
        # rwa_id -> asset metadata (name, asset_type, slug...)
        self._assets: dict[int, dict] = {}

    # -- transport ---------------------------------------------------------

    def _get(self, path: str, **params) -> dict:
        """One call, with one retry after the per-minute rate limit.

        The rate limit is 50 calls/minute and the universe walk uses most of it,
        so a cold start can legitimately be throttled on the first pass.
        """
        for attempt in range(2):
            params["CMC_PRO_API_KEY"] = self.key
            url = f"{self.base}{path}?{urllib.parse.urlencode(params)}"
            try:
                req = urllib.request.Request(url, headers={"Accept": "application/json"})
                with urllib.request.urlopen(req, timeout=60) as resp:
                    return self._decode(path, resp.read())
            except urllib.error.HTTPError as exc:
                body = exc.read().decode("utf-8", "replace")
                if exc.code == 429 and attempt == 0:
                    time.sleep(62)
                    continue
                code = None
                try:
                    code = json_loads(body).get("status", {}).get("error_code")
                except Exception:
                    pass
                # 403 / 1006 means the plan does not carry the endpoint. Surfaced
                # to the caller so /api/capabilities can report it honestly.
                raise CMCError(
                    f"{path}: HTTP {exc.code}", error_code=code, status_code=exc.code
                ) from exc
        raise CMCError(f"{path}: rate limited")

    @staticmethod
    def _decode(path: str, raw: bytes) -> dict:
        payload = json_loads(raw)
        status = payload.get("status", {})
        # The API returns error_code as a string ("0" when healthy), so coerce
        # before comparing -- a truthy "0" string would otherwise look like one.
        code = status.get("error_code")
        if str(code) not in ("0", "None", "null"):
            raise CMCError(f"{path}: {status.get('error_message')}", error_code=code)
        return payload

    # -- the join table ----------------------------------------------------

    def universe(self) -> dict[int, dict]:
        """crypto_id -> {symbol, name, issuer_id, issuer_name, rwa_id}."""
        fresh, cached = self.cache.get("universe", TTL_UNIVERSE)
        if fresh:
            self._universe = cached
            return cached

        issuers = []
        start = 1
        while True:
            page = self._get("/v5/real-world-assets/issuers/list", start=start, limit=250)
            data = page.get("data", {})
            issuers.extend(data.get("issuers", []))
            if not data.get("has_more"):
                break
            start += 250

        by_crypto: dict[int, dict] = {}
        by_issuer: dict[str, dict] = {}
        for iss in issuers:
            iid = iss["issuer_id"]
            tokens, start = [], 1
            while True:
                page = self._get(
                    "/v5/real-world-assets/issuers", issuer_id=iid, start=start, limit=250
                )
                data = page.get("data", {})
                tokens.extend(data.get("tokens", []))
                if start + 250 >= (data.get("num_tokens") or 0):
                    break
                start += 250

            by_issuer[iid] = {
                "issuer_id": iid,
                "name": iss.get("name"),
                "website": iss.get("website"),
                "logo": iss.get("logo"),
                "num_tokens": len(tokens),
            }
            for tok in tokens:
                cid = tok.get("crypto_id")
                if cid is None:
                    continue
                # A crypto_id should belong to exactly one issuer. If the API
                # disagrees, keep the first and record the collision on the
                # client rather than in the table -- the join is typed
                # int -> dict, and a stray list value would break every walk.
                if cid in by_crypto and by_crypto[cid]["issuer_id"] != iid:
                    self._collisions.append(cid)
                by_crypto.setdefault(
                    cid,
                    {
                        "crypto_id": cid,
                        "symbol": tok.get("symbol"),
                        "name": tok.get("name"),
                        "issuer_id": iid,
                        "issuer_name": iss.get("name"),
                        "rwa_id": tok.get("rwa_id"),
                    },
                )

        self._universe = by_crypto
        self._issuers = by_issuer
        self.cache.set("universe", by_crypto, disk=True)
        self.cache.set("issuers", by_issuer, disk=True)
        self.cache.set("collisions", self._collisions, disk=True)
        return by_crypto

    def issuers(self) -> dict[str, dict]:
        self.universe()
        fresh, cached = self.cache.get("issuers", TTL_UNIVERSE)
        return cached if fresh else self._issuers

    def collisions(self) -> list[int]:
        """crypto_ids claimed by two issuers. Expected empty; reported anyway."""
        self.universe()
        fresh, cached = self.cache.get("collisions", TTL_UNIVERSE)
        if fresh:
            self._collisions = cached
        return self._collisions

    # -- search ------------------------------------------------------------

    def search(self, query: str, limit: int = 25) -> list[dict]:
        """Find tokens and native crypto by symbol or name. Native crypto is
        resolved through /v2/quotes, RWA wrappers through the universe."""
        q = (query or "").strip().upper()
        if not q:
            return []
        u = self.universe()
        out = []
        for tok in u.values():
            if not isinstance(tok.get("crypto_id"), int):
                continue
            if q in (tok.get("symbol") or "").upper() or q in (tok.get("name") or "").upper():
                out.append(tok)
            if len(out) >= limit:
                break
        return out

    # -- pricing -----------------------------------------------------------

    def quotes(self, crypto_ids: list[int], convert: str = "USD") -> dict[int, dict]:
        """crypto_id -> {price, market_cap, volume_24h, percent_change_24h, chain}.

        One call per 100 ids, so a 30-position portfolio costs one credit.
        """
        ids = [int(c) for c in crypto_ids if c is not None]
        if not ids:
            return {}
        # A flat string key, not a tuple: the store is persisted to JSON, which
        # only accepts string keys.
        key = "quotes|" + ",".join(str(c) for c in sorted(set(ids))) + "|" + convert
        fresh, cached = self.cache.get(key, TTL_QUOTES)
        if fresh:
            return cached

        out: dict[int, dict] = {}
        for i in range(0, len(ids), QUOTE_CHUNK):
            chunk = ids[i : i + QUOTE_CHUNK]
            payload = self._get(
                "/v2/cryptocurrency/quotes/latest",
                id=",".join(str(c) for c in chunk),
                convert=convert,
            )
            for cid_s, info in (payload.get("data") or {}).items():
                quote = (info.get("quote") or {}).get(convert) or {}
                platform = info.get("platform") or {}
                out[int(cid_s)] = {
                    "crypto_id": int(cid_s),
                    "symbol": info.get("symbol"),
                    "name": info.get("name"),
                    "price": quote.get("price"),
                    "market_cap": quote.get("market_cap"),
                    "volume_24h": quote.get("volume_24h"),
                    "percent_change_24h": quote.get("percent_change_24h"),
                    "percent_change_7d": quote.get("percent_change_7d"),
                    "chain": platform.get("symbol"),
                    "last_updated": quote.get("last_updated"),
                }
        self.cache.set(key, out)
        return out

    # -- asset side --------------------------------------------------------

    def asset_map(self) -> dict[int, dict]:
        """rwa_id -> {name, symbol, slug, asset_type, has_tokens}."""
        fresh, cached = self.cache.get("asset_map", TTL_STATIC)
        if fresh:
            self._assets = cached
            return cached

        out: dict[int, dict] = {}
        start = 1
        while True:
            page = self._get("/v5/real-world-assets/map", start=start, limit=250)
            data = page.get("data", {})
            for a in data.get("rwa_assets", []):
                out[a["rwa_id"]] = a
            if not data.get("has_more"):
                break
            start += 250
        self.cache.set("asset_map", out, disk=True)
        return out

    def asset_info(self, rwa_id: int) -> dict | None:
        """Static metadata for the underlying: company name, CIK, industry..."""
        if rwa_id is None:
            return None
        key = "asset_info|" + str(int(rwa_id))
        fresh, cached = self.cache.get(key, TTL_STATIC)
        if fresh:
            return cached
        payload = self._get("/v5/real-world-assets/info", rwa_id=str(int(rwa_id)))
        assets = (payload.get("data") or {}).get("rwa_assets") or []
        info = assets[0] if assets else None
        self.cache.set(key, info, disk=True)
        return info

    def asset_list(self, limit=100, start=1, asset_type=None, sort="rwa_rank") -> dict:
        return self._get(
            "/v5/real-world-assets/assets/list",
            start=start,
            limit=limit,
            **({"asset_type": asset_type} if asset_type else {}),
            sort=sort,
        ).get("data", {})

    # -- diagnostics -------------------------------------------------------

    def capabilities(self) -> dict:
        """Probe each endpoint we care about once, so the README's claim that we
        use them is checkable from the running app."""
        results = {}
        probes = [
            ("issuers/list", lambda: self._get("/v5/real-world-assets/issuers/list", limit=1)),
            ("issuers", lambda: self.universe()),
            ("assets/map", lambda: self.asset_map()),
            ("assets/list", lambda: self.asset_list(limit=1)),
            ("quotes/latest (v2)", lambda: self.quotes([1])),
            ("info", lambda: self.asset_info(2)),
            ("market-pairs/list", lambda: self._get("/v5/real-world-assets/market-pairs/list", rwa_id="2", limit=1)),
        ]
        for name, fn in probes:
            try:
                fn()
                results[name] = {"ok": True}
            except CMCError as exc:
                results[name] = {"ok": False, "error": str(exc), "code": exc.error_code}
        return results


def json_loads(raw: bytes) -> dict:
    import json

    return json.loads(raw.decode("utf-8"))


def json_dumps(obj) -> str:
    import json

    # separators keep the cache file small -- the universe is ~2400 tokens.
    return json.dumps(obj, separators=(",", ":"))
