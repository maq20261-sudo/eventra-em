"""Boost prices must come from one place: /pricing/config exposes the same
table the server charges from (FEATURE_TIERS). The app's Boost sheet renders
these values, so a mismatch would show one price and charge another."""
import os

import requests

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "http://localhost:8001").rstrip("/")


def test_pricing_config_exposes_boost_tiers():
    r = requests.get(f"{BASE_URL}/api/pricing/config", timeout=15)
    assert r.status_code == 200
    tiers = r.json().get("boost_tiers")
    assert isinstance(tiers, list)
    by_key = {t["key"]: t for t in tiers}
    assert set(by_key) == {"24h", "7d", "30d"}
    for t in tiers:
        assert isinstance(t["price_inr"], (int, float)) and t["price_inr"] > 0
        assert t["hours"] > 0
    # Longer boosts cost more.
    assert by_key["24h"]["price_inr"] < by_key["7d"]["price_inr"] < by_key["30d"]["price_inr"]


def test_boost_tiers_match_server_charge_table():
    import sys
    from pathlib import Path

    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
    from server import FEATURE_TIERS  # noqa: E402

    r = requests.get(f"{BASE_URL}/api/pricing/config", timeout=15)
    tiers = {t["key"]: t["price_inr"] for t in r.json()["boost_tiers"]}
    assert tiers == {k: v["price"] for k, v in FEATURE_TIERS.items()}
