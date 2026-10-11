"""Tests for the June 2026 additions:
    1. Events now have start_date + end_date (legacy `date` still accepted).
    2. seat_map events can carry time_slots (Option A: same grid, per-slot
       availability). Two different consumers can book seat A1 in two
       different showings.
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


def _base_event_payload(**overrides):
    start = (datetime.now(timezone.utc) + timedelta(days=10)).isoformat()
    p = {
        "title": f"TEST_{uuid.uuid4().hex[:6]}",
        "description": "TEST",
        "category": "Other",
        "start_date": start,
        "location_name": "Test Room",
        "latitude": 12.9716,
        "longitude": 77.5946,
        "price": 30.0,
    }
    p.update(overrides)
    return p


class TestStartEndDate:
    def test_create_with_start_and_end_date(self):
        organizer = _register("organizer")
        start = (datetime.now(timezone.utc) + timedelta(days=7)).isoformat()
        end = (datetime.now(timezone.utc) + timedelta(days=7, hours=3)).isoformat()
        payload = _base_event_payload(
            booking_type="general", total_seats=100,
            start_date=start, end_date=end,
        )
        r = requests.post(f"{BASE_URL}/api/events", json=payload, headers=_headers(organizer))
        assert r.status_code in (200, 201), r.text
        body = r.json()
        assert body["start_date"] == start
        assert body["end_date"] == end
        assert body["date"] == start  # legacy alias

    def test_end_defaults_to_start_plus_one_day(self):
        organizer = _register("organizer")
        start = (datetime.now(timezone.utc) + timedelta(days=7)).isoformat()
        payload = _base_event_payload(booking_type="general", total_seats=100, start_date=start)
        r = requests.post(f"{BASE_URL}/api/events", json=payload, headers=_headers(organizer))
        assert r.status_code in (200, 201), r.text
        body = r.json()
        assert body["start_date"] == start
        # end should be exactly 1 day after start
        s = datetime.fromisoformat(body["start_date"].replace("Z", "+00:00"))
        e = datetime.fromisoformat(body["end_date"].replace("Z", "+00:00"))
        assert (e - s).days == 1

    def test_end_before_start_rejected(self):
        organizer = _register("organizer")
        start = (datetime.now(timezone.utc) + timedelta(days=7)).isoformat()
        end = (datetime.now(timezone.utc) + timedelta(days=6)).isoformat()
        payload = _base_event_payload(booking_type="general", total_seats=100, start_date=start, end_date=end)
        r = requests.post(f"{BASE_URL}/api/events", json=payload, headers=_headers(organizer))
        assert r.status_code == 422, r.text

    def test_legacy_date_field_still_accepted(self):
        organizer = _register("organizer")
        d = (datetime.now(timezone.utc) + timedelta(days=7)).isoformat()
        payload = {
            "title": f"TEST_Legacy_{uuid.uuid4().hex[:6]}",
            "description": "TEST",
            "category": "Other",
            "date": d,  # legacy
            "location_name": "Test Room",
            "latitude": 12.97, "longitude": 77.59,
            "price": 25.0,
            "booking_type": "general",
            "total_seats": 50,
        }
        r = requests.post(f"{BASE_URL}/api/events", json=payload, headers=_headers(organizer))
        assert r.status_code in (200, 201), r.text
        body = r.json()
        assert body["start_date"] == d
        # end auto-computed
        s = datetime.fromisoformat(body["start_date"].replace("Z", "+00:00"))
        e = datetime.fromisoformat(body["end_date"].replace("Z", "+00:00"))
        assert (e - s).days == 1


class TestSeatMapWithTimeSlots:
    def _create_event(self, organizer_tok):
        payload = _base_event_payload(
            booking_type="seat_map",
            seat_rows=3, seat_cols=4,
            time_slots=["Matinee 2PM", "Evening 7PM"],
            price=50.0,
        )
        r = requests.post(f"{BASE_URL}/api/events", json=payload, headers=_headers(organizer_tok))
        assert r.status_code in (200, 201), r.text
        return r.json()

    def test_seat_map_supports_slots_and_returns_slots_info(self):
        organizer = _register("organizer")
        ev = self._create_event(organizer)
        assert ev["booking_type"] == "seat_map"
        assert ev["time_slots"] == ["Matinee 2PM", "Evening 7PM"]
        # slots_info should reflect grid capacity = rows*cols = 12
        info = {s["time"]: s for s in ev["slots_info"]}
        assert info["Matinee 2PM"]["capacity"] == 12
        assert info["Matinee 2PM"]["remaining"] == 12
        assert info["Evening 7PM"]["capacity"] == 12

    def test_same_seat_bookable_in_different_slots(self):
        organizer = _register("organizer")
        ev = self._create_event(organizer)
        c1 = _register("consumer")
        c2 = _register("consumer")
        # Consumer 1 books A1 for Matinee
        r1 = requests.post(
            f"{BASE_URL}/api/bookings",
            json={"event_id": ev["id"], "seats": ["A1"], "time_slot": "Matinee 2PM"},
            headers=_headers(c1),
        )
        assert r1.status_code == 200, r1.text
        # Consumer 2 books A1 for Evening — should succeed (different showing)
        r2 = requests.post(
            f"{BASE_URL}/api/bookings",
            json={"event_id": ev["id"], "seats": ["A1"], "time_slot": "Evening 7PM"},
            headers=_headers(c2),
        )
        assert r2.status_code == 200, r2.text

    def test_same_seat_same_slot_conflicts(self):
        organizer = _register("organizer")
        ev = self._create_event(organizer)
        c1 = _register("consumer")
        c2 = _register("consumer")
        r1 = requests.post(
            f"{BASE_URL}/api/bookings",
            json={"event_id": ev["id"], "seats": ["B2"], "time_slot": "Matinee 2PM"},
            headers=_headers(c1),
        )
        assert r1.status_code == 200, r1.text
        r2 = requests.post(
            f"{BASE_URL}/api/bookings",
            json={"event_id": ev["id"], "seats": ["B2"], "time_slot": "Matinee 2PM"},
            headers=_headers(c2),
        )
        assert r2.status_code == 409, r2.text

    def test_missing_slot_on_seat_map_with_slots_returns_400(self):
        organizer = _register("organizer")
        ev = self._create_event(organizer)
        c = _register("consumer")
        r = requests.post(
            f"{BASE_URL}/api/bookings",
            json={"event_id": ev["id"], "seats": ["A1"]},  # no time_slot
            headers=_headers(c),
        )
        assert r.status_code == 400, r.text

    def test_slotless_seat_map_still_works(self):
        # Existing behavior: seat_map without time_slots — no slot required.
        organizer = _register("organizer")
        payload = _base_event_payload(
            booking_type="seat_map", seat_rows=3, seat_cols=3, price=20.0,
        )
        r = requests.post(f"{BASE_URL}/api/events", json=payload, headers=_headers(organizer))
        assert r.status_code in (200, 201), r.text
        ev = r.json()
        assert ev.get("time_slots") is None
        c = _register("consumer")
        rb = requests.post(
            f"{BASE_URL}/api/bookings",
            json={"event_id": ev["id"], "seats": ["A1"]},
            headers=_headers(c),
        )
        assert rb.status_code == 200, rb.text

    def test_booked_seats_endpoint_filters_by_slot(self):
        organizer = _register("organizer")
        ev = self._create_event(organizer)
        c1 = _register("consumer")
        c2 = _register("consumer")
        requests.post(
            f"{BASE_URL}/api/bookings",
            json={"event_id": ev["id"], "seats": ["A1"], "time_slot": "Matinee 2PM"},
            headers=_headers(c1),
        )
        requests.post(
            f"{BASE_URL}/api/bookings",
            json={"event_id": ev["id"], "seats": ["B2"], "time_slot": "Evening 7PM"},
            headers=_headers(c2),
        )
        # No filter → returns all
        r_all = requests.get(f"{BASE_URL}/api/events/{ev['id']}/booked-seats")
        assert "A1" in r_all.json()["booked_seats"]
        assert "B2" in r_all.json()["booked_seats"]

        r_mat = requests.get(f"{BASE_URL}/api/events/{ev['id']}/booked-seats?time_slot=Matinee%202PM")
        assert "A1" in r_mat.json()["booked_seats"]
        assert "B2" not in r_mat.json()["booked_seats"]

        r_eve = requests.get(f"{BASE_URL}/api/events/{ev['id']}/booked-seats?time_slot=Evening%207PM")
        assert "B2" in r_eve.json()["booked_seats"]
        assert "A1" not in r_eve.json()["booked_seats"]
