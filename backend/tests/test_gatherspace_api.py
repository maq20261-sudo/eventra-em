"""Comprehensive backend API tests for GatherSpace event app."""
import os
import uuid
import requests
import pytest

BASE_URL = os.environ["EXPO_PUBLIC_BACKEND_URL"].rstrip("/")

# San Francisco base
SF_LAT, SF_LNG = 37.7749, -122.4194


# ---------- Auth ----------

class TestAuth:
    def test_register_consumer(self, api):
        email = f"test_consumer_{uuid.uuid4().hex[:8]}@test.com"
        r = api.post(f"{BASE_URL}/api/auth/register", json={
            "email": email, "password": "password123",
            "name": "TEST Consumer", "role": "consumer",
        })
        assert r.status_code == 200, r.text
        data = r.json()
        assert "access_token" in data
        assert data["user"]["role"] == "consumer"
        assert data["user"]["email"] == email

    def test_register_organizer(self, api):
        email = f"test_org_{uuid.uuid4().hex[:8]}@test.com"
        r = api.post(f"{BASE_URL}/api/auth/register", json={
            "email": email, "password": "password123",
            "name": "TEST Organizer", "role": "organizer",
        })
        assert r.status_code == 200, r.text
        assert r.json()["user"]["role"] == "organizer"

    def test_register_duplicate_email(self, api):
        email = f"dup_{uuid.uuid4().hex[:8]}@test.com"
        payload = {"email": email, "password": "password123", "name": "Dup", "role": "consumer"}
        r1 = api.post(f"{BASE_URL}/api/auth/register", json=payload)
        assert r1.status_code == 200
        r2 = api.post(f"{BASE_URL}/api/auth/register", json=payload)
        assert r2.status_code == 400

    def test_login_consumer(self, consumer):
        assert consumer["user"]["role"] == "consumer"
        assert consumer["user"]["email"] == "demo@consumer.com"
        assert consumer["access_token"]

    def test_login_organizer(self, organizer):
        assert organizer["user"]["role"] == "organizer"
        assert organizer["user"]["email"] == "demo@organizer.com"

    def test_login_wrong_password(self, api):
        r = api.post(f"{BASE_URL}/api/auth/login",
                     json={"email": "demo@consumer.com", "password": "wrong"})
        assert r.status_code == 401

    def test_me_endpoint(self, api, consumer_headers):
        r = api.get(f"{BASE_URL}/api/auth/me", headers=consumer_headers)
        assert r.status_code == 200
        assert r.json()["email"] == "demo@consumer.com"
        assert r.json()["role"] == "consumer"

    def test_me_no_token(self, api):
        r = requests.get(f"{BASE_URL}/api/auth/me")
        assert r.status_code in (401, 403)


# ---------- Events (public listing) ----------

class TestEventsListing:
    def test_list_events_no_filter(self, api):
        r = api.get(f"{BASE_URL}/api/events")
        assert r.status_code == 200
        events = r.json()
        assert isinstance(events, list)
        assert len(events) >= 5, f"Expected seeded events, got {len(events)}"

    def test_list_events_with_geo(self, api):
        r = api.get(f"{BASE_URL}/api/events",
                    params={"lat": SF_LAT, "lng": SF_LNG, "radius_km": 10})
        assert r.status_code == 200
        events = r.json()
        assert len(events) >= 1
        for e in events:
            assert e["distance_km"] is not None
            assert e["distance_km"] <= 10

    def test_list_events_radius_filter(self, api):
        # Very small radius should return fewer (or zero) events
        r = api.get(f"{BASE_URL}/api/events",
                    params={"lat": 0.0, "lng": 0.0, "radius_km": 1})
        assert r.status_code == 200
        assert r.json() == []

    def test_list_events_category(self, api):
        r = api.get(f"{BASE_URL}/api/events", params={"category": "Music"})
        assert r.status_code == 200
        events = r.json()
        assert len(events) >= 1
        assert all(e["category"] == "Music" for e in events)

    def test_get_event_by_id(self, api):
        events = api.get(f"{BASE_URL}/api/events").json()
        eid = events[0]["id"]
        r = api.get(f"{BASE_URL}/api/events/{eid}")
        assert r.status_code == 200
        assert r.json()["id"] == eid

    def test_get_event_not_found(self, api):
        r = api.get(f"{BASE_URL}/api/events/does-not-exist")
        assert r.status_code == 404


# ---------- Event CRUD (organizer) ----------

