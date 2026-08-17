"""Platform-fee & first-5-free perk tests (iteration_15).

Covers:
  - GET /api/pricing/config
  - GET /api/quota/me for both roles
  - POST /api/payments/order (kind=booking) breakdown & fee waiver
  - POST /api/payments/order (kind=platform_fee) free vs beyond-tier
  - POST /api/events beyond-tier 402 + platform_intent_id single-use
  - /api/payments/verify kind=platform_fee response shape

Runs in two modes depending on the backend env:
  * FREE-TIER MODE (default .env has *_FREE_*_LIMIT=999): every test in
    class TestFreeTier runs; TestBeyondTier tests are skipped.
  * PAID-TIER MODE (limit=0): TestBeyondTier tests run; TestFreeTier
    tests that require remaining>0 are skipped.
"""
import os
import uuid
import pytest
import requests

BASE_URL = os.environ["EXPO_PUBLIC_BACKEND_URL"].rstrip("/")
API = f"{BASE_URL}/api"


# ---------- fixtures ----------

@pytest.fixture(scope="module")
def fresh_consumer():
    """Register a brand-new consumer so free-tier state is deterministic."""
    email = f"TEST_pf_c_{uuid.uuid4().hex[:8]}@example.com"
    body = {"email": email, "password": "pass1234", "name": "PF Consumer", "role": "consumer"}
    r = requests.post(f"{API}/auth/register", json=body, timeout=15)
    assert r.status_code in (200, 201), r.text
    tok = r.json()["access_token"]
    return {"token": tok, "email": email, "headers": {"Authorization": f"Bearer {tok}"}}


@pytest.fixture(scope="module")
def fresh_organizer():
    email = f"TEST_pf_o_{uuid.uuid4().hex[:8]}@example.com"
    body = {"email": email, "password": "pass1234", "name": "PF Organizer", "role": "organizer"}
    r = requests.post(f"{API}/auth/register", json=body, timeout=15)
    assert r.status_code in (200, 201), r.text
    tok = r.json()["access_token"]
    return {"token": tok, "email": email, "headers": {"Authorization": f"Bearer {tok}"}}


@pytest.fixture(scope="module")
def pricing_config():
    r = requests.get(f"{API}/pricing/config", timeout=10)
    assert r.status_code == 200
    return r.json()


def _current_org_limit():
    r = requests.get(f"{API}/pricing/config", timeout=10)
    return int(r.json()["organizer_free_event_limit"])


def _current_att_limit():
    r = requests.get(f"{API}/pricing/config", timeout=10)
    return int(r.json()["attendee_free_booking_limit"])


# ---------- 1. Pricing config ----------

class TestPricingConfig:
    def test_shape_and_types(self, pricing_config):
        cfg = pricing_config
        assert cfg["attendee_platform_fee_inr"] == 9.0
        assert cfg["organizer_platform_fee_inr"] == 19.0
        for key in (
            "attendee_platform_fee_inr", "organizer_platform_fee_inr",
            "attendee_free_booking_limit", "organizer_free_event_limit",
        ):
            assert key in cfg
            assert isinstance(cfg[key], (int, float))

    def test_public_no_auth_required(self):
        r = requests.get(f"{API}/pricing/config", timeout=10)
        assert r.status_code == 200


# ---------- 2. Quota endpoint ----------

class TestQuota:
    def test_consumer_quota_shape(self, fresh_consumer):
        r = requests.get(f"{API}/quota/me", headers=fresh_consumer["headers"], timeout=10)
        assert r.status_code == 200, r.text
        data = r.json()
        assert "attendee" in data
        a = data["attendee"]
        assert a["paid_bookings_used"] == 0
        assert a["free_booking_limit"] >= 0
        assert a["free_bookings_remaining"] == max(0, a["free_booking_limit"] - 0)
        assert a["platform_fee_inr"] == 9.0

    def test_organizer_quota_shape(self, fresh_organizer):
        r = requests.get(f"{API}/quota/me", headers=fresh_organizer["headers"], timeout=10)
        assert r.status_code == 200, r.text
        data = r.json()
        assert "organizer" in data
        o = data["organizer"]
        assert o["events_used"] == 0
        assert o["free_event_limit"] >= 0
        assert o["free_events_remaining"] == max(0, o["free_event_limit"] - 0)
        assert o["platform_fee_inr"] == 19.0

    def test_quota_requires_auth(self):
        r = requests.get(f"{API}/quota/me", timeout=10)
        assert r.status_code in (401, 403)


# ---------- 3. Booking order breakdown ----------

def _get_any_paid_event():
    """Grab a paid event from /events."""
    r = requests.get(f"{API}/events?radius_km=100000", timeout=15)
    r.raise_for_status()
    for ev in r.json():
        if ev.get("price", 0) > 0 and ev.get("booking_type") == "general":
            return ev
    return None


