"""Regression tests for the Part C bug fixes (see docs/ROADMAP.md):

  #3  Concurrent bookings can't oversell a time slot / general event /
      seat (per-event lock + check against the bookings collection).
  #4  An upcoming event with active bookings can't be deleted; the
      organizer cancels it instead (bookings cancelled, event hidden).
  #5  Seat ids are validated against the event's grid.
  #10 GET booked-seats is read-only; cancel cutoff comes from the server.
"""
import os
import uuid
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone

import pytest
import requests

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "http://localhost:8001").rstrip("/")


def _headers(tok):
    return {"Authorization": f"Bearer {tok}"}


def _register(role: str) -> str:
    email = f"pytest-c-{role}-{uuid.uuid4().hex[:8]}@example.com"
    r = requests.post(
        f"{BASE_URL}/api/auth/register",
        json={"email": email, "password": "password123", "name": f"Test {role}", "role": role},
    )
    assert r.status_code == 200, r.text
    return r.json()["access_token"]


_created = []  # (organizer token, event id) — removed after the module


@pytest.fixture(scope="module", autouse=True)
def _remove_test_events():
    """Sold-out test events must not linger in Discover: other test modules
    book "the first general event" they find."""
    yield
    for tok, event_id in _created:
        requests.post(f"{BASE_URL}/api/events/{event_id}/cancel", json={}, headers=_headers(tok))
        requests.delete(f"{BASE_URL}/api/events/{event_id}", headers=_headers(tok))


def _create_event(org_tok, **fields):
    payload = {
        "title": f"TEST_PartC {uuid.uuid4().hex[:6]}",
        "description": "TEST",
        "category": "Other",
        "date": (datetime.now(timezone.utc) + timedelta(days=7)).isoformat(),
        "location_name": "Test Room",
        "latitude": 12.9716,
        "longitude": 77.5946,
        "price": 0.0,
    }
    payload.update(fields)
    r = requests.post(f"{BASE_URL}/api/events", json=payload, headers=_headers(org_tok))
    assert r.status_code in (200, 201), r.text
    _created.append((org_tok, r.json()["id"]))
    return r.json()


def _book(tok, event_id, **fields):
    return requests.post(
        f"{BASE_URL}/api/bookings", json={"event_id": event_id, **fields}, headers=_headers(tok)
    )


def _race(event_id, n, **fields):
    """n different attendees book at the same moment; returns status codes."""
    toks = [_register("consumer") for _ in range(n)]
    with ThreadPoolExecutor(max_workers=n) as pool:
        return list(pool.map(lambda t: _book(t, event_id, **fields).status_code, toks))


class TestNoOversell:
    def test_time_slot_last_place_goes_to_one_attendee(self):
        org = _register("organizer")
        ev = _create_event(org, booking_type="time_slot",
                           time_slots=[{"time": "10:00 AM", "capacity": 2}])
        codes = _race(ev["id"], 8, time_slot="10:00 AM")
        assert codes.count(200) == 2, codes
        assert all(c in (200, 409) for c in codes), codes

    def test_general_capacity_is_never_exceeded(self):
        org = _register("organizer")
        ev = _create_event(org, booking_type="general", total_seats=3)
        codes = _race(ev["id"], 8, num_seats=1)
        assert codes.count(200) == 3, codes
        g = requests.get(f"{BASE_URL}/api/events/{ev['id']}").json()
        assert g["booked_count"] == 3

    def test_same_seat_goes_to_one_attendee(self):
        org = _register("organizer")
        ev = _create_event(org, booking_type="seat_map", seat_rows=4, seat_cols=4)
        codes = _race(ev["id"], 6, seats=["B2"])
        assert codes.count(200) == 1, codes


