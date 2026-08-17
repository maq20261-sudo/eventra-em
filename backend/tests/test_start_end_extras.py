"""Extra tests for iteration_12 (Jan 2026):
    1. PUT /api/events/{id} bumps stale end_date when start moves past it.
    2. Cancel of a seat_map + slot booking frees BOTH booked_seats and
       seats_by_slot so the same seat becomes bookable again in the same slot.
    3. Migration 002 is idempotent (re-run should update 0).

These are additive to test_start_end_and_seatmap_slots.py — kept in a
separate module so we can pace registers and dodge the /register 429 rate
limit.
"""
import os
import subprocess
import time
import uuid
from datetime import datetime, timedelta, timezone

import pytest
import requests

BASE_URL = "http://localhost:8001"


def _headers(tok):
    return {"Authorization": f"Bearer {tok}"}


def _register(role: str, retries: int = 4) -> str:
    """Register with polite back-off — the API rate-limits registrations."""
    email = f"pytest-{role}-{uuid.uuid4().hex[:8]}@example.com"
    for attempt in range(retries):
        r = requests.post(
            f"{BASE_URL}/api/auth/register",
            json={"email": email, "password": "password123", "name": f"Test {role}", "role": role},
        )
        if r.status_code == 200:
            return r.json()["access_token"]
        if r.status_code == 429:
            time.sleep(35 * (attempt + 1))
            continue
        raise AssertionError(f"register failed: {r.status_code} {r.text}")
    pytest.skip("Rate-limited on /register after retries")


class TestPutEventDates:
    def test_put_bumps_stale_end_date(self):
        organizer = _register("organizer")
        start = (datetime.now(timezone.utc) + timedelta(days=10)).isoformat()
        end = (datetime.now(timezone.utc) + timedelta(days=10, hours=2)).isoformat()
        payload = {
            "title": f"TEST_PutBump_{uuid.uuid4().hex[:6]}",
            "description": "TEST",
            "category": "Other",
            "start_date": start,
            "end_date": end,
            "location_name": "Room",
            "latitude": 12.9, "longitude": 77.5,
            "price": 10.0,
            "booking_type": "general",
            "total_seats": 50,
        }
        r = requests.post(f"{BASE_URL}/api/events", json=payload, headers=_headers(organizer))
        assert r.status_code in (200, 201), r.text
        ev = r.json()

        # Move start_date past the existing end_date.
        new_start = (datetime.now(timezone.utc) + timedelta(days=20)).isoformat()
        r2 = requests.put(
            f"{BASE_URL}/api/events/{ev['id']}",
            json={"start_date": new_start},
            headers=_headers(organizer),
        )
        assert r2.status_code == 200, r2.text
        updated = r2.json()
        assert updated["start_date"] == new_start
        s = datetime.fromisoformat(updated["start_date"].replace("Z", "+00:00"))
        e = datetime.fromisoformat(updated["end_date"].replace("Z", "+00:00"))
        assert e > s, "end_date must be after start_date after auto-bump"


class TestCancelSeatMapSlotFrees:
    def test_cancel_releases_seat_in_same_slot(self):
        organizer = _register("organizer")
        # Create seat_map + slots event.
        start = (datetime.now(timezone.utc) + timedelta(days=10)).isoformat()
        r = requests.post(
            f"{BASE_URL}/api/events",
            json={
                "title": f"TEST_CancelSlot_{uuid.uuid4().hex[:6]}",
                "description": "TEST",
                "category": "Other",
                "start_date": start,
                "location_name": "Room",
                "latitude": 12.9, "longitude": 77.5,
                "price": 20.0,
                "booking_type": "seat_map",
                "seat_rows": 3, "seat_cols": 3,
                "time_slots": ["Matinee", "Evening"],
            },
            headers=_headers(organizer),
        )
        assert r.status_code in (200, 201), r.text
        ev = r.json()

        c1 = _register("consumer")
        # Book C3 for Matinee.
        r1 = requests.post(
            f"{BASE_URL}/api/bookings",
            json={"event_id": ev["id"], "seats": ["C3"], "time_slot": "Matinee"},
            headers=_headers(c1),
        )
        assert r1.status_code == 200, r1.text
        booking_id = r1.json()["id"]

        # Verify seat is now booked in Matinee slot.
        got = requests.get(f"{BASE_URL}/api/events/{ev['id']}/booked-seats?time_slot=Matinee").json()
        assert "C3" in got["booked_seats"]

        # Cancel booking.
        rc = requests.post(
            f"{BASE_URL}/api/bookings/{booking_id}/cancel",
            headers=_headers(c1),
        )
        assert rc.status_code == 200, rc.text
        assert rc.json()["status"] == "cancelled"

        # Now seat should be free in Matinee slot.
        after = requests.get(f"{BASE_URL}/api/events/{ev['id']}/booked-seats?time_slot=Matinee").json()
        assert "C3" not in after["booked_seats"], f"C3 still booked after cancel: {after}"

        # And another consumer can re-book it in the same slot.
        c2 = _register("consumer")
        r2 = requests.post(
            f"{BASE_URL}/api/bookings",
            json={"event_id": ev["id"], "seats": ["C3"], "time_slot": "Matinee"},
            headers=_headers(c2),
        )
        assert r2.status_code == 200, r2.text


class TestMigrationIdempotent:
    def test_migration_002_idempotent(self):
        # Run once to make sure DB is in migrated state.
        env = os.environ.copy()
        p1 = subprocess.run(
            ["python", "/app/backend/migrations/002_start_end_date.py"],
            capture_output=True, text=True, timeout=60, env=env,
        )
        assert p1.returncode == 0, p1.stderr
        # Run again — should update 0.
        p2 = subprocess.run(
            ["python", "/app/backend/migrations/002_start_end_date.py"],
            capture_output=True, text=True, timeout=60, env=env,
        )
        assert p2.returncode == 0, p2.stderr
        assert "Updated:  0" in p2.stdout, f"Migration NOT idempotent:\n{p2.stdout}"
