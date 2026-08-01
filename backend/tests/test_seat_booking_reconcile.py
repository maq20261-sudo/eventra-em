"""Regression tests for the seat-booking false-409 (drift) fix.

The bug: `event.booked_seats` array could drift from the `bookings` collection
(source of truth), causing the atomic booking guard to reject seats the frontend
seat-map correctly displays as available.

The fix (server.py):
  1) `_reconcile_event_availability()` rebuilds `booked_seats`, `booked_slots`,
     `booked_count` from `bookings` collection.
  2) Called in `GET /api/events/{id}/booked-seats` (self-heal on read).
  3) Called in `_perform_booking` after the atomic guard's first failure, then
     retries once (drift heals, real conflicts still fail).
  4) Startup routine reconciles ALL events every restart.

These tests verify:
  - Happy path: multi-seat booking on seat_map event succeeds (bug repro).
  - True seat conflict on seat_map still returns 409.
  - Drift heal-and-retry: injecting bogus seats into event.booked_seats does NOT
    prevent booking a real available seat; and a truly-taken seat still 409s.
  - general over-capacity still returns 409.
  - time_slot double-book still returns 409.
  - GET /api/events/{id}/booked-seats returns data consistent with the atomic
    guard (self-heal on read).
"""

import os
import uuid
from datetime import datetime, timezone, timedelta

import pytest
import requests
from pymongo import MongoClient
from dotenv import load_dotenv
from pathlib import Path

# Load frontend .env for BASE_URL (public API URL)
load_dotenv(Path(__file__).parent.parent.parent / "frontend" / ".env")
# Load backend .env for MONGO_URL/DB_NAME (for direct DB drift injection)
load_dotenv(Path(__file__).parent.parent / ".env")

BASE_URL = os.environ["EXPO_PUBLIC_BACKEND_URL"].rstrip("/")
MONGO_URL = os.environ["MONGO_URL"]
DB_NAME = os.environ["DB_NAME"]


# ---------------- helpers ----------------

def _login(email, password):
    r = requests.post(f"{BASE_URL}/api/auth/login", json={"email": email, "password": password})
    r.raise_for_status()
    return r.json()


def _headers(tok):
    return {"Authorization": f"Bearer {tok['access_token']}", "Content-Type": "application/json"}


def _register_consumer():
    """Create a fresh consumer to avoid duplicate-booking edge cases from demo user."""
    email = f"test_seat_{uuid.uuid4().hex[:10]}@example.com"
    r = requests.post(
        f"{BASE_URL}/api/auth/register",
        json={"email": email, "password": "password123", "name": "Seat Tester", "role": "consumer"},
    )
    r.raise_for_status()
    return r.json(), email


@pytest.fixture(scope="module")
def organizer_tok():
    return _login("demo@organizer.com", "password123")


@pytest.fixture(scope="module")
def consumer_a():
    tok, _ = _register_consumer()
    return tok


@pytest.fixture(scope="module")
def consumer_b():
    tok, _ = _register_consumer()
    return tok


def _create_seatmap_event(organizer_tok, title_suffix=""):
    payload = {
        "title": f"TEST_Karate Championship {title_suffix} {uuid.uuid4().hex[:6]}",
        "description": "TEST event for seat-booking regression",
        "category": "Sports",
        "date": (datetime.now(timezone.utc) + timedelta(days=7)).isoformat(),
        "location_name": "Test Arena",
        "latitude": 12.9716,
        "longitude": 77.5946,
        "price": 100.0,
        "booking_type": "seat_map",
        "seat_rows": 6,
        "seat_cols": 8,
    }
    r = requests.post(f"{BASE_URL}/api/events", json=payload, headers=_headers(organizer_tok))
    assert r.status_code in (200, 201), f"create failed: {r.status_code} {r.text}"
    return r.json()


def _create_general_event(organizer_tok, capacity=3):
    payload = {
        "title": f"TEST_General {uuid.uuid4().hex[:6]}",
        "description": "TEST general-admission",
        "category": "Music",
        "date": (datetime.now(timezone.utc) + timedelta(days=7)).isoformat(),
        "location_name": "Test Hall",
        "latitude": 12.9716,
        "longitude": 77.5946,
        "price": 50.0,
        "booking_type": "general",
        "total_seats": capacity,
    }
    r = requests.post(f"{BASE_URL}/api/events", json=payload, headers=_headers(organizer_tok))
    assert r.status_code in (200, 201), r.text
    return r.json()


