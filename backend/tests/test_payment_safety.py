"""Payment safety (Part C #1 "paid but no booking"):

- the Razorpay order is refused when the seat is already gone (no money taken)
- if a booking still fails after payment, the payment is refunded once and the
  intent is never left charged-without-result
- the Razorpay webhook verifies its signature and completes unverified intents
"""
import asyncio
import hashlib
import hmac
import json
import os
import sys
import uuid
from pathlib import Path

import pytest
import requests

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "http://localhost:8001").rstrip("/")


def _login(email):
    r = requests.post(f"{BASE_URL}/api/auth/login", json={"email": email, "password": "password123"}, timeout=15)
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


def test_order_refused_when_seat_already_booked():
    cfg = requests.get(f"{BASE_URL}/api/payments/config", timeout=15).json()
    if not cfg["configured"]:
        pytest.skip("Razorpay not configured")
    headers = _login("demo@consumer.com")
    events = requests.get(f"{BASE_URL}/api/events", timeout=15).json()
    seat_ev = next((e for e in events if e["booking_type"] == "seat_map" and not e.get("time_slots")
                    and e["price"] > 0), None)
    if not seat_ev:
        pytest.skip("No paid slotless seat-map event seeded")
    seat = f"{chr(64 + seat_ev['seat_rows'])}{seat_ev['seat_cols']}"  # last seat in the grid
    r = requests.post(f"{BASE_URL}/api/bookings", json={"event_id": seat_ev["id"], "seats": [seat]},
                      headers=headers, timeout=15)
    assert r.status_code == 200, r.text
    booking_id = r.json()["id"]
    try:
        r = requests.post(f"{BASE_URL}/api/payments/order",
                          json={"kind": "booking", "event_id": seat_ev["id"], "seats": [seat]},
                          headers=headers, timeout=15)
        assert r.status_code == 409, r.text
        assert "already booked" in r.json()["detail"]
    finally:
        requests.post(f"{BASE_URL}/api/bookings/{booking_id}/cancel", headers=headers, timeout=15)


def test_order_refused_for_duplicate_seats():
    cfg = requests.get(f"{BASE_URL}/api/payments/config", timeout=15).json()
    if not cfg["configured"]:
        pytest.skip("Razorpay not configured")
    headers = _login("demo@consumer.com")
    events = requests.get(f"{BASE_URL}/api/events", timeout=15).json()
    seat_ev = next((e for e in events if e["booking_type"] == "seat_map" and not e.get("time_slots")
                    and e["price"] > 0), None)
    if not seat_ev:
        pytest.skip("No paid slotless seat-map event seeded")
    r = requests.post(f"{BASE_URL}/api/payments/order",
                      json={"kind": "booking", "event_id": seat_ev["id"], "seats": ["A1", "A1"]},
                      headers=headers, timeout=15)
    assert r.status_code == 400, r.text


def _run(coro_factory):
    """Run against a fresh Motor client bound to this test's event loop."""
    import server
    from motor.motor_asyncio import AsyncIOMotorClient

    async def wrapper():
        cl = AsyncIOMotorClient(os.environ["MONGO_URL"])
        original = server.db
        server.db = cl[os.environ["DB_NAME"]]
        try:
            return await coro_factory(server)
        finally:
            server.db = original
            cl.close()

    return asyncio.run(wrapper())


def _intent(kind="booking"):
    return {
        "id": f"test-{uuid.uuid4()}",
        "user_id": "test-user",
        "kind": kind,
        "payload": {"event_id": "missing-event", "seats": ["A1"]},
        "amount_paise": 79900,
        "amount_inr": 799.0,
        "razorpay_order_id": f"order_test_{uuid.uuid4().hex[:10]}",
        "status": "created",
    }


