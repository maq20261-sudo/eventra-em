"""Regression coverage for the multi-role Firebase signup flow.

Reproduces the June-2026 bug where a user who already registered as
organizer got a 409 when trying to register as attendee with the same
details (multi-role feature was expected to allow it).

Uses the FIREBASE_DEV_BYPASS mode: verify_id_token() accepts a JSON blob
`{"uid": ..., "phone_number": ...}` in place of a real ID token so we can
exercise the endpoint without a real Firebase project.
"""
import asyncio
import json
import os
import uuid
from pathlib import Path

import requests
from dotenv import load_dotenv
from motor.motor_asyncio import AsyncIOMotorClient

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "http://localhost:8001").rstrip("/")


def _mock_token(uid: str, phone: str) -> str:
    return json.dumps({"uid": uid, "phone_number": phone})


def _cleanup(email: str, mobile_stored: str, fbuid: str) -> None:
    load_dotenv(Path(__file__).resolve().parent.parent / ".env")

    async def wipe():
        c = AsyncIOMotorClient(os.environ["MONGO_URL"])
        db = c[os.environ.get("DB_NAME", "test_database")]
        await db.users.delete_many({
            "$or": [
                {"email": email},
                {"mobile": mobile_stored},
                {"firebase_uid": fbuid},
            ],
        })

    asyncio.get_event_loop().run_until_complete(wipe())


class TestMultiRoleFirebase:
    """Requires FIREBASE_DEV_BYPASS=1 in the backend env. If disabled these
    tests are skipped (dev-bypass is off in prod)."""

    def setup_method(self):
        # These tests need FIREBASE_DEV_BYPASS=1 so we can forge tokens.
        # Skip cleanly when it's off (which is the case in production).
        if os.environ.get("FIREBASE_DEV_BYPASS") != "1":
            import pytest
            pytest.skip("FIREBASE_DEV_BYPASS not enabled — skipping mocked signup tests")
        # Test-scoped fixture data.
        self.email = f"multi-{uuid.uuid4().hex[:8]}@example.com"
        self.phone_e164 = f"+9198{uuid.uuid4().int % 10**8:08d}"
        self.mobile_stored = self.phone_e164.lstrip("+")
        self.fbuid = f"FBUID-{uuid.uuid4().hex[:10]}"
        self.token = _mock_token(self.fbuid, self.phone_e164)
        _cleanup(self.email, self.mobile_stored, self.fbuid)

    def teardown_method(self):
        _cleanup(self.email, self.mobile_stored, self.fbuid)

    def _signup(self, role: str, email: str = None):
        body = {
            "id_token": self.token,
            "name": "Test User",
            "email": email or self.email,
            "password": "password123",
            "role": role,
        }
        return requests.post(f"{BASE_URL}/api/auth/firebase-verify", json=body)

    def test_organizer_then_attendee_same_details_succeeds(self):
        """The reported bug: organizer signs up first, then attendee with
        the same email/phone should ALSO succeed."""
        r_org = self._signup("organizer")
        assert r_org.status_code == 200, r_org.text
        assert r_org.json()["user"]["role"] == "organizer"

        r_att = self._signup("consumer")
        assert r_att.status_code == 200, (
            f"attendee signup with same email+phone as organizer should ALSO "
            f"succeed. Got {r_att.status_code}: {r_att.text}"
        )
        assert r_att.json()["user"]["role"] == "consumer"

    def test_double_submit_is_idempotent(self):
        """Network flake / double-tap resilience: submitting the SAME
        signup twice returns 200 both times (fresh token for existing
        user) rather than a spurious 409."""
        r1 = self._signup("consumer")
        assert r1.status_code == 200, r1.text
        user_id_1 = r1.json()["user"]["id"]

        r2 = self._signup("consumer")
        assert r2.status_code == 200, r2.text
        user_id_2 = r2.json()["user"]["id"]

        # Same underlying user, different (still valid) tokens.
        assert user_id_1 == user_id_2, "idempotent retry must return the same user"

    def test_same_phone_different_email_same_role_conflicts(self):
        """Legitimate same-role duplicate — phone is already an attendee
        with a DIFFERENT email. That's a real collision, not a retry."""
        r1 = self._signup("consumer")
        assert r1.status_code == 200, r1.text
        r2 = self._signup("consumer", email="other@example.com")
        assert r2.status_code == 409, r2.text
        assert "Attendee" in r2.json()["detail"]

    def test_login_after_multi_role_signup_asks_to_pick(self):
        """After both roles exist, /login without a role should return
        multiple_roles: true so the client can prompt."""
        assert self._signup("organizer").status_code == 200
        assert self._signup("consumer").status_code == 200
        r = requests.post(f"{BASE_URL}/api/auth/login", json={
            "email": self.email, "password": "password123",
        })
        assert r.status_code == 200, r.text
        body = r.json()
        assert body.get("multiple_roles") is True
        assert sorted(body["roles"]) == ["consumer", "organizer"]