def _create_timeslot_event(organizer_tok):
    payload = {
        "title": f"TEST_TimeSlot {uuid.uuid4().hex[:6]}",
        "description": "TEST time-slot",
        "category": "Other",
        "date": (datetime.now(timezone.utc) + timedelta(days=7)).isoformat(),
        "location_name": "Test Room",
        "latitude": 12.9716,
        "longitude": 77.5946,
        "price": 25.0,
        "booking_type": "time_slot",
        "time_slots": ["10:00", "11:00", "12:00"],
    }
    r = requests.post(f"{BASE_URL}/api/events", json=payload, headers=_headers(organizer_tok))
    assert r.status_code in (200, 201), r.text
    return r.json()


# ---------------- tests ----------------

class TestSeatMapBookingHappyPath:
    """Bug reproduction: multiple seats book successfully — no false 409."""

    def test_book_two_arbitrary_seats_succeeds(self, organizer_tok, consumer_a):
        event = _create_seatmap_event(organizer_tok, "happy")
        r = requests.post(
            f"{BASE_URL}/api/bookings",
            json={"event_id": event["id"], "seats": ["F4", "F8"]},
            headers=_headers(consumer_a),
        )
        assert r.status_code == 200, f"expected 200 got {r.status_code} — {r.text}"
        body = r.json()
        assert body["status"] == "confirmed"
        assert set(body["seats"]) == {"F4", "F8"}
        assert body["total_price"] == 200.0  # 2 * 100

    def test_booked_seats_endpoint_matches_reality(self, organizer_tok, consumer_a):
        event = _create_seatmap_event(organizer_tok, "consistency")
        # book 3 seats
        r = requests.post(
            f"{BASE_URL}/api/bookings",
            json={"event_id": event["id"], "seats": ["A1", "B2", "C3"]},
            headers=_headers(consumer_a),
        )
        assert r.status_code == 200, r.text
        # GET /booked-seats — must reflect exactly those seats
        r2 = requests.get(f"{BASE_URL}/api/events/{event['id']}/booked-seats")
        assert r2.status_code == 200
        data = r2.json()
        assert set(data["booked_seats"]) == {"A1", "B2", "C3"}
        # And an unrelated seat like F4 must be bookable
        r3 = requests.post(
            f"{BASE_URL}/api/bookings",
            json={"event_id": event["id"], "seats": ["F4"]},
            headers=_headers(consumer_a),
        )
        assert r3.status_code == 200, r3.text


class TestSeatMapTrueConflict:
    """Regression: true seat conflict still returns 409."""

    def test_second_user_booking_same_seat_returns_409(self, organizer_tok, consumer_a, consumer_b):
        event = _create_seatmap_event(organizer_tok, "conflict")
        # Consumer A books F1
        r1 = requests.post(
            f"{BASE_URL}/api/bookings",
            json={"event_id": event["id"], "seats": ["F1"]},
            headers=_headers(consumer_a),
        )
        assert r1.status_code == 200, r1.text
        # Consumer B tries same seat → 409
        r2 = requests.post(
            f"{BASE_URL}/api/bookings",
            json={"event_id": event["id"], "seats": ["F1"]},
            headers=_headers(consumer_b),
        )
        assert r2.status_code == 409, f"expected 409 got {r2.status_code} — {r2.text}"
        assert "seats were just booked" in r2.json().get("detail", "").lower() or "seats" in r2.json().get("detail", "").lower()

    def test_overlap_within_seat_set_returns_409(self, organizer_tok, consumer_a, consumer_b):
        event = _create_seatmap_event(organizer_tok, "overlap")
        r1 = requests.post(
            f"{BASE_URL}/api/bookings",
            json={"event_id": event["id"], "seats": ["D2", "D3"]},
            headers=_headers(consumer_a),
        )
        assert r1.status_code == 200, r1.text
        # Consumer B tries D3, D4 → overlap on D3 → 409
        r2 = requests.post(
            f"{BASE_URL}/api/bookings",
            json={"event_id": event["id"], "seats": ["D3", "D4"]},
            headers=_headers(consumer_b),
        )
        assert r2.status_code == 409, r2.text


