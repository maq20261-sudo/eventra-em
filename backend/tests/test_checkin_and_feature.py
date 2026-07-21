"""Tests for new features: QR check-in and Featured/Boosted events."""
import os
import uuid
import requests
import pytest
from datetime import datetime, timezone

BASE_URL = os.environ["EXPO_PUBLIC_BACKEND_URL"].rstrip("/")
SF_LAT, SF_LNG = 37.7749, -122.4194


# ---- Helpers / shared setup ----

@pytest.fixture(scope="module")
def other_organizer(api):
    """A second organizer used for cross-organizer 403 tests."""
    email = f"other_org_{uuid.uuid4().hex[:8]}@test.com"
    r = api.post(f"{BASE_URL}/api/auth/register", json={
        "email": email, "password": "password123",
        "name": "Other Organizer", "role": "organizer"
    })
    assert r.status_code == 200, r.text
    data = r.json()
    return {
        "headers": {"Authorization": f"Bearer {data['access_token']}"},
        "user": data["user"],
    }


@pytest.fixture(scope="module")
def owned_event(api, organizer_headers):
    """Create a general event owned by demo organizer."""
    payload = {
        "title": "TEST Checkin Event",
        "description": "For checkin/feature tests",
        "category": "Music",
        "date": "2026-08-01T18:00:00Z",
        "location_name": "TEST Venue Checkin",
        "latitude": SF_LAT, "longitude": SF_LNG,
        "price": 20.0,
        "booking_type": "general",
        "total_seats": 20,
    }
    r = api.post(f"{BASE_URL}/api/events", json=payload, headers=organizer_headers)
    assert r.status_code == 200, r.text
    event = r.json()
    yield event
    # cleanup
    api.delete(f"{BASE_URL}/api/events/{event['id']}", headers=organizer_headers)


@pytest.fixture(scope="module")
def consumer_booking(api, consumer_headers, owned_event):
    """Create a confirmed booking as consumer."""
    r = api.post(f"{BASE_URL}/api/bookings",
                 json={"event_id": owned_event["id"], "num_seats": 2},
                 headers=consumer_headers)
    assert r.status_code == 200, r.text
    return r.json()


@pytest.fixture(scope="module")
def cancelled_booking(api, consumer_headers, owned_event):
    r = api.post(f"{BASE_URL}/api/bookings",
                 json={"event_id": owned_event["id"], "num_seats": 1},
                 headers=consumer_headers)
    assert r.status_code == 200
    bid = r.json()["id"]
    c = api.post(f"{BASE_URL}/api/bookings/{bid}/cancel", headers=consumer_headers)
    assert c.status_code == 200
    return {"id": bid}


# ---- Check-in ----

class TestCheckIn:
    def test_checkin_success(self, api, organizer_headers, consumer_booking, owned_event):
        r = api.post(f"{BASE_URL}/api/checkin",
                     json={"booking_id": consumer_booking["id"]},
                     headers=organizer_headers)
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["ok"] is True
        assert data["already_checked_in"] is False
        assert data["event_title"] == owned_event["title"]
        assert data.get("attendee_name")  # non-empty
        assert data["booking"]["checked_in"] is True
        assert data["booking"]["status"] == "checked_in"
        assert data["checked_in_at"]

    def test_checkin_idempotent(self, api, organizer_headers, consumer_booking):
        # Second scan - already checked in
        r = api.post(f"{BASE_URL}/api/checkin",
                     json={"booking_id": consumer_booking["id"]},
                     headers=organizer_headers)
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["ok"] is True
        assert data["already_checked_in"] is True

    def test_checkin_not_found(self, api, organizer_headers):
        r = api.post(f"{BASE_URL}/api/checkin",
                     json={"booking_id": "does-not-exist-xyz"},
                     headers=organizer_headers)
        assert r.status_code == 404

    def test_checkin_cancelled_booking(self, api, organizer_headers, cancelled_booking):
        r = api.post(f"{BASE_URL}/api/checkin",
                     json={"booking_id": cancelled_booking["id"]},
                     headers=organizer_headers)
        assert r.status_code == 400

    def test_checkin_wrong_organizer(self, api, other_organizer, consumer_booking):
        r = api.post(f"{BASE_URL}/api/checkin",
                     json={"booking_id": consumer_booking["id"]},
                     headers=other_organizer["headers"])
        assert r.status_code == 403

    def test_checkin_consumer_forbidden(self, api, consumer_headers, consumer_booking):
        r = api.post(f"{BASE_URL}/api/checkin",
                     json={"booking_id": consumer_booking["id"]},
                     headers=consumer_headers)
        assert r.status_code == 403


# ---- Analytics reflects check-in ----

class TestAnalyticsCheckedIn:
    def test_checked_in_tickets_field(self, api, organizer_headers, consumer_booking):
        # consumer_booking has num_seats=2 and was checked in
        r = api.get(f"{BASE_URL}/api/analytics/organizer", headers=organizer_headers)
        assert r.status_code == 200
        data = r.json()
        assert "checked_in_tickets" in data
        assert data["checked_in_tickets"] >= 2


# ---- Feature tiers ----

class TestFeatureTiers:
    def test_get_feature_tiers(self, api, owned_event):
        r = api.get(f"{BASE_URL}/api/events/{owned_event['id']}/feature-tiers")
        assert r.status_code == 200, r.text
        data = r.json()
        for k in ("24h", "7d", "30d"):
            assert k in data, f"tier {k} missing"
            assert "price" in data[k]
            assert "label" in data[k]
            assert isinstance(data[k]["price"], (int, float))


# ---- Feature/boost event ----

class TestFeatureEvent:
    """SEC-001 fix: /feature endpoint no longer grants free boosts.
    Real boosts must go through /payments/create_order + /payments/verify
    (covered in test_payments.py). These tests verify the endpoint is
    disabled for both organizers (402) and consumers (403 via role check).
    """

    def test_boost_endpoint_requires_payment(self, api, organizer_headers, owned_event):
        r = api.post(f"{BASE_URL}/api/events/{owned_event['id']}/feature",
                     json={"tier": "24h"}, headers=organizer_headers)
        # 402 Payment Required — organizer cannot boost without paying
        assert r.status_code == 402, r.text
        # Event should NOT be featured
        g = api.get(f"{BASE_URL}/api/events/{owned_event['id']}")
        assert g.status_code == 200
        assert g.json().get("is_featured") is False

    def test_boost_wrong_organizer(self, api, other_organizer, owned_event):
        r = api.post(f"{BASE_URL}/api/events/{owned_event['id']}/feature",
                     json={"tier": "24h"}, headers=other_organizer["headers"])
        # Now returns 402 (payment required) - ownership check is moot when the
        # endpoint is universally gated.
        assert r.status_code == 402

    def test_boost_consumer_forbidden(self, api, consumer_headers, owned_event):
        r = api.post(f"{BASE_URL}/api/events/{owned_event['id']}/feature",
                     json={"tier": "24h"}, headers=consumer_headers)
        # Role check runs first — consumer still gets 403.
        assert r.status_code == 403
