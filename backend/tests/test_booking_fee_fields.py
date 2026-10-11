"""Bug #4 (backend) — BookingOut must expose platform_fee_inr,
platform_fee_waived, grand_total_inr on:
  - POST /api/bookings (pay-at-venue / free booking)
  - GET /api/bookings/me (all persisted bookings)

Uses a fresh consumer + a fresh free event owned by a fresh organizer so
we don't touch seeded demo data.
"""
import os
import uuid
import pytest
import requests

BASE_URL = os.environ["EXPO_PUBLIC_BACKEND_URL"].rstrip("/")
API = f"{BASE_URL}/api"


def _register(role: str):
    email = f"TEST_bf_{role[0]}_{uuid.uuid4().hex[:8]}@example.com"
    body = {"email": email, "password": "pass1234", "name": f"BF {role}", "role": role}
    r = requests.post(f"{API}/auth/register", json=body, timeout=15)
    assert r.status_code in (200, 201), r.text
    tok = r.json()["access_token"]
    return {"token": tok, "email": email, "headers": {"Authorization": f"Bearer {tok}"}}


@pytest.fixture(scope="module")
def fresh_consumer():
    return _register("consumer")


@pytest.fixture(scope="module")
def fresh_organizer():
    return _register("organizer")


@pytest.fixture(scope="module")
def free_event(fresh_organizer):
    """Create a completely FREE event (price=0) so the booking flow does
    not need to hit the Razorpay flow. Keeps the test hermetic even in
    paid-tier .env because a free booking has no platform fee to charge."""
    from datetime import datetime, timedelta, timezone
    start = (datetime.now(timezone.utc) + timedelta(days=7)).isoformat()
    end = (datetime.now(timezone.utc) + timedelta(days=7, hours=2)).isoformat()
    body = {
        "title": f"TEST_bf_free_{uuid.uuid4().hex[:6]}",
        "description": "Booking-fee-fields test event",
        "category": "Workshop",
        "start_date": start,
        "end_date": end,
        "address": "Test Venue, Bengaluru",
        "location_name": "Test Venue",
        "latitude": 12.9716,
        "longitude": 77.5946,
        "capacity": 50,
        "total_seats": 50,
        "booking_type": "general",
        "ticket_tiers": [{"name": "General", "price": 0, "quantity": 50}],
    }
    r = requests.post(f"{API}/events", json=body, headers=fresh_organizer["headers"], timeout=15)
    assert r.status_code in (200, 201), r.text
    ev = r.json()
    return ev


class TestBookingResponseHasFeeFields:
    """POST /api/bookings response must include the three new fields."""

    def test_free_booking_response_shape(self, fresh_consumer, free_event):
        body = {
            "event_id": free_event["id"],
            "num_seats": 1,
        }
        r = requests.post(f"{API}/bookings", json=body, headers=fresh_consumer["headers"], timeout=15)
        assert r.status_code in (200, 201), r.text
        booking = r.json()

        # Field presence
        assert "platform_fee_inr" in booking, "BookingOut missing platform_fee_inr"
        assert "platform_fee_waived" in booking, "BookingOut missing platform_fee_waived"
        assert "grand_total_inr" in booking, "BookingOut missing grand_total_inr"

        # Free (₹0) booking: no fee is charged even in paid tier — 0-price
        # events skip the fee entirely; total_price=0 → grand_total_inr=0.
        assert booking["total_price"] == 0
        assert booking["platform_fee_inr"] == 0
        # grand_total should equal total_price when there's no fee.
        assert booking["grand_total_inr"] == booking["total_price"]

    def test_my_bookings_carries_fee_fields(self, fresh_consumer):
        r = requests.get(f"{API}/bookings/me", headers=fresh_consumer["headers"], timeout=15)
        assert r.status_code == 200
        rows = r.json()
        assert isinstance(rows, list) and len(rows) >= 1, "Expected at least one booking from earlier test"
        for b in rows:
            assert "platform_fee_inr" in b
            assert "platform_fee_waived" in b
            assert "grand_total_inr" in b
            # grand_total is always numeric (defaulted from total_price + fee).
            assert b["grand_total_inr"] is not None
            expected = b["total_price"] + (b["platform_fee_inr"] or 0)
            assert abs(b["grand_total_inr"] - expected) < 0.01, (
                f"grand_total_inr={b['grand_total_inr']} != total_price+fee={expected}"
            )


class TestSeededDemoBookingsBackwardsCompat:
    """Existing seeded bookings (which may pre-date the new fields on the
    stored doc) should still serialize cleanly with defaulted values —
    verifies the `b.get(..., default)` fallbacks in list_bookings."""

    def test_demo_consumer_bookings_still_load(self):
        # Log in as the seeded demo consumer.
        r = requests.post(
            f"{API}/auth/login",
            json={"email": "demo@consumer.com", "password": "password123"},
            timeout=15,
        )
        if r.status_code != 200:
            pytest.skip(f"demo@consumer.com not seeded: {r.status_code}")
        tok = r.json()["access_token"]
        r = requests.get(
            f"{API}/bookings/me",
            headers={"Authorization": f"Bearer {tok}"},
            timeout=15,
        )
        assert r.status_code == 200
        rows = r.json()
        # Even if empty this shouldn't 500; if non-empty, every row must
        # have the new fields with sane defaults.
        for b in rows[:20]:
            assert "platform_fee_inr" in b
            assert "platform_fee_waived" in b
            assert "grand_total_inr" in b
            assert b["grand_total_inr"] is not None
