"""
Iteration 16 — Past events + created_at DESC ordering.

Covers:
  - Discover feed: future-only by default, sorted by created_at DESC
    (with featured on top within their bucket).
  - only_past=true returns only ended events.
  - include_past=true returns both.
  - Each event includes `is_past` boolean.
  - Event detail exposes is_past=true when ended.
  - Booking + payment/order on a past event → HTTP 400 with the
    "already ended" message.
  - Organizer /organizer/events sorted by created_at DESC, each with is_past.
"""
import os
import time
import uuid
from datetime import datetime, timedelta, timezone

import pytest
import requests

BASE_URL = os.environ["EXPO_PUBLIC_BACKEND_URL"].rstrip("/")

PAST_ENDED_MSG = "This event has already ended and is no longer accepting bookings."


# ---------- helpers ----------

def _iso(dt: datetime) -> str:
    return dt.astimezone(timezone.utc).isoformat()


def _make_event_payload(title_suffix: str, *, start_offset_h: int, end_offset_h: int):
    """Payload for a general-admission (paid_flat) event."""
    now = datetime.now(timezone.utc)
    return {
        "title": f"TEST_{title_suffix}_{uuid.uuid4().hex[:6]}",
        "description": "Iteration 16 past-events regression test",
        "category": "Music",
        "latitude": 12.9716,
        "longitude": 77.5946,
        "address": "Bengaluru, IN",
        "location_name": "Test Venue",
        "date": _iso(now + timedelta(hours=start_offset_h)),
        "start_date": _iso(now + timedelta(hours=start_offset_h)),
        "end_date": _iso(now + timedelta(hours=end_offset_h)),
        "capacity": 50,
        "price": 100,
        "booking_type": "general",
        "image_url": "",
    }


# ---------- fixtures for created events ----------

@pytest.fixture(scope="module")
def organizer_headers_mod():
    r = requests.post(
        f"{BASE_URL}/api/auth/login",
        json={"email": "demo@organizer.com", "password": "password123", "role": "organizer"},
        timeout=15,
    )
    r.raise_for_status()
    return {
        "Authorization": f"Bearer {r.json()['access_token']}",
        "Content-Type": "application/json",
    }


@pytest.fixture(scope="module")
def consumer_headers_mod():
    r = requests.post(
        f"{BASE_URL}/api/auth/login",
        json={"email": "demo@consumer.com", "password": "password123", "role": "consumer"},
        timeout=15,
    )
    r.raise_for_status()
    return {
        "Authorization": f"Bearer {r.json()['access_token']}",
        "Content-Type": "application/json",
    }


@pytest.fixture(scope="module")
def created_events(organizer_headers_mod):
    """Create one future + one past event via the API for deterministic tests."""
    future = _make_event_payload("FUTURE", start_offset_h=48, end_offset_h=52)
    past = _make_event_payload("PAST", start_offset_h=-48, end_offset_h=-24)

    r_future = requests.post(
        f"{BASE_URL}/api/events", json=future, headers=organizer_headers_mod, timeout=15
    )
    assert r_future.status_code in (200, 201), r_future.text
    future_evt = r_future.json()

    # A tiny sleep guarantees the "past" event has a strictly LATER created_at,
    # so we can validate the newest-first sort inside the past bucket too.
    time.sleep(1.1)

    r_past = requests.post(
        f"{BASE_URL}/api/events", json=past, headers=organizer_headers_mod, timeout=15
    )
    assert r_past.status_code in (200, 201), r_past.text
    past_evt = r_past.json()

    yield {"future": future_evt, "past": past_evt}

    # cleanup — best effort
    for e in (future_evt, past_evt):
        try:
            requests.delete(
                f"{BASE_URL}/api/events/{e['id']}",
                headers=organizer_headers_mod,
                timeout=10,
            )
        except Exception:
            pass


# ---------- discover feed ----------

