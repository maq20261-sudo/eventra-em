"""Razorpay integration tests.

With real test-mode keys configured, we test the full order → verify flow.
Signature is computed locally using the known secret (same as Razorpay's HMAC-SHA256
of `order_id|payment_id`).
"""
import os
import uuid
import hmac
import hashlib
import pytest
from pathlib import Path
from dotenv import load_dotenv

# Load backend env so we know the secret for local HMAC signing
load_dotenv(Path(__file__).parent.parent / ".env")

BASE_URL = os.environ["EXPO_PUBLIC_BACKEND_URL"].rstrip("/")
RZP_SECRET = os.environ.get("RAZORPAY_KEY_SECRET", "")


def _sign(order_id: str, payment_id: str, secret: str) -> str:
    return hmac.new(
        secret.encode("utf-8"),
        f"{order_id}|{payment_id}".encode("utf-8"),
        hashlib.sha256,
    ).hexdigest()


class TestPaymentsConfig:
    def test_config_endpoint(self, api):
        r = api.get(f"{BASE_URL}/api/payments/config")
        assert r.status_code == 200
        body = r.json()
        assert body["provider"] == "razorpay"
        assert body["currency"] == "INR"
        assert isinstance(body["configured"], bool)


class TestPaymentsOrderCreation:
    def test_booking_order_created(self, api, consumer_headers):
        cfg = api.get(f"{BASE_URL}/api/payments/config").json()
        if not cfg["configured"]:
            pytest.skip("Razorpay not configured")
        events = api.get(f"{BASE_URL}/api/events").json()
        paid = next(e for e in events if e["booking_type"] == "general" and e["price"] > 0)
        r = api.post(
            f"{BASE_URL}/api/payments/order",
            json={"kind": "booking", "event_id": paid["id"], "num_seats": 1},
            headers=consumer_headers,
        )
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["razorpay_order_id"].startswith("order_")
        assert data["amount_paise"] == data["amount_inr"] * 100
        # Prices are stored & charged in INR directly (no conversion factor)
        assert data["amount_inr"] == int(round(paid["price"]))

    def test_boost_order_created(self, api, organizer_headers):
        cfg = api.get(f"{BASE_URL}/api/payments/config").json()
        if not cfg["configured"]:
            pytest.skip("Razorpay not configured")
        events = api.get(f"{BASE_URL}/api/organizer/events", headers=organizer_headers).json()
        r = api.post(
            f"{BASE_URL}/api/payments/order",
            json={"kind": "boost", "boost_event_id": events[0]["id"], "tier": "7d"},
            headers=organizer_headers,
        )
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["razorpay_order_id"].startswith("order_")
        # 7d boost tier = ₹299
        assert data["amount_inr"] == 299

    def test_free_event_rejects_payment(self, api, consumer_headers):
        cfg = api.get(f"{BASE_URL}/api/payments/config").json()
        if not cfg["configured"]:
            pytest.skip("Razorpay not configured")
        events = api.get(f"{BASE_URL}/api/events").json()
        free = next((e for e in events if e["price"] == 0), None)
        if not free:
            pytest.skip("No free event")
        body = {"kind": "booking", "event_id": free["id"]}
        if free["booking_type"] == "general":
            body["num_seats"] = 1
        elif free["booking_type"] == "seat_map":
            body["seats"] = ["A1"]
        else:
            body["time_slot"] = free["time_slots"][0]
        r = api.post(f"{BASE_URL}/api/payments/order", json=body, headers=consumer_headers)
        assert r.status_code == 400
        assert "free" in r.json()["detail"].lower()

    def test_consumer_cannot_create_boost_order(self, api, consumer_headers):
        cfg = api.get(f"{BASE_URL}/api/payments/config").json()
        if not cfg["configured"]:
            pytest.skip()
        events = api.get(f"{BASE_URL}/api/events").json()
        r = api.post(
            f"{BASE_URL}/api/payments/order",
            json={"kind": "boost", "boost_event_id": events[0]["id"], "tier": "24h"},
            headers=consumer_headers,
        )
        assert r.status_code == 403

    def test_organizer_cannot_create_booking_order(self, api, organizer_headers):
        cfg = api.get(f"{BASE_URL}/api/payments/config").json()
        if not cfg["configured"]:
            pytest.skip()
        events = api.get(f"{BASE_URL}/api/events").json()
        paid = next(e for e in events if e["price"] > 0)
        body = {"kind": "booking", "event_id": paid["id"]}
        if paid["booking_type"] == "general":
            body["num_seats"] = 1
        elif paid["booking_type"] == "seat_map":
            body["seats"] = ["Z9"]
        else:
            body["time_slot"] = paid["time_slots"][0]
        r = api.post(f"{BASE_URL}/api/payments/order", json=body, headers=organizer_headers)
        assert r.status_code == 403


