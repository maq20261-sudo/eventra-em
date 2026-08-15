"""Iteration 10 verification: per-slot capacity + payments + edit + legacy migration."""
import os
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest
import requests
from dotenv import load_dotenv
from pymongo import MongoClient

load_dotenv(Path(__file__).parent.parent.parent / "frontend" / ".env")
load_dotenv(Path(__file__).parent.parent / ".env")

BASE_URL = os.environ["EXPO_PUBLIC_BACKEND_URL"].rstrip("/")
MONGO_URL = os.environ["MONGO_URL"]
DB_NAME = os.environ["DB_NAME"]


def _h(t): return {"Authorization": f"Bearer {t}"}


def _register(role="consumer"):
    email = f"pytest-i10-{role}-{uuid.uuid4().hex[:8]}@example.com"
    r = requests.post(f"{BASE_URL}/api/auth/register",
                      json={"email": email, "password": "password123",
                            "name": f"i10 {role}", "role": role})
    assert r.status_code == 200, r.text
    return r.json()["access_token"]


def _new_event(org_tok, time_slots, slot_capacity=None):
    p = {
        "title": f"TEST_i10 {uuid.uuid4().hex[:6]}",
        "description": "TEST",
        "category": "Other",
        "date": (datetime.now(timezone.utc) + timedelta(days=14)).isoformat(),
        "location_name": "Room",
        "latitude": 12.9716,
        "longitude": 77.5946,
        "price": 100.0,
        "booking_type": "time_slot",
        "time_slots": time_slots,
    }
    if slot_capacity is not None:
        p["slot_capacity"] = slot_capacity
    r = requests.post(f"{BASE_URL}/api/events", json=p, headers=_h(org_tok))
    assert r.status_code in (200, 201), r.text
    return r.json()


class TestEditEventSlots:
    def test_organizer_can_edit_per_slot_capacities(self):
        org = _register("organizer")
        ev = _new_event(org, [{"time": "10:00", "capacity": 3}])
        assert ev["slot_capacities"] == {"10:00": 3}
        # Update with new slot definitions
        upd = {"time_slots": [{"time": "10:00", "capacity": 10},
                              {"time": "14:00", "capacity": 20}]}
        r = requests.put(f"{BASE_URL}/api/events/{ev['id']}", json=upd, headers=_h(org))
        assert r.status_code == 200, r.text
        body = r.json()
        assert set(body["time_slots"]) == {"10:00", "14:00"}
        assert body["slot_capacities"] == {"10:00": 10, "14:00": 20}
        info = {s["time"]: s for s in body["slots_info"]}
        assert info["10:00"]["capacity"] == 10
        assert info["14:00"]["capacity"] == 20


class TestPaymentPricing:
    def test_payment_order_charges_price_x_num_seats(self):
        org = _register("organizer")
        ev = _new_event(org, [{"time": "10:00", "capacity": 10}])
        # price=100, num_seats=3 => 300 INR = 30000 paise
        con = _register("consumer")
        r = requests.post(
            f"{BASE_URL}/api/payments/order",
            json={"kind": "booking", "event_id": ev["id"], "time_slot": "10:00", "num_seats": 3},
            headers=_h(con),
        )
        # Payment endpoint may return 200 or 503 if razorpay not configured;
        # in either case, we should verify amount was computed correctly.
        if r.status_code == 503:
            pytest.skip(f"payments not configured: {r.text}")
        assert r.status_code == 200, r.text
        body = r.json()
        # amount in paise
        assert body.get("amount_paise") == 30000, body


class TestLegacyEventBookable:
    """Simulate a pre-migration event (only time_slots as List[str], slot_capacity=1),
    then ensure the migration back-fills capacities to 50 and it's bookable."""

    def test_legacy_event_after_migration_bookable(self):
        org = _register("organizer")
        ev = _new_event(org, ["9am", "10am"])  # default slot_capacity=1
        # simulate legacy: strip slot_capacities in DB
        client = MongoClient(MONGO_URL)
        try:
            client[DB_NAME].events.update_one(
                {"id": ev["id"]},
                {"$unset": {"slot_capacities": ""}, "$set": {"slot_capacity": 1}},
            )
        finally:
            client.close()
        # Re-run migration (idempotent) — should back-fill this one legacy event
        import subprocess
        p = subprocess.run(
            ["python", "/app/backend/migrations/001_time_slot_capacities.py"],
            capture_output=True, text=True,
        )
        assert p.returncode == 0, p.stderr
        # GET event → slots_info should now show 50 seats/slot
        got = requests.get(f"{BASE_URL}/api/events/{ev['id']}").json()
        assert got["slot_capacities"] == {"9am": 50, "10am": 50}, got
        info = {s["time"]: s for s in got["slots_info"]}
        assert info["9am"]["capacity"] == 50
        # And it's bookable
        con = _register("consumer")
        r = requests.post(
            f"{BASE_URL}/api/bookings",
            json={"event_id": ev["id"], "time_slot": "9am", "num_seats": 5},
            headers=_h(con),
        )
        assert r.status_code == 200, r.text
        assert r.json()["num_seats"] == 5


class TestOrganizerSumCapacity:
    def test_organizer_events_list_reports_sum_of_slot_capacities(self):
        org = _register("organizer")
        ev = _new_event(org, [
            {"time": "10:00", "capacity": 50},
            {"time": "11:00", "capacity": 50},
            {"time": "12:00", "capacity": 50},
        ])
        # Fetch organizer events list
        r = requests.get(f"{BASE_URL}/api/events?organizer_only=true", headers=_h(org))
        assert r.status_code == 200, r.text
        # backend returns raw events; frontend computes sum. Verify slot_capacities present.
        target = next((e for e in r.json() if e["id"] == ev["id"]), None)
        assert target is not None
        assert sum(target["slot_capacities"].values()) == 150