class TestDiscoverFeed:
    def test_default_returns_future_only_and_sorted_created_at_desc(self, created_events):
        r = requests.get(f"{BASE_URL}/api/events", timeout=15)
        assert r.status_code == 200
        events = r.json()
        assert isinstance(events, list) and len(events) > 0

        # is_past flag present on every event
        for e in events:
            assert "is_past" in e, f"missing is_past: {e.get('id')}"

        # No past events in default feed
        assert all(not e["is_past"] for e in events), "Past events leaked into default feed"

        # created future test event is present
        ids = [e["id"] for e in events]
        assert created_events["future"]["id"] in ids

        # created_at DESC within each featured bucket. Split by is_featured
        # (featured first) and check monotonic-non-increasing created_at.
        featured = [e for e in events if e.get("is_featured")]
        non_featured = [e for e in events if not e.get("is_featured")]
        for bucket in (featured, non_featured):
            ts = [e.get("created_at", "") for e in bucket]
            assert ts == sorted(ts, reverse=True), f"created_at not DESC in bucket: {ts[:5]}"

        # Featured (if any) must appear before non-featured.
        if featured and non_featured:
            last_featured_idx = max(i for i, e in enumerate(events) if e.get("is_featured"))
            first_non_featured_idx = min(i for i, e in enumerate(events) if not e.get("is_featured"))
            assert last_featured_idx < first_non_featured_idx

    def test_only_past_returns_only_ended_events(self, created_events):
        r = requests.get(f"{BASE_URL}/api/events?only_past=true", timeout=15)
        assert r.status_code == 200
        events = r.json()
        assert isinstance(events, list) and len(events) > 0
        assert all(e["is_past"] for e in events), "only_past returned upcoming events"
        # Newly-created past event must be present.
        assert created_events["past"]["id"] in [e["id"] for e in events]
        # Seed states there are 9 past events; created adds 1 → expect >= 9.
        assert len(events) >= 9

    def test_include_past_returns_both(self, created_events):
        r = requests.get(f"{BASE_URL}/api/events?include_past=true", timeout=15)
        assert r.status_code == 200
        events = r.json()
        ids = {e["id"] for e in events}
        assert created_events["future"]["id"] in ids
        assert created_events["past"]["id"] in ids
        assert any(e["is_past"] for e in events)
        assert any(not e["is_past"] for e in events)


# ---------- event detail ----------

class TestEventDetail:
    def test_detail_is_past_true_for_past(self, created_events):
        eid = created_events["past"]["id"]
        r = requests.get(f"{BASE_URL}/api/events/{eid}", timeout=15)
        assert r.status_code == 200
        body = r.json()
        assert body.get("is_past") is True

    def test_detail_is_past_false_for_future(self, created_events):
        eid = created_events["future"]["id"]
        r = requests.get(f"{BASE_URL}/api/events/{eid}", timeout=15)
        assert r.status_code == 200
        assert r.json().get("is_past") is False


# ---------- booking blocked for past events ----------

class TestBookingsBlockedOnPast:
    def test_post_bookings_returns_400_on_past(self, created_events, consumer_headers_mod):
        payload = {"event_id": created_events["past"]["id"], "num_seats": 1}
        r = requests.post(
            f"{BASE_URL}/api/bookings", json=payload, headers=consumer_headers_mod, timeout=15
        )
        assert r.status_code == 400, r.text
        assert PAST_ENDED_MSG in r.json().get("detail", "")

    def test_payments_order_returns_400_on_past(self, created_events, consumer_headers_mod):
        payload = {
            "kind": "booking",
            "event_id": created_events["past"]["id"],
            "num_seats": 1,
        }
        r = requests.post(
            f"{BASE_URL}/api/payments/order",
            json=payload,
            headers=consumer_headers_mod,
            timeout=15,
        )
        assert r.status_code == 400, r.text
        assert PAST_ENDED_MSG in r.json().get("detail", "")


# ---------- organizer events endpoint ----------

class TestOrganizerEvents:
    def test_organizer_events_sorted_desc_and_has_is_past(
        self, created_events, organizer_headers_mod
    ):
        r = requests.get(
            f"{BASE_URL}/api/organizer/events", headers=organizer_headers_mod, timeout=15
        )
        assert r.status_code == 200
        events = r.json()
        assert isinstance(events, list) and len(events) >= 2

        # is_past on every event
        for e in events:
            assert "is_past" in e

        # created_at DESC (organizer endpoint has no featured bucketing)
        ts = [e.get("created_at", "") for e in events]
        assert ts == sorted(ts, reverse=True), f"organizer events not DESC: {ts[:5]}"

        # Our two created events are present with correct is_past values.
        by_id = {e["id"]: e for e in events}
        assert by_id[created_events["future"]["id"]]["is_past"] is False
        assert by_id[created_events["past"]["id"]]["is_past"] is True

        # Latest-created appears first — since we created past AFTER future,
        # the past one should show up earlier in the list than the future one.
        idx_future = next(i for i, e in enumerate(events) if e["id"] == created_events["future"]["id"])
        idx_past = next(i for i, e in enumerate(events) if e["id"] == created_events["past"]["id"])
        assert idx_past < idx_future
