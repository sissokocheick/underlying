"""
Tests for the roll-up logic in portfolio.py.

The roll-up functions are deliberately pure -- rows in, dicts out -- so they can
be tested without a network call or a key. The cases below mirror the demo book
because that is what the judges see, and each one asserts the specific claim
the app makes: that several wrappers collapse to one underlying held through
several issuers, and that native crypto is never mistaken for an issuer.
"""

import unittest

from portfolio import _flags, by_class, by_issuer, by_underlying, totals


def row(id, crypto_id, value=None, cost=None, rwa_id=None, issuer_id=None,
        issuer_name=None, symbol=None, asset_type=None, volume_24h=None):
    return {
        "id": id,
        "crypto_id": crypto_id,
        "symbol": symbol or f"T{crypto_id}",
        "name": None,
        "rwa_id": rwa_id,
        "issuer_id": issuer_id,
        "issuer_name": issuer_name,
        "asset_type": asset_type,
        "value": value,
        "cost": cost,
        "volume_24h": volume_24h,
    }


# The demo book in miniature: NVIDIA three ways through three issuers, one of
# them unpriced, plus native crypto.
BOOK = [
    row(1, 36992, value=100.0, cost=90.0, rwa_id=2, issuer_id="backed",
        issuer_name="Backed Assets", asset_type="stock"),
    row(2, 38093, value=200.0, cost=190.0, rwa_id=2, issuer_id="ondo",
        issuer_name="Ondo Assets", asset_type="stock"),
    row(3, 28616, value=None, cost=60.0, rwa_id=2, issuer_id="dinari",
        issuer_name="Dinari Assets", asset_type="stock"),
    row(4, 36989, value=150.0, cost=160.0, rwa_id=82, issuer_id="backed",
        issuer_name="Backed Assets", asset_type="stock"),
    row(5, 1, value=500.0, cost=450.0, asset_type="crypto"),
]


class TestTotals(unittest.TestCase):
    def test_three_wrappers_are_one_underlying(self):
        t = totals(BOOK)
        # 3 NVIDIA wrappers collapse to 1; Coinbase and BTC are separate.
        self.assertEqual(t["n_underlying"], 3)
        self.assertEqual(t["positions"], 5)

    def test_issuers_exclude_native_crypto(self):
        # BTC is the single largest position here. If it were counted as an
        # issuer it would show up as a dominant counterparty and bury the real
        # concentration.
        self.assertEqual(totals(BOOK)["n_issuers"], 3)

    def test_unpriced_is_counted_not_dropped(self):
        self.assertEqual(totals(BOOK)["unpriced"], 1)
        self.assertEqual(totals(BOOK)["priced"], 4)

    def test_value_excludes_unpriced_rows(self):
        t = totals(BOOK)
        self.assertEqual(t["value"], 100.0 + 200.0 + 150.0 + 500.0)
        self.assertEqual(t["cost"], 90.0 + 190.0 + 60.0 + 160.0 + 450.0)


class TestByIssuer(unittest.TestCase):
    def test_native_crypto_is_not_an_issuer(self):
        names = {g["name"] for g in by_issuer(BOOK)}
        self.assertEqual(names, {"Backed Assets", "Ondo Assets", "Dinari Assets"})

    def test_unpriced_contributes_no_value(self):
        dinari = next(g for g in by_issuer(BOOK) if g["issuer_id"] == "dinari")
        self.assertEqual(dinari["value"], 0.0)

    def test_shares_sum_over_tokenised_book_only(self):
        # 500 of the 950 book is BTC. Shares must still sum to 1 over the
        # tokenised 450, not over 950.
        shares = sum(g["share"] for g in by_issuer(BOOK))
        self.assertAlmostEqual(shares, 1.0)
        backed = next(g for g in by_issuer(BOOK) if g["issuer_id"] == "backed")
        # Backed holds 100 + 150 = 250 of the 450 priced tokenised book.
        self.assertAlmostEqual(backed["share"], 250.0 / 450.0)