class TestPaymentsVerify:
    def test_signature_verify_creates_booking(self, api, consumer_headers):
        cfg = api.get(f"{BASE_URL}/api/payments/config").json()
        if not cfg["configured"] or not RZP_SECRET:
            pytest.skip("Razorpay not configured or secret not available for local signing")

        events = api.get(f"{BASE_URL}/api/events").json()
        # Pick a seat_map event without time_slots (this test doesn't handle
        # the seat_map+slot booking flow).
        paid = next(
            e for e in events
            if e["booking_type"] == "seat_map"
            and e["price"] > 0
            and not (e.get("time_slots") or [])
        )
        random_seat = f"Y{uuid.uuid4().hex[:2]}"
        r = api.post(
            f"{BASE_URL}/api/payments/order",
            json={"kind": "booking", "event_id": paid["id"], "seats": [random_seat]},
            headers=consumer_headers,
        )
        assert r.status_code == 200, r.text
        order = r.json()

        payment_id = "pay_" + uuid.uuid4().hex[:14]
        sig = _sign(order["razorpay_order_id"], payment_id, RZP_SECRET)
        r = api.post(
            f"{BASE_URL}/api/payments/verify",
            json={
                "intent_id": order["intent_id"],
                "razorpay_order_id": order["razorpay_order_id"],
                "razorpay_payment_id": payment_id,
                "razorpay_signature": sig,
            },
            headers=consumer_headers,
        )
        assert r.status_code == 200, r.text
        result = r.json()
        assert result["ok"] is True
        assert result["already_paid"] is False
        booking = result["result"]["booking"]
        assert booking["status"] == "confirmed"
        assert booking["payment_status"] == "paid"
        assert booking["seats"] == [random_seat]

        # Idempotency
        r2 = api.post(
            f"{BASE_URL}/api/payments/verify",
            json={
                "intent_id": order["intent_id"],
                "razorpay_order_id": order["razorpay_order_id"],
                "razorpay_payment_id": payment_id,
                "razorpay_signature": sig,
            },
            headers=consumer_headers,
        )
        assert r2.status_code == 200
        assert r2.json()["already_paid"] is True

    def test_bad_signature_rejected(self, api, consumer_headers):
        cfg = api.get(f"{BASE_URL}/api/payments/config").json()
        if not cfg["configured"]:
            pytest.skip()
        events = api.get(f"{BASE_URL}/api/events").json()
        paid = next(e for e in events if e["price"] > 0)
        body = {"kind": "booking", "event_id": paid["id"]}
        if paid["booking_type"] == "general":
            body["num_seats"] = 1
        elif paid["booking_type"] == "seat_map":
            body["seats"] = [f"X{uuid.uuid4().hex[:2]}"]
        else:
            body["time_slot"] = paid["time_slots"][0]
        r = api.post(f"{BASE_URL}/api/payments/order", json=body, headers=consumer_headers)
        order = r.json()

        r = api.post(
            f"{BASE_URL}/api/payments/verify",
            json={
                "intent_id": order["intent_id"],
                "razorpay_order_id": order["razorpay_order_id"],
                "razorpay_payment_id": "pay_FAKE",
                "razorpay_signature": "deadbeef" * 8,
            },
            headers=consumer_headers,
        )
        assert r.status_code == 400
        assert "signature" in r.json()["detail"].lower()

    def test_boost_verify_marks_event_featured(self, api, organizer_headers):
        cfg = api.get(f"{BASE_URL}/api/payments/config").json()
        if not cfg["configured"] or not RZP_SECRET:
            pytest.skip()
        events = api.get(f"{BASE_URL}/api/organizer/events", headers=organizer_headers).json()
        event_id = events[0]["id"]
        r = api.post(
            f"{BASE_URL}/api/payments/order",
            json={"kind": "boost", "boost_event_id": event_id, "tier": "24h"},
            headers=organizer_headers,
        )
        order = r.json()

        payment_id = "pay_" + uuid.uuid4().hex[:14]
        sig = _sign(order["razorpay_order_id"], payment_id, RZP_SECRET)
        r = api.post(
            f"{BASE_URL}/api/payments/verify",
            json={
                "intent_id": order["intent_id"],
                "razorpay_order_id": order["razorpay_order_id"],
                "razorpay_payment_id": payment_id,
                "razorpay_signature": sig,
            },
            headers=organizer_headers,
        )
        assert r.status_code == 200, r.text
        result = r.json()["result"]
        assert result["kind"] == "boost"

        # Event should be featured now
        ev = api.get(f"{BASE_URL}/api/events/{event_id}").json()
        assert ev["is_featured"] is True

    def test_verify_requires_auth(self, api):
        r = api.post(f"{BASE_URL}/api/payments/verify", json={
            "intent_id": "x", "razorpay_order_id": "x",
            "razorpay_payment_id": "x", "razorpay_signature": "x",
        })
        assert r.status_code in (401, 403)


class TestPayAtVenueFallback:
    def test_free_booking_still_works(self, api, consumer_headers):
        events = api.get(f"{BASE_URL}/api/events").json()
        general = next(e for e in events if e["booking_type"] == "general")
        r = api.post(
            f"{BASE_URL}/api/bookings",
            json={"event_id": general["id"], "num_seats": 1},
            headers=consumer_headers,
        )
        assert r.status_code == 200
        b = r.json()
        assert b["status"] == "confirmed"
        assert b["payment_status"] in ("free", "unpaid")