class TestDriftHealAndRetry:
    """The core fix: inject bogus/stale seats into event.booked_seats via DB, then
    verify the API self-heals (booking a real available seat succeeds) while a
    truly-taken seat still 409s."""


    def test_drift_is_healed_on_booking_retry(self, organizer_tok, consumer_a):
        event = _create_seatmap_event(organizer_tok, "drift_heal")
        event_id = event["id"]

        # Inject bogus seats directly into the event doc (simulate drift/corruption)
        client = MongoClient(MONGO_URL)
        db = client[DB_NAME]
        try:
            db.events.update_one(
                {"id": event_id},
                {"$set": {"booked_seats": ["ZZ99", "F4", "F8", "A4", "C5", "F3"]}},
            )
            doc = db.events.find_one({"id": event_id}, {"_id": 0, "booked_seats": 1})
            assert set(doc["booked_seats"]) == {"ZZ99", "F4", "F8", "A4", "C5", "F3"}
        finally:
            client.close()

        # Now attempt to book F4 as a consumer — bookings collection has NO
        # real booking on F4, so the drift-retry path must heal and succeed.
        r = requests.post(
            f"{BASE_URL}/api/bookings",
            json={"event_id": event_id, "seats": ["F4"]},
            headers=_headers(consumer_a),
        )
        assert r.status_code == 200, f"drift retry did not heal — {r.status_code} {r.text}"
        assert set(r.json()["seats"]) == {"F4"}


    def test_get_booked_seats_self_heals_drift(self, organizer_tok):
        event = _create_seatmap_event(organizer_tok, "getheal")
        event_id = event["id"]

        client = MongoClient(MONGO_URL)
        db = client[DB_NAME]
        try:
            db.events.update_one(
                {"id": event_id},
                {"$set": {"booked_seats": ["BOGUS1", "BOGUS2"], "booked_count": 99}},
            )
            # GET the endpoint — should trigger self-heal
            r = requests.get(f"{BASE_URL}/api/events/{event_id}/booked-seats")
            assert r.status_code == 200
            assert r.json()["booked_seats"] == []  # no real bookings
            # Verify event doc was scrubbed
            doc = db.events.find_one({"id": event_id}, {"_id": 0})
            assert doc["booked_seats"] == []
            assert doc["booked_count"] == 0
        finally:
            client.close()


    def test_drift_heal_still_rejects_real_conflict(self, organizer_tok, consumer_a, consumer_b):
        """Even with bogus drift entries mixed in, a genuine conflict must still 409."""
        event = _create_seatmap_event(organizer_tok, "drift_real")
        event_id = event["id"]
        # Consumer A really books E5
        r1 = requests.post(
            f"{BASE_URL}/api/bookings",
            json={"event_id": event_id, "seats": ["E5"]},
            headers=_headers(consumer_a),
        )
        assert r1.status_code == 200, r1.text

        # Inject bogus drift into the event doc alongside the real E5
        client = MongoClient(MONGO_URL)
        db = client[DB_NAME]
        try:
            db.events.update_one(
                {"id": event_id},
                {"$set": {"booked_seats": ["ZZ99", "GARBAGE"]}},  # E5 removed to simulate drift
            )
        finally:
            client.close()

        # Consumer B tries E5 — heal should re-add E5 from bookings, then 409
        r2 = requests.post(
            f"{BASE_URL}/api/bookings",
            json={"event_id": event_id, "seats": ["E5"]},
            headers=_headers(consumer_b),
        )
        assert r2.status_code == 409, f"real conflict must still 409 — got {r2.status_code} {r2.text}"


class TestGeneralAdmissionCapacity:
    """Regression: general over-capacity still 409s."""

    def test_over_capacity_returns_409(self, organizer_tok, consumer_a, consumer_b):
        event = _create_general_event(organizer_tok, capacity=3)
        # Consumer A books 2
        r1 = requests.post(
            f"{BASE_URL}/api/bookings",
            json={"event_id": event["id"], "num_seats": 2},
            headers=_headers(consumer_a),
        )
        assert r1.status_code == 200, r1.text
        # Consumer B tries 2 more (would total 4 > 3 capacity) → 409
        r2 = requests.post(
            f"{BASE_URL}/api/bookings",
            json={"event_id": event["id"], "num_seats": 2},
            headers=_headers(consumer_b),
        )
        assert r2.status_code == 409, r2.text
        # But 1 more (total 3) succeeds
        r3 = requests.post(
            f"{BASE_URL}/api/bookings",
            json={"event_id": event["id"], "num_seats": 1},
            headers=_headers(consumer_b),
        )
        assert r3.status_code == 200, r3.text


class TestTimeSlotDoubleBook:
    """Regression: time_slot double-book still 409s."""

    def test_same_slot_second_booking_returns_409(self, organizer_tok, consumer_a, consumer_b):
        event = _create_timeslot_event(organizer_tok)
        r1 = requests.post(
            f"{BASE_URL}/api/bookings",
            json={"event_id": event["id"], "time_slot": "10:00"},
            headers=_headers(consumer_a),
        )
        assert r1.status_code == 200, r1.text
        r2 = requests.post(
            f"{BASE_URL}/api/bookings",
            json={"event_id": event["id"], "time_slot": "10:00"},
            headers=_headers(consumer_b),
        )
        assert r2.status_code == 409, r2.text
        # Different slot still bookable
        r3 = requests.post(
            f"{BASE_URL}/api/bookings",
            json={"event_id": event["id"], "time_slot": "11:00"},
            headers=_headers(consumer_b),
        )
        assert r3.status_code == 200, r3.text