class TestSeatValidation:
    def test_seats_outside_the_grid_or_repeated_are_rejected(self):
        org = _register("organizer")
        ev = _create_event(org, booking_type="seat_map", seat_rows=3, seat_cols=5)
        tok = _register("consumer")
        for seats in (["D1"], ["A6"], ["A0"], ["a1"], ["Z99"], ["1A"], ["A1", "A1"]):
            r = _book(tok, ev["id"], seats=seats)
            assert r.status_code == 400, (seats, r.text)
        r = _book(tok, ev["id"], seats=["C5", "A1"])
        assert r.status_code == 200, r.text
        assert r.json()["num_seats"] == 2

    def test_more_than_26_rows_is_rejected(self):
        org = _register("organizer")
        payload = {
            "title": "TEST_rows", "description": "TEST", "category": "Other",
            "date": (datetime.now(timezone.utc) + timedelta(days=7)).isoformat(),
            "location_name": "x", "latitude": 1.0, "longitude": 1.0, "price": 0.0,
            "booking_type": "seat_map", "seat_rows": 27, "seat_cols": 5,
        }
        r = requests.post(f"{BASE_URL}/api/events", json=payload, headers=_headers(org))
        assert r.status_code == 422, r.text


class TestCancelEvent:
    def test_delete_blocked_then_cancel_then_delete(self):
        org = _register("organizer")
        ev = _create_event(org, booking_type="general", total_seats=10)
        att = _register("consumer")
        b = _book(att, ev["id"], num_seats=2)
        assert b.status_code == 200, b.text

        r = requests.delete(f"{BASE_URL}/api/events/{ev['id']}", headers=_headers(org))
        assert r.status_code == 409, r.text

        # Only the owner can cancel.
        other = _register("organizer")
        r = requests.post(f"{BASE_URL}/api/events/{ev['id']}/cancel", json={}, headers=_headers(other))
        assert r.status_code == 403

        r = requests.post(f"{BASE_URL}/api/events/{ev['id']}/cancel",
                          json={"reason": "Venue flooded"}, headers=_headers(org))
        assert r.status_code == 200, r.text
        assert r.json()["cancelled_bookings"] == 1

        # Second cancel is refused, the event left Discover, can't be booked or edited.
        r = requests.post(f"{BASE_URL}/api/events/{ev['id']}/cancel", json={}, headers=_headers(org))
        assert r.status_code == 409
        listed = requests.get(f"{BASE_URL}/api/events", params={"search": ev["title"]}).json()
        assert all(e["id"] != ev["id"] for e in listed)
        assert _book(_register("consumer"), ev["id"], num_seats=1).status_code == 400
        r = requests.put(f"{BASE_URL}/api/events/{ev['id']}", json={"title": "x"}, headers=_headers(org))
        assert r.status_code == 400

        # The attendee's ticket shows the cancellation.
        mine = requests.get(f"{BASE_URL}/api/bookings/me", headers=_headers(att)).json()
        t = next(x for x in mine if x["id"] == b.json()["id"])
        assert t["status"] == "cancelled"
        assert t["event"]["cancelled_at"]
        assert t["event"]["cancel_reason"] == "Venue flooded"
        g = requests.get(f"{BASE_URL}/api/events/{ev['id']}").json()
        assert g["booked_count"] == 0

        r = requests.delete(f"{BASE_URL}/api/events/{ev['id']}", headers=_headers(org))
        assert r.status_code == 200, r.text

    def test_event_without_bookings_can_still_be_deleted(self):
        org = _register("organizer")
        ev = _create_event(org, booking_type="general", total_seats=10)
        r = requests.delete(f"{BASE_URL}/api/events/{ev['id']}", headers=_headers(org))
        assert r.status_code == 200, r.text


class TestMinor:
    def test_attendee_cancel_frees_seat_count(self):
        org = _register("organizer")
        ev = _create_event(org, booking_type="seat_map", seat_rows=2, seat_cols=2)
        att = _register("consumer")
        b = _book(att, ev["id"], seats=["A1", "A2"])
        assert b.status_code == 200, b.text
        assert requests.get(f"{BASE_URL}/api/events/{ev['id']}").json()["booked_count"] == 2
        r = requests.post(f"{BASE_URL}/api/bookings/{b.json()['id']}/cancel", headers=_headers(att))
        assert r.status_code == 200, r.text
        g = requests.get(f"{BASE_URL}/api/events/{ev['id']}").json()
        assert g["booked_count"] == 0
        taken = requests.get(f"{BASE_URL}/api/events/{ev['id']}/booked-seats").json()
        assert taken["booked_seats"] == []

    def test_pricing_config_has_cancel_cutoff(self):
        cfg = requests.get(f"{BASE_URL}/api/pricing/config").json()
        assert isinstance(cfg["cancel_cutoff_hours"], int)