class TestByUnderlying(unittest.TestCase):
    def test_collapses_wrappers_to_one_asset(self):
        groups = by_underlying(BOOK)
        nvidia = next(g for g in groups if g["rwa_id"] == 2)
        self.assertEqual(nvidia["n_wrappers"], 3)
        self.assertEqual(
            sorted(nvidia["issuers"]),
            ["Backed Assets", "Dinari Assets", "Ondo Assets"],
        )

    def test_unpriced_wrapper_is_kept_and_flagged(self):
        nvidia = next(g for g in by_underlying(BOOK) if g["rwa_id"] == 2)
        self.assertEqual(nvidia["unpriced"], 1)
        # ...and it contributes no value to the group's share.
        self.assertAlmostEqual(nvidia["value"], 300.0)

    def test_native_crypto_groups_by_crypto_id(self):
        btc = next(g for g in by_underlying(BOOK) if g["key"] == "c1")
        self.assertEqual(btc["n_wrappers"], 1)
        self.assertEqual(btc["issuers"], [])


class TestByClass(unittest.TestCase):
    def test_unpriced_still_counted(self):
        classes = {g["name"]: g for g in by_class(BOOK)}
        self.assertEqual(classes["stock"]["n_positions"], 4)
        self.assertEqual(classes["crypto"]["n_positions"], 1)

    def test_shares_sum_to_one(self):
        self.assertAlmostEqual(sum(g["share"] for g in by_class(BOOK)), 1.0)


class TestFlags(unittest.TestCase):
    def _flag(self, code, rows):
        return next((f for f in _flags(rows, totals(rows), by_issuer(rows))
                     if f["code"] == code), None)

    def test_high_concentration_at_half(self):
        f = self._flag("issuer_concentration", BOOK)
        self.assertIsNotNone(f, "Backed is 50% of the tokenised book")
        self.assertEqual(f["level"], "high")
        self.assertIn("Backed Assets", f["title"])

    def test_warn_between_quarter_and_half(self):
        # Largest issuer at 40% of the book: above the 25% warn line, below the
        # 50% high line. Three issuers are needed -- with two, the largest is
        # always at least half.
        rows = [
            row(i, i, value=v, cost=v, rwa_id=2 + i, issuer_id=name,
                issuer_name=name.title(), asset_type="stock")
            for i, (name, v) in enumerate([("a", 400.0), ("b", 300.0), ("c", 300.0)])
        ]
        f = self._flag("issuer_concentration", rows)
        self.assertEqual(f["level"], "warn")

    def test_no_concentration_flag_when_spread(self):
        # Five equal issuers: 20% each, below the 25% warn line.
        rows = [
            row(i, i, value=100.0, cost=100.0, rwa_id=2 + i, issuer_id=name,
                issuer_name=name.title(), asset_type="stock")
            for i, name in enumerate("abcde")
        ]
        self.assertIsNone(self._flag("issuer_concentration", rows))

    def test_unpriced_flag(self):
        self.assertIsNotNone(self._flag("untracked", BOOK))

    def test_same_asset_many_wrappers(self):
        f = self._flag("same_asset_many_wrappers", BOOK)
        self.assertIsNotNone(f)
        self.assertIn("3 wrappers", f["title"])

    def test_illiquid_flag(self):
        rows = [
            row(1, 1, value=1000.0, cost=1000.0, rwa_id=2, issuer_id="a",
                issuer_name="A", asset_type="stock", volume_24h=500.0),
            row(2, 2, value=1000.0, cost=1000.0, rwa_id=3, issuer_id="b",
                issuer_name="B", asset_type="stock", volume_24h=5_000_000.0),
        ]
        f = self._flag("illiquid", rows)
        self.assertEqual(f["level"], "warn")


if __name__ == "__main__":
    unittest.main()
