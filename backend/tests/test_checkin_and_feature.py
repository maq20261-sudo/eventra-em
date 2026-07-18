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
    def test_boost_event_success(self, api, organizer_headers, owned_event):
        r = api.post(f"{BASE_URL}/api/events/{owned_event['id']}/feature",
                     json={"tier": "24h"}, headers=organizer_headers)
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["ok"] is True
        assert data["amount_charged"] == 4.99
        assert data["featured_until"]
        # verify future
        fu = datetime.fromisoformat(data["featured_until"])
        assert fu > datetime.now(timezone.utc)
        pytest.first_featured_until = data["featured_until"]

        # verify is_featured true on event
        g = api.get(f"{BASE_URL}/api/events/{owned_event['id']}")
        assert g.status_code == 200
        assert g.json()["is_featured"] is True
        assert g.json()["featured_until"] == data["featured_until"]

    def test_boost_stacks_time(self, api, organizer_headers, owned_event):
        # Second boost with 7d should extend from previous featured_until, not now
        prev = datetime.fromisoformat(pytest.first_featured_until)
        r = api.post(f"{BASE_URL}/api/events/{owned_event['id']}/feature",
                     json={"tier": "7d"}, headers=organizer_headers)
        assert r.status_code == 200, r.text
        data = r.json()
        new_until = datetime.fromisoformat(data["featured_until"])
        # 7 days = 168 hours added on top of prev; should be within a few seconds
        delta_hours = (new_until - prev).total_seconds() / 3600
        assert 167.5 < delta_hours < 168.5, f"expected ~168h stack, got {delta_hours}"

    def test_boost_wrong_organizer(self, api, other_organizer, owned_event):
        r = api.post(f"{BASE_URL}/api/events/{owned_event['id']}/feature",
                     json={"tier": "24h"}, headers=other_organizer["headers"])
        assert r.status_code == 403

    def test_boost_consumer_forbidden(self, api, consumer_headers, owned_event):
        r = api.post(f"{BASE_URL}/api/events/{owned_event['id']}/feature",
                     json={"tier": "24h"}, headers=consumer_headers)
        assert r.status_code == 403

    def test_featured_event_appears_first(self, api, owned_event):
        # Query events at same location — our boosted event should be first
        r = api.get(f"{BASE_URL}/api/events",
                    params={"lat": SF_LAT, "lng": SF_LNG, "radius_km": 20})
        assert r.status_code == 200
        events = r.json()
        assert len(events) >= 2
        # Find our event
        our = next((e for e in events if e["id"] == owned_event["id"]), None)
        assert our is not None, "boosted event not in list"
        assert our["is_featured"] is True
        # It must be at position 0 (or at least before any non-featured)
        assert events[0]["id"] == owned_event["id"], \
            f"expected boosted event first, got {events[0]['id']} vs {owned_event['id']}"
        assert events[0]["is_featured"] is True