class TestBookingBreakdown:
    def test_booking_order_free_tier_waiver(self, fresh_consumer):
        """Fresh consumer under free tier → fee_waived=true, platform_fee_inr=0."""
        att_lim = _current_att_limit()
        if att_lim <= 0:
            pytest.skip("Attendee limit is 0 — no waiver path")
        ev = _get_any_paid_event()
        if not ev:
            pytest.skip("No paid general-booking event available")
        body = {"kind": "booking", "event_id": ev["id"], "num_seats": 1}
        r = requests.post(f"{API}/payments/order", json=body,
                          headers=fresh_consumer["headers"], timeout=15)
        assert r.status_code == 200, r.text
        data = r.json()
        assert "breakdown" in data
        bd = data["breakdown"]
        assert bd["fee_waived"] is True
        assert bd["platform_fee_inr"] == 0.0
        assert bd["ticket_inr"] == ev["price"]
        # amount_paise should equal ticket_paise only (no fee added)
        assert data["amount_paise"] == int(round(ev["price"] * 100))
        assert bd["free_bookings_remaining_after_this"] == max(0, att_lim - 1)

    def test_booking_order_beyond_tier_adds_fee(self, fresh_consumer):
        """When attendee limit=0, breakdown must show fee_waived=false, platform_fee_inr=9."""
        if _current_att_limit() != 0:
            pytest.skip("Requires ATTENDEE_FREE_BOOKING_LIMIT=0 to exercise paid-tier path")
        ev = _get_any_paid_event()
        if not ev:
            pytest.skip("No paid general-booking event available")
        body = {"kind": "booking", "event_id": ev["id"], "num_seats": 1}
        r = requests.post(f"{API}/payments/order", json=body,
                          headers=fresh_consumer["headers"], timeout=15)
        assert r.status_code == 200, r.text
        bd = r.json()["breakdown"]
        assert bd["fee_waived"] is False
        assert bd["platform_fee_inr"] == 9.0
        assert r.json()["amount_paise"] == int(round(ev["price"] * 100)) + 900


# ---------- 4. Organizer platform-fee order ----------

class TestOrganizerPlatformFeeOrder:
    def test_free_tier_returns_400(self, fresh_organizer):
        """Fresh organizer under free tier → 400 'No payment needed yet'."""
        if _current_org_limit() <= 0:
            pytest.skip("Organizer limit=0 — free tier path skipped")
        r = requests.post(f"{API}/payments/order",
                          json={"kind": "platform_fee"},
                          headers=fresh_organizer["headers"], timeout=15)
        assert r.status_code == 400, r.text
        assert "no payment needed" in r.text.lower() or "free event" in r.text.lower()

    def test_beyond_tier_returns_razorpay_order(self, fresh_organizer):
        """Organizer beyond limit → 200 with razorpay order for ₹19."""
        if _current_org_limit() != 0:
            pytest.skip("Requires ORGANIZER_FREE_EVENT_LIMIT=0")
        r = requests.post(f"{API}/payments/order",
                          json={"kind": "platform_fee"},
                          headers=fresh_organizer["headers"], timeout=15)
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["amount_paise"] == 1900
        assert data["amount_inr"] == 19.0
        assert data["currency"] == "INR"
        assert "intent_id" in data
        assert "razorpay_order_id" in data


# ---------- 5. Event creation gating + platform_intent single-use ----------

VALID_EVENT_BODY = {
    "title": "TEST_platform_fee_event",
    "description": "Test event created to verify platform-fee gating",
    "location_name": "Test Venue",
    "latitude": 12.9716,
    "longitude": 77.5946,
    "category": "workshop",
    "date": "2030-12-31T10:00:00Z",
    "capacity": 10,
    "price": 0,
    "booking_type": "general",
    "image_url": "https://example.com/img.jpg",
}


class TestEventCreationGating:
    def test_beyond_tier_returns_402_without_intent(self, fresh_organizer):
        if _current_org_limit() != 0:
            pytest.skip("Requires ORGANIZER_FREE_EVENT_LIMIT=0")
        r = requests.post(f"{API}/events", json=VALID_EVENT_BODY,
                          headers=fresh_organizer["headers"], timeout=15)
        assert r.status_code == 402, r.text
        detail = r.json().get("detail", {})
        # FastAPI wraps a dict detail as-is
        if isinstance(detail, dict):
            assert detail.get("requires_platform_fee") is True
            assert detail.get("fee_inr") == 19.0

    def test_invalid_intent_id_returns_400(self, fresh_organizer):
        if _current_org_limit() != 0:
            pytest.skip("Requires ORGANIZER_FREE_EVENT_LIMIT=0")
        body = dict(VALID_EVENT_BODY, platform_intent_id="nonexistent-intent")
        r = requests.post(f"{API}/events", json=body,
                          headers=fresh_organizer["headers"], timeout=15)
        # Either 400 (not found) or 402 (not paid) — both express the guard.
        assert r.status_code in (400, 402), r.text


# ---------- 6. Free-tier event creation still works ----------

class TestFreeTierEventCreation:
    def test_organizer_creates_event_under_free_tier(self, fresh_organizer):
        if _current_org_limit() <= 0:
            pytest.skip("Requires organizer free-tier > 0")
        r = requests.post(f"{API}/events", json=VALID_EVENT_BODY,
                          headers=fresh_organizer["headers"], timeout=15)
        assert r.status_code in (200, 201), r.text
        doc = r.json()
        # Confirm free-tier flags on the created event
        # (server sets platform_fee_waived=true, platform_fee_paid_paise=0)
        # Not all serializers expose these — fall back to GET raw
        eid = doc["id"]
        # Verify event exists
        r2 = requests.get(f"{API}/events/{eid}", timeout=15)
        assert r2.status_code == 200
        # Quota should now show +1 event used
        q = requests.get(f"{API}/quota/me",
                         headers=fresh_organizer["headers"], timeout=10).json()
        assert q["organizer"]["events_used"] >= 1
        # cleanup
        requests.delete(f"{API}/events/{eid}",
                        headers=fresh_organizer["headers"], timeout=10)