def test_failed_booking_after_payment_is_refunded_once(monkeypatch):
    from fastapi import HTTPException

    refunds = []

    async def scenario(server):
        async def boom(*a, **k):
            raise HTTPException(status_code=409, detail="Seat(s) already booked: A1.")

        async def fake_refund(payment):
            refunds.append(payment["payment_id"])
            return {"status": "refund_pending", "id": "rfnd_test"}

        monkeypatch.setattr(server, "_perform_booking", boom)
        monkeypatch.setattr(server, "_issue_razorpay_refund", fake_refund)
        intent = _intent()
        await server.db.payment_intents.insert_one(dict(intent))
        payment = {"payment_id": "pay_test", "amount_paise": 79900, "amount_inr": 799.0}
        try:
            with pytest.raises(HTTPException) as first:
                await server._fulfil_intent(intent, {"id": "test-user"}, payment, source="test")
            assert first.value.status_code == 409
            assert "refunded" in first.value.detail
            stored = await server.db.payment_intents.find_one({"id": intent["id"]})
            assert stored["status"] == "refunded"
            assert stored["refund"]["id"] == "rfnd_test"
            # A second attempt (e.g. webhook after the app) must not refund again.
            with pytest.raises(HTTPException) as second:
                await server._fulfil_intent(intent, {"id": "test-user"}, payment, source="test")
            assert second.value.status_code == 409
        finally:
            await server.db.payment_intents.delete_one({"id": intent["id"]})

    _run(scenario)
    assert refunds == ["pay_test"]


def test_fulfil_is_idempotent_for_success(monkeypatch):
    async def scenario(server):
        intent = _intent(kind="platform_fee")
        await server.db.payment_intents.insert_one(dict(intent))
        payment = {"payment_id": "pay_ok", "amount_paise": 1900, "amount_inr": 19.0}
        try:
            first = await server._fulfil_intent(intent, {"id": "test-user"}, payment, source="app")
            second = await server._fulfil_intent(intent, {"id": "test-user"}, payment, source="webhook")
            assert first == second == {"kind": "platform_fee", "platform_intent_id": intent["id"]}
            stored = await server.db.payment_intents.find_one({"id": intent["id"]})
            assert stored["status"] == "paid"
        finally:
            await server.db.payment_intents.delete_one({"id": intent["id"]})

    _run(scenario)


def test_webhook_signature_and_completion(monkeypatch):
    from fastapi.testclient import TestClient
    import server

    secret = "whsec_test"
    monkeypatch.setattr(server, "RAZORPAY_WEBHOOK_SECRET", secret)

    def post(body: dict, sign=True):
        raw = json.dumps(body).encode()
        sig = hmac.new(secret.encode(), raw, hashlib.sha256).hexdigest() if sign else "bad"
        return tc.post("/api/payments/webhook", content=raw,
                       headers={"x-razorpay-signature": sig, "content-type": "application/json"})

    intent = _intent(kind="platform_fee")
    user = {"id": intent["user_id"], "name": "Webhook Test", "email": "webhook@test.local", "role": "organizer"}
    with TestClient(server.app) as tc:
        assert post({"event": "payment.captured"}, sign=False).status_code == 400

        unknown = {"event": "payment.captured",
                   "payload": {"payment": {"entity": {"id": "pay_x", "order_id": "order_unknown", "amount": 1}}}}
        r = post(unknown)
        assert r.status_code == 200 and r.json()["ignored"] == "unknown order"

        async def setup(s):
            await s.db.payment_intents.insert_one(dict(intent))
            await s.db.users.insert_one(dict(user))
        _run(setup)
        try:
            captured = {"event": "payment.captured", "payload": {"payment": {"entity": {
                "id": "pay_webhook", "order_id": intent["razorpay_order_id"], "amount": intent["amount_paise"]}}}}
            r = post(captured)
            assert r.status_code == 200 and r.json()["status"] == "paid", r.text
            r = post(captured)  # Razorpay retries must be harmless
            assert r.status_code == 200 and r.json()["status"] == "paid"
        finally:
            async def cleanup(s):
                await s.db.payment_intents.delete_one({"id": intent["id"]})
                await s.db.users.delete_one({"id": user["id"]})
            _run(cleanup)
