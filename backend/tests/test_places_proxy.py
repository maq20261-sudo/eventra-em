"""Tests for Google Places server-side proxy endpoints.

Covers:
- POST /api/places/autocomplete  (auth required, returns suggestions)
- POST /api/places/details       (auth required, returns lat/lng)
- POST /api/places/reverse       (graceful fallback)
- No response ever leaks GOOGLE_MAPS_API_KEY.
"""
import os
import uuid
import json
from pathlib import Path
import pytest
from dotenv import load_dotenv

# Load backend/.env so we can check that GOOGLE_MAPS_API_KEY doesn't leak
load_dotenv(Path(__file__).parent.parent / ".env")
API_KEY_ENV = (os.environ.get("GOOGLE_MAPS_API_KEY") or "").strip()


class TestPlacesAutocomplete:
    def test_requires_auth(self, api, base_url):
        r = api.post(
            f"{base_url}/api/places/autocomplete",
            json={"input": "phoenix marketcity mumbai", "session_token": str(uuid.uuid4())},
            headers={"Authorization": ""},
        )
        assert r.status_code in (401, 403), r.text

    def test_returns_suggestions(self, api, base_url, organizer_headers):
        body = {
            "input": "phoenix marketcity mumbai",
            "session_token": str(uuid.uuid4()),
        }
        r = api.post(
            f"{base_url}/api/places/autocomplete",
            json=body,
            headers=organizer_headers,
        )
        # If upstream key/quota fails, endpoint may return 502; skip in that case.
        if r.status_code == 502:
            pytest.skip("Google Places upstream unavailable")
        assert r.status_code == 200, r.text
        data = r.json()
        assert "suggestions" in data
        assert isinstance(data["suggestions"], list)
        # At least one suggestion for a well-known place
        assert len(data["suggestions"]) >= 1
        first = data["suggestions"][0]
        assert "place_id" in first and first["place_id"]
        assert "description" in first and first["description"]
        # Ensure no API key leak
        assert API_KEY_ENV == "" or API_KEY_ENV not in r.text

    def test_with_location_bias(self, api, base_url, organizer_headers):
        body = {
            "input": "coffee",
            "session_token": str(uuid.uuid4()),
            "latitude": 19.0760,
            "longitude": 72.8777,
        }
        r = api.post(
            f"{base_url}/api/places/autocomplete", json=body, headers=organizer_headers,
        )
        if r.status_code == 502:
            pytest.skip("Google Places upstream unavailable")
        assert r.status_code == 200, r.text
        assert isinstance(r.json().get("suggestions"), list)


class TestPlacesDetails:
    def test_requires_auth(self, api, base_url):
        r = api.post(
            f"{base_url}/api/places/details",
            json={"place_id": "ChIJxxx", "session_token": str(uuid.uuid4())},
            headers={"Authorization": ""},
        )
        assert r.status_code in (401, 403), r.text

    def test_end_to_end_autocomplete_then_details(self, api, base_url, organizer_headers):
        session_token = str(uuid.uuid4())
        r1 = api.post(
            f"{base_url}/api/places/autocomplete",
            json={"input": "phoenix marketcity mumbai", "session_token": session_token},
            headers=organizer_headers,
        )
        if r1.status_code == 502:
            pytest.skip("Google Places upstream unavailable")
        assert r1.status_code == 200, r1.text
        sugg = r1.json().get("suggestions") or []
        assert sugg, "expected at least one suggestion"
        pid = sugg[0]["place_id"]

        r2 = api.post(
            f"{base_url}/api/places/details",
            json={"place_id": pid, "session_token": session_token},
            headers=organizer_headers,
        )
        if r2.status_code == 502:
            pytest.skip("Google Places upstream unavailable for details")
        assert r2.status_code == 200, r2.text
        d = r2.json()
        assert d.get("place_id")
        assert d.get("latitude") is not None
        assert d.get("longitude") is not None
        assert isinstance(d["latitude"], (int, float))
        assert isinstance(d["longitude"], (int, float))
        # Name/formatted_address should exist (may be None only in exotic cases)
        assert "formatted_address" in d
        assert "name" in d
        # Ensure no API key leak
        assert API_KEY_ENV == "" or API_KEY_ENV not in r2.text


class TestPlacesReverse:
    def test_graceful_response(self, api, base_url, organizer_headers):
        r = api.post(
            f"{base_url}/api/places/reverse",
            json={"latitude": 19.0760, "longitude": 72.8777},
            headers=organizer_headers,
        )
        # Either 200 (Geocoding enabled) or 200 with nulls (graceful).
        assert r.status_code == 200, r.text
        data = r.json()
        assert "formatted_address" in data
        assert "name" in data
        # Ensure no API key leak
        assert API_KEY_ENV == "" or API_KEY_ENV not in r.text

    def test_requires_auth(self, api, base_url):
        r = api.post(
            f"{base_url}/api/places/reverse",
            json={"latitude": 19.0, "longitude": 72.0},
            headers={"Authorization": ""},
        )
        assert r.status_code in (401, 403), r.text

    def test_missing_lat_lng_returns_422(self, api, base_url, organizer_headers):
        r = api.post(
            f"{base_url}/api/places/reverse",
            json={},
            headers=organizer_headers,
        )
        # Missing lat/lng — the endpoint raises 422 when Google is configured.
        # If key isn't configured, returns 200 with nulls (short-circuit).
        assert r.status_code in (200, 422), r.text


class TestNoApiKeyLeak:
    """Sanity guard: none of the Places responses should ever return the raw
    GOOGLE_MAPS_API_KEY value in the body."""

    def test_autocomplete_no_leak(self, api, base_url, organizer_headers):
        if not API_KEY_ENV:
            pytest.skip("No API key configured, nothing to guard against")
        r = api.post(
            f"{base_url}/api/places/autocomplete",
            json={"input": "central park", "session_token": str(uuid.uuid4())},
            headers=organizer_headers,
        )
        assert API_KEY_ENV not in r.text
