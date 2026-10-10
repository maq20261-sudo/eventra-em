"""Tests for per-slot capacity on time_slot bookings (June 2026 feature).

New behavior:
    - Organizer can pass `time_slots: [{time, capacity}, ...]` OR a plain
      `[str]` (legacy) at event creation time.
    - Each slot has its own capacity.
    - Bookings for a slot fail with 409 when that slot's capacity is exhausted.
    - `num_seats` is supported for time_slot bookings (group bookings).
    - `event.slot_capacities` and `event.slots_info[i].remaining` reflect
      per-slot availability.
"""
import os
import uuid
from datetime import datetime, timedelta, timezone

import requests

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "http://localhost:8001").rstrip("/")


def _headers(tok):
    return {"Authorization": f"Bearer {tok}"}


def _register(role: str) -> str:
    email = f"pytest-{role}-{uuid.uuid4().hex[:8]}@example.com"
    r = requests.post(
        f"{BASE_URL}/api/auth/register",
        json={"email": email, "password": "password123", "name": f"Test {role}", "role": role},
    )
    assert r.status_code == 200, r.text
    return r.json()["access_token"]


def _create_event(organizer_tok, time_slots, slot_capacity=None):
    payload = {
        "title": f"TEST_PerSlot {uuid.uuid4().hex[:6]}",
        "description": "TEST",
        "category": "Other",
        "date": (datetime.now(timezone.utc) + timedelta(days=7)).isoformat(),
        "location_name": "Test Room",
        "latitude": 12.9716,
        "longitude": 77.5946,
        "price": 20.0,
        "booking_type": "time_slot",
        "time_slots": time_slots,
    }
    if slot_capacity is not None:
        payload["slot_capacity"] = slot_capacity
    r = requests.post(f"{BASE_URL}/api/events", json=payload, headers=_headers(organizer_tok))
    assert r.status_code in (200, 201), r.text
    return r.json()


class TestPerSlotCapacity:
    def test_create_event_with_object_time_slots(self):
        organizer = _register("organizer")
        event = _create_event(
            organizer,
            time_slots=[
                {"time": "10:00", "capacity": 3},
                {"time": "11:00", "capacity": 5},
                {"time": "12:00", "capacity": 1},
            ],
        )
        assert event["time_slots"] == ["10:00", "11:00", "12:00"]
        assert event["slot_capacities"] == {"10:00": 3, "11:00": 5, "12:00": 1}
        # slots_info should reflect per-slot capacity
        info = {s["time"]: s for s in event["slots_info"]}
        assert info["10:00"]["capacity"] == 3
        assert info["10:00"]["remaining"] == 3
        assert info["11:00"]["capacity"] == 5
        assert info["12:00"]["capacity"] == 1

    def test_slot_fills_up_to_capacity_then_409s(self):
        organizer = _register("organizer")
        event = _create_event(organizer, time_slots=[{"time": "10:00", "capacity": 2}])
        # Two consumers can each book the same slot
        c1 = _register("consumer")
        c2 = _register("consumer")
        c3 = _register("consumer")
        for c in (c1, c2):
            r = requests.post(
                f"{BASE_URL}/api/bookings",
                json={"event_id": event["id"], "time_slot": "10:00"},
                headers=_headers(c),
            )
            assert r.status_code == 200, r.text
        # Third booking fails
        r3 = requests.post(
            f"{BASE_URL}/api/bookings",
            json={"event_id": event["id"], "time_slot": "10:00"},
            headers=_headers(c3),
        )
        assert r3.status_code == 409, r3.text
        assert "fully booked" in r3.json()["detail"].lower() or "left" in r3.json()["detail"].lower()

    def test_group_booking_with_num_seats(self):
        organizer = _register("organizer")
        event = _create_event(organizer, time_slots=[{"time": "10:00", "capacity": 5}])
        c1 = _register("consumer")
        # Book 3 seats in one go
        r = requests.post(
            f"{BASE_URL}/api/bookings",
            json={"event_id": event["id"], "time_slot": "10:00", "num_seats": 3},
            headers=_headers(c1),
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["total_price"] == 60.0  # 3 * 20
        assert body["num_seats"] == 3

        # Only 2 seats remain → booking 3 more should fail
        c2 = _register("consumer")
        r2 = requests.post(
            f"{BASE_URL}/api/bookings",
            json={"event_id": event["id"], "time_slot": "10:00", "num_seats": 3},
            headers=_headers(c2),
        )
        assert r2.status_code == 409, r2.text

        # But booking exactly 2 works
        r3 = requests.post(
            f"{BASE_URL}/api/bookings",
            json={"event_id": event["id"], "time_slot": "10:00", "num_seats": 2},
            headers=_headers(c2),
        )
        assert r3.status_code == 200, r3.text

        # Now check remaining is 0 and slot is sold_out
        ev = requests.get(f"{BASE_URL}/api/events/{event['id']}").json()
        info = {s["time"]: s for s in ev["slots_info"]}
        assert info["10:00"]["remaining"] == 0
        assert info["10:00"]["sold_out"] is True
        assert info["10:00"]["booked"] == 5

    def test_legacy_string_slots_default_to_slot_capacity(self):
        organizer = _register("organizer")
        # Legacy payload: List[str] + a single slot_capacity fallback
        event = _create_event(organizer, time_slots=["9am", "10am"], slot_capacity=4)
        assert event["time_slots"] == ["9am", "10am"]
        assert event["slot_capacities"] == {"9am": 4, "10am": 4}

    def test_cancel_returns_capacity(self):
        organizer = _register("organizer")
        event = _create_event(organizer, time_slots=[{"time": "10:00", "capacity": 2}])
        c1 = _register("consumer")
        r1 = requests.post(
            f"{BASE_URL}/api/bookings",
            json={"event_id": event["id"], "time_slot": "10:00", "num_seats": 2},
            headers=_headers(c1),
        )
        assert r1.status_code == 200, r1.text
        booking_id = r1.json()["id"]

        # Slot is full
        info = {s["time"]: s for s in requests.get(f"{BASE_URL}/api/events/{event['id']}").json()["slots_info"]}
        assert info["10:00"]["remaining"] == 0

        # Cancel — releases both seats
        rc = requests.post(
            f"{BASE_URL}/api/bookings/{booking_id}/cancel",
            headers=_headers(c1),
        )
        assert rc.status_code == 200, rc.text

        info2 = {s["time"]: s for s in requests.get(f"{BASE_URL}/api/events/{event['id']}").json()["slots_info"]}
        assert info2["10:00"]["remaining"] == 2
        assert info2["10:00"]["sold_out"] is False
