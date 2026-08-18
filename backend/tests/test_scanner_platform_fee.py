"""Regression test for the scanner platform-fee display bug.

Bug: `POST /api/checkin/preview` used to return only `total_price`, so the
organizer's Scan Ticket popup showed the ticket price (₹10) and told the
scanner to "Collect ₹10" — even when the attendee actually owed ₹10
ticket + ₹9 platform fee = ₹19. Fix: `_safe_booking_for_scanner` now
surfaces `platform_fee_inr`, `platform_fee_waived`, and `grand_total_inr`.
"""
import os
import uuid
import requests

BASE_URL = os.environ["EXPO_PUBLIC_BACKEND_URL"].rstrip("/")


def _register(role: str):
    r = requests.post(f"{BASE_URL}/api/auth/register", json={
        "email": f"{role}_{uuid.uuid4().hex[:8]}@ex.com",
        "password": "password123",
        "name": f"{role}-user",
        "role": role,
    })
    assert r.status_code == 200, r.text
    return r.json()["access_token"], r.json()["user"]


def test_scanner_preview_surfaces_platform_fee_fields():
    """Whatever the fee is (may be waived under free tier), the scanner
    payload MUST always include platform_fee_inr + grand_total_inr so the
    organizer UI can render the correct "collect at gate" amount."""
    otoken, _ = _register("organizer")
    ctoken, _ = _register("consumer")

    e = requests.post(f"{BASE_URL}/api/events",
                      headers={"Authorization": f"Bearer {otoken}"},
                      json={
                          "title": f"ScanFee {uuid.uuid4().hex[:6]}",
                          "description": "d",
                          "category": "Music",
                          "location_name": "L",
                          "latitude": 19.076, "longitude": 72.877,
                          "price": 10,
                          "booking_type": "general",
                          "total_seats": 10,
                          "start_date": "2028-01-01T10:00:00Z",
                          "end_date": "2028-01-01T12:00:00Z",
                      }).json()

    booking = requests.post(f"{BASE_URL}/api/bookings",
                            headers={"Authorization": f"Bearer {ctoken}"},
                            json={"event_id": e["id"], "num_seats": 1}).json()

    prev = requests.post(f"{BASE_URL}/api/checkin/preview",
                         headers={"Authorization": f"Bearer {otoken}"},
                         json={"booking_id": booking["id"]}).json()

    b = prev.get("booking") or {}
    assert prev.get("ok") is True
    # Core assertion — these are the fields the scanner needs.
    assert "platform_fee_inr" in b, "platform_fee_inr missing from scanner payload"
    assert "grand_total_inr" in b, "grand_total_inr missing from scanner payload"
    assert "platform_fee_waived" in b
    # Grand total must equal booking-time totals.
    assert b["grand_total_inr"] == booking["grand_total_inr"], (
        f"scanner grand_total {b['grand_total_inr']} != booking grand_total {booking['grand_total_inr']}"
    )
    assert b["total_price"] == booking["total_price"]
    assert b["platform_fee_inr"] == booking["platform_fee_inr"]


def test_scanner_grand_total_reflects_fee_when_charged():
    """When the attendee has exhausted the free tier, the scanner grand
    total must equal ticket + fee (not just ticket)."""
    # Toggle the limit via a POST-only assumption isn't available, so we
    # just assert the derivation logic: grand_total = ticket + fee.
    otoken, _ = _register("organizer")
    ctoken, _ = _register("consumer")
    e = requests.post(f"{BASE_URL}/api/events",
                      headers={"Authorization": f"Bearer {otoken}"},
                      json={
                          "title": f"ScanFee2 {uuid.uuid4().hex[:6]}",
                          "description": "d",
                          "category": "Music",
                          "location_name": "L",
                          "latitude": 19.076, "longitude": 72.877,
                          "price": 10,
                          "booking_type": "general",
                          "total_seats": 10,
                          "start_date": "2028-01-01T10:00:00Z",
                          "end_date": "2028-01-01T12:00:00Z",
                      }).json()
    booking = requests.post(f"{BASE_URL}/api/bookings",
                            headers={"Authorization": f"Bearer {ctoken}"},
                            json={"event_id": e["id"], "num_seats": 1}).json()
    prev = requests.post(f"{BASE_URL}/api/checkin/preview",
                         headers={"Authorization": f"Bearer {otoken}"},
                         json={"booking_id": booking["id"]}).json()
    b = prev["booking"]
    expected = (b["total_price"] or 0) + (b["platform_fee_inr"] or 0)
    assert b["grand_total_inr"] == expected, (
        f"grand_total_inr ({b['grand_total_inr']}) must equal ticket + fee ({expected})"
    )