class TestEventCRUD:
    def test_create_seat_map_event(self, api, organizer_headers):
        payload = {
            "title": "TEST Seat Map Event",
            "description": "Test description",
            "category": "Music",
            "date": "2026-06-01T18:00:00Z",
            "location_name": "Test Venue",
            "latitude": SF_LAT, "longitude": SF_LNG,
            "price": 25.0,
            "booking_type": "seat_map",
            "seat_rows": 5, "seat_cols": 6,
        }
        r = api.post(f"{BASE_URL}/api/events", json=payload, headers=organizer_headers)
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["booking_type"] == "seat_map"
        assert data["seat_rows"] == 5
        pytest.seat_map_event_id = data["id"]
        # Verify GET
        g = api.get(f"{BASE_URL}/api/events/{data['id']}")
        assert g.status_code == 200
        assert g.json()["title"] == "TEST Seat Map Event"

    def test_create_general_event(self, api, organizer_headers):
        payload = {
            "title": "TEST General Event",
            "description": "General admission",
            "category": "Food",
            "date": "2026-06-05T18:00:00Z",
            "location_name": "Test Venue G",
            "latitude": SF_LAT, "longitude": SF_LNG,
            "price": 10.0,
            "booking_type": "general",
            "total_seats": 5,
        }
        r = api.post(f"{BASE_URL}/api/events", json=payload, headers=organizer_headers)
        assert r.status_code == 200
        pytest.general_event_id = r.json()["id"]

    def test_create_time_slot_event(self, api, organizer_headers):
        payload = {
            "title": "TEST TimeSlot Event",
            "description": "Slots",
            "category": "Tech",
            "date": "2026-06-10T09:00:00Z",
            "location_name": "Test Venue T",
            "latitude": SF_LAT, "longitude": SF_LNG,
            "price": 0.0,
            "booking_type": "time_slot",
            "time_slots": ["09:00", "10:00", "11:00"],
        }
        r = api.post(f"{BASE_URL}/api/events", json=payload, headers=organizer_headers)
        assert r.status_code == 200
        pytest.time_slot_event_id = r.json()["id"]

    def test_consumer_cannot_create_event(self, api, consumer_headers):
        payload = {
            "title": "Forbidden", "description": "x", "category": "Music",
            "date": "2026-06-01T18:00:00Z", "location_name": "x",
            "latitude": 0, "longitude": 0, "price": 0,
            "booking_type": "general", "total_seats": 10,
        }
        r = api.post(f"{BASE_URL}/api/events", json=payload, headers=consumer_headers)
        assert r.status_code == 403

    def test_update_event_owner(self, api, organizer_headers):
        r = api.put(f"{BASE_URL}/api/events/{pytest.seat_map_event_id}",
                    json={"title": "TEST Seat Map Updated"}, headers=organizer_headers)
        assert r.status_code == 200
        assert r.json()["title"] == "TEST Seat Map Updated"

    def test_update_event_not_owner(self, api):
        # Register a second organizer
        email = f"other_org_{uuid.uuid4().hex[:8]}@test.com"
        r = api.post(f"{BASE_URL}/api/auth/register", json={
            "email": email, "password": "password123", "name": "Other", "role": "organizer"})
        other_headers = {"Authorization": f"Bearer {r.json()['access_token']}"}
        r2 = api.put(f"{BASE_URL}/api/events/{pytest.seat_map_event_id}",
                     json={"title": "hack"}, headers=other_headers)
        assert r2.status_code == 403

    def test_organizer_events_only_own(self, api, organizer_headers):
        r = api.get(f"{BASE_URL}/api/organizer/events", headers=organizer_headers)
        assert r.status_code == 200
        events = r.json()
        assert len(events) >= 3  # at least our 3 test events + seeded ones
        # All must belong to demo organizer
        first_org_id = events[0]["organizer_id"]
        assert all(e["organizer_id"] == first_org_id for e in events)

    def test_organizer_events_forbidden_for_consumer(self, api, consumer_headers):
        r = api.get(f"{BASE_URL}/api/organizer/events", headers=consumer_headers)
        assert r.status_code == 403

    def test_booked_seats_endpoint(self, api):
        r = api.get(f"{BASE_URL}/api/events/{pytest.seat_map_event_id}/booked-seats")
        assert r.status_code == 200
        data = r.json()
        assert "booked_seats" in data
        assert "booked_slots" in data
        assert "total_general_booked" in data


# ---------- Bookings ----------

