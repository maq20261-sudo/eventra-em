"""PAYMENTS_ENABLED=0 ("coming soon" mode while Razorpay isn't live):

- config endpoints report payments off; only the free boost tier is usable
- no new checkout orders
- organizer publish fee is waived past the free tier; the attendee fee is not
  (it's collected at the venue)
- the 24h boost is free, once per active boost; other tiers are refused

Runs the app in-process with the switch flipped, against the test database.
"""
import asyncio
import os
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))


@pytest.fixture
def payments_off(monkeypatch):
    monkeypatch.setenv("PAYMENTS_ENABLED", "0")


@pytest.fixture
def client():
    """In-process app with a fresh Motor client (each TestClient has its own
    event loop; Motor binds to the loop it is first used on)."""
    from fastapi.testclient import TestClient
    from motor.motor_asyncio import AsyncIOMotorClient
    import server
    cl = AsyncIOMotorClient(os.environ["MONGO_URL"])
    # The app's shutdown hook closes `server.client`; swap it too so the
    # shared module client stays usable for later tests.
    original = (server.client, server.db)
    server.client, server.db = cl, cl[os.environ["DB_NAME"]]
    try:
        with TestClient(server.app) as tc:
            yield tc
    finally:
        server.client, server.db = original
        cl.close()


def _login(tc, email):
    r = tc.post("/api/auth/login", json={"email": email, "password": "password123"})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


def test_config_reports_payments_off(payments_off, client):
    cfg = client.get("/api/payments/config").json()
    assert cfg["enabled"] is False
    assert cfg["configured"] is False and cfg["key_id"] == ""

    pricing = client.get("/api/pricing/config").json()
    assert pricing["payments_enabled"] is False
    tiers = {t["key"]: t for t in pricing["boost_tiers"]}
    assert tiers["24h"]["available"] and tiers["24h"]["free"]
    assert not tiers["7d"]["available"] and not tiers["30d"]["available"]


def test_config_reports_payments_on_by_default(monkeypatch, client):
    monkeypatch.delenv("PAYMENTS_ENABLED", raising=False)
    assert client.get("/api/payments/config").json()["enabled"] is True
    tiers = client.get("/api/pricing/config").json()["boost_tiers"]
    assert all(t["available"] and not t["free"] for t in tiers)


def test_no_checkout_orders_when_off(payments_off, client):
    headers = _login(client, "demo@organizer.com")
    r = client.post("/api/payments/order", json={"kind": "platform_fee"}, headers=headers)
    assert r.status_code == 503
    assert "coming soon" in r.json()["detail"]


def test_quota_shows_publish_fee_waived(payments_off, client):
    headers = _login(client, "demo@organizer.com")
    q = client.get("/api/quota/me", headers=headers).json()
    assert q["payments_enabled"] is False
    assert q["organizer"]["fee_waived"] is True


def test_fees_when_off(payments_off, monkeypatch):
    import server

    async def many(_user_id):
        return 50

    # CI raises the organizer limit (ORGANIZER_FREE_EVENT_LIMIT=1000); pin both
    # so 50 is always past the free tier here.
    monkeypatch.setenv("ORGANIZER_FREE_EVENT_LIMIT", "5")
    monkeypatch.setenv("ATTENDEE_FREE_BOOKING_LIMIT", "5")
    monkeypatch.setattr(server, "_organizer_event_count", many)
    monkeypatch.setattr(server, "_attendee_paid_booking_count", many)

    org = asyncio.run(server._resolve_organizer_fee("u1"))
    assert org == {"fee_paise": 0, "waived": True, "reason": "payments_disabled", "used": 50, "remaining": 0}

    # The attendee fee still applies past the free tier (collected at the venue).
    att = asyncio.run(server._resolve_booking_fee("u1", 500.0))
    assert att["fee_paise"] == server.PLATFORM_FEE_ATTENDEE_PAISE and not att["waived"]

    monkeypatch.setenv("PAYMENTS_ENABLED", "1")
    org = asyncio.run(server._resolve_organizer_fee("u1"))
    assert org["fee_paise"] == server.PLATFORM_FEE_ORGANIZER_PAISE and not org["waived"]


def test_free_24h_boost_once_per_active_boost(payments_off, client):
    headers = _login(client, "demo@organizer.com")
    events = client.get("/api/organizer/events", headers=headers).json()
    assert events, "seeded organizer has no events"
    ev = events[0]

    def set_featured(value):
        from motor.motor_asyncio import AsyncIOMotorClient

        async def run():
            cl = AsyncIOMotorClient(os.environ["MONGO_URL"])
            try:
                await cl[os.environ["DB_NAME"]].events.update_one(
                    {"id": ev["id"]}, {"$set": {"featured_until": value}})
            finally:
                cl.close()
        asyncio.run(run())

    original = ev.get("featured_until")
    set_featured(None)
    try:
        r = client.post(f"/api/events/{ev['id']}/feature", json={"tier": "24h"}, headers=headers)
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["free"] is True and body["amount_charged"] == 0

        r = client.post(f"/api/events/{ev['id']}/feature", json={"tier": "24h"}, headers=headers)
        assert r.status_code == 409

        r = client.post(f"/api/events/{ev['id']}/feature", json={"tier": "7d"}, headers=headers)
        assert r.status_code == 403
    finally:
        set_featured(original)


def test_free_boost_rejects_other_organizers_event(payments_off, client):
    headers = _login(client, "demo@organizer.com")
    events = client.get("/api/events").json()
    mine = {e["id"] for e in client.get("/api/organizer/events", headers=headers).json()}
    other = next((e for e in events if e["id"] not in mine), None)
    if not other:
        pytest.skip("No event from another organizer seeded")
    r = client.post(f"/api/events/{other['id']}/feature", json={"tier": "24h"}, headers=headers)
    assert r.status_code == 403