class TestBookings:
    def test_book_seat_map(self, api, consumer_headers):
        r = api.post(f"{BASE_URL}/api/bookings",
                     json={"event_id": pytest.seat_map_event_id, "seats": ["A1", "A2"]},
                     headers=consumer_headers)
        assert r.status_code == 200, r.text
        b = r.json()
        assert b["total_price"] == 25.0 * 2
        assert b["seats"] == ["A1", "A2"]
        pytest.seat_map_booking_id = b["id"]

    def test_double_book_seat(self, api, consumer_headers):
        r = api.post(f"{BASE_URL}/api/bookings",
                     json={"event_id": pytest.seat_map_event_id, "seats": ["A1"]},
                     headers=consumer_headers)
        # SEC-003: conflicting reservations now return 409 (was 400).
        assert r.status_code == 409

    def test_book_general(self, api, consumer_headers):
        r = api.post(f"{BASE_URL}/api/bookings",
                     json={"event_id": pytest.general_event_id, "num_seats": 3},
                     headers=consumer_headers)
        assert r.status_code == 200
        assert r.json()["total_price"] == 30.0

    def test_general_over_capacity(self, api, consumer_headers):
        # already booked 3 of 5, try booking 10 -> should fail
        r = api.post(f"{BASE_URL}/api/bookings",
                     json={"event_id": pytest.general_event_id, "num_seats": 10},
                     headers=consumer_headers)
        assert r.status_code == 409

    def test_book_time_slot(self, api, consumer_headers):
        r = api.post(f"{BASE_URL}/api/bookings",
                     json={"event_id": pytest.time_slot_event_id, "time_slot": "09:00"},
                     headers=consumer_headers)
        assert r.status_code == 200
        pytest.time_slot_booking_id = r.json()["id"]

    def test_time_slot_double_book(self, api, consumer_headers):
        r = api.post(f"{BASE_URL}/api/bookings",
                     json={"event_id": pytest.time_slot_event_id, "time_slot": "09:00"},
                     headers=consumer_headers)
        assert r.status_code == 409

    def test_organizer_cannot_book(self, api, organizer_headers):
        r = api.post(f"{BASE_URL}/api/bookings",
                     json={"event_id": pytest.time_slot_event_id, "time_slot": "10:00"},
                     headers=organizer_headers)
        assert r.status_code == 403

    def test_bookings_me(self, api, consumer_headers):
        r = api.get(f"{BASE_URL}/api/bookings/me", headers=consumer_headers)
        assert r.status_code == 200
        bookings = r.json()
        assert len(bookings) >= 3
        # verify event embedded
        assert any(b.get("event") for b in bookings)

    def test_cancel_booking(self, api, consumer_headers):
        r = api.post(f"{BASE_URL}/api/bookings/{pytest.time_slot_booking_id}/cancel",
                     headers=consumer_headers)
        assert r.status_code == 200
        # verify status
        r2 = api.get(f"{BASE_URL}/api/bookings/me", headers=consumer_headers)
        booking = next(b for b in r2.json() if b["id"] == pytest.time_slot_booking_id)
        assert booking["status"] == "cancelled"


# ---------- Analytics ----------

class TestAnalytics:
    def test_organizer_analytics(self, api, organizer_headers):
        r = api.get(f"{BASE_URL}/api/analytics/organizer", headers=organizer_headers)
        assert r.status_code == 200
        data = r.json()
        for k in ("total_revenue", "total_tickets", "total_events",
                  "unique_attendees", "per_event", "category_breakdown"):
            assert k in data
        assert data["total_events"] >= 3
        assert data["total_revenue"] >= 80.0  # 50 seat_map + 30 general (time_slot cancelled)
        assert data["total_tickets"] >= 5
        assert isinstance(data["per_event"], list)
        assert isinstance(data["category_breakdown"], dict)

    def test_analytics_forbidden_for_consumer(self, api, consumer_headers):
        r = api.get(f"{BASE_URL}/api/analytics/organizer", headers=consumer_headers)
        assert r.status_code == 403


# ---------- Cleanup (delete test events) ----------

class TestZCleanup:
    def test_delete_seat_map_event(self, api, organizer_headers):
        r = api.delete(f"{BASE_URL}/api/events/{pytest.seat_map_event_id}",
                       headers=organizer_headers)
        assert r.status_code == 200
        # verify 404 on GET
        assert api.get(f"{BASE_URL}/api/events/{pytest.seat_map_event_id}").status_code == 404

    def test_delete_general_event(self, api, organizer_headers):
        r = api.delete(f"{BASE_URL}/api/events/{pytest.general_event_id}",
                       headers=organizer_headers)
        assert r.status_code == 200

    def test_delete_time_slot_event(self, api, organizer_headers):
        r = api.delete(f"{BASE_URL}/api/events/{pytest.time_slot_event_id}",
                       headers=organizer_headers)
        assert r.status_code == 200
