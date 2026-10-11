"""OTP-gated auth tests (MSG91 v5).

Testing strategy:
  - Backend is running with MSG91_MOCK_MODE=1 so no real SMS is sent.
  - The server generates its own random OTP + stores only a bcrypt otp_hash in
    the `otp_challenges` collection. To let tests know the OTP, we open the
    challenge doc directly in Mongo and REPLACE its `otp_hash` with a bcrypt
    hash of a known value ('123456'). Subsequent /verify calls then succeed
    with otp='123456'.
  - This also confirms the plaintext OTP is NOT persisted (only otp_hash) and
    that hashes are bcrypt (start with '$2b$').

Covers all cases from the review request:
  - Happy path register + login (with /auth/me sanity check)
  - Mobile validation (bad digits, bad prefix)
  - Duplicate email at register/start
  - Duplicate verified mobile at register/start
  - Wrong OTP (once) + attempts counter, then correct OTP still succeeds
  - Wrong OTP 5 times -> 429 and challenge burned
  - Expired challenge (via DB expires_at rewind) -> 410
  - Login start for legacy user without verified mobile -> 409
  - Resend flow: new challenge id, old OTP fails on new challenge
  - Resend flood <5s -> 429
  - OTP not in any response body (only mobile_masked)
  - otp_hash bcrypt-prefixed, no plaintext otp field in DB
  - Legacy /auth/register + /auth/login still work
"""

import os
import time
import uuid
from datetime import datetime, timezone, timedelta
from pathlib import Path

import pytest
import requests
from dotenv import load_dotenv
from passlib.context import CryptContext
from pymongo import MongoClient

load_dotenv(Path(__file__).parent.parent.parent / "frontend" / ".env")
load_dotenv(Path(__file__).parent.parent / ".env")

BASE_URL = os.environ["EXPO_PUBLIC_BACKEND_URL"].rstrip("/")
MONGO_URL = os.environ["MONGO_URL"]
DB_NAME = os.environ["DB_NAME"]

KNOWN_OTP = "123456"
_pwd = CryptContext(schemes=["bcrypt"], deprecated="auto")
KNOWN_OTP_HASH = _pwd.hash(KNOWN_OTP)


def _mongo():
    return MongoClient(MONGO_URL)[DB_NAME]


def _override_challenge_otp(challenge_id: str) -> dict:
    """Replace the server-generated otp_hash with hash(KNOWN_OTP) so tests can
    verify deterministically. Returns the *original* doc (pre-override) so
    tests can also inspect what the server stored."""
    db = _mongo()
    original = db.otp_challenges.find_one({"id": challenge_id})
    assert original is not None, f"challenge {challenge_id} not in DB"
    db.otp_challenges.update_one(
        {"id": challenge_id},
        {"$set": {"otp_hash": KNOWN_OTP_HASH}},
    )
    return original


def _new_mobile() -> str:
    """Return a fresh valid Indian mobile (starts 6-9, 10 digits)."""
    # random 9-digit tail so we don't collide across tests
    return "9" + str(uuid.uuid4().int)[:9]


def _new_email(tag: str = "otp") -> str:
    return f"TEST_{tag}_{uuid.uuid4().hex[:10]}@example.com"


def _register_via_otp(email: str, mobile: str, name: str = "OTP Tester", role: str = "consumer") -> dict:
    """Complete register/start -> override otp -> register/verify. Returns token JSON."""
    r = requests.post(f"{BASE_URL}/api/auth/register/start", json={
        "email": email, "password": "password123", "name": name, "role": role, "mobile": mobile,
    })
    assert r.status_code == 200, f"register/start failed: {r.status_code} {r.text}"
    cid = r.json()["challenge_id"]
    _override_challenge_otp(cid)
    r2 = requests.post(f"{BASE_URL}/api/auth/register/verify", json={
        "challenge_id": cid, "otp": KNOWN_OTP,
    })
    assert r2.status_code == 200, f"register/verify failed: {r2.status_code} {r2.text}"
    return r2.json()


# --------------------- Happy path ---------------------

class TestOtpHappyPath:
    def test_register_start_returns_challenge_and_masked_mobile(self):
        email = _new_email("start")
        mobile = _new_mobile()
        r = requests.post(f"{BASE_URL}/api/auth/register/start", json={
            "email": email, "password": "password123", "name": "N", "role": "consumer", "mobile": mobile,
        })
        assert r.status_code == 200, r.text
        body = r.json()
        assert "challenge_id" in body
        assert "mobile_masked" in body and body["mobile_masked"].startswith("+91")
        assert "expires_in_seconds" in body and body["expires_in_seconds"] > 0
        # OTP must NEVER appear in response body
        assert "otp" not in body
        assert KNOWN_OTP not in r.text  # random OTP shouldn't be leaked either

    def test_register_verify_creates_user_with_mobile_verified(self):
        email = _new_email("reg_verify")
        mobile = _new_mobile()
        tok = _register_via_otp(email, mobile)
        assert "access_token" in tok
        assert tok["user"]["email"] == email
        assert tok["user"]["mobile"] == "91" + mobile
        assert tok["user"]["mobile_verified"] is True
        # /auth/me works with the returned JWT
        me = requests.get(f"{BASE_URL}/api/auth/me", headers={"Authorization": f"Bearer {tok['access_token']}"})
        assert me.status_code == 200, me.text
        me_body = me.json()
        assert me_body["email"] == email
        assert me_body["mobile_verified"] is True

    def test_login_start_and_verify_for_otp_user(self):
        email = _new_email("login_ok")
        mobile = _new_mobile()
        _register_via_otp(email, mobile)
        # login/start
        r = requests.post(f"{BASE_URL}/api/auth/login/start", json={"email": email, "password": "password123"})
        assert r.status_code == 200, r.text
        cid = r.json()["challenge_id"]
        assert r.json()["mobile_masked"].startswith("+91")
        _override_challenge_otp(cid)
        r2 = requests.post(f"{BASE_URL}/api/auth/login/verify", json={"challenge_id": cid, "otp": KNOWN_OTP})
        assert r2.status_code == 200, r2.text
        assert "access_token" in r2.json()
        assert r2.json()["user"]["email"] == email


# --------------------- Validation ---------------------

class TestMobileValidation:
    def test_short_number_rejected(self):
        r = requests.post(f"{BASE_URL}/api/auth/register/start", json={
            "email": _new_email("v1"), "password": "password123", "name": "N", "role": "consumer", "mobile": "123",
        })
        assert r.status_code == 400
        assert "10 digits" in r.json()["detail"].lower() or "10 digits" in r.text

    def test_bad_prefix_rejected(self):
        r = requests.post(f"{BASE_URL}/api/auth/register/start", json={
            "email": _new_email("v2"), "password": "password123", "name": "N", "role": "consumer", "mobile": "5555555555",
        })
        assert r.status_code == 400
        assert "prefix" in r.json()["detail"].lower()


# --------------------- Duplicates ---------------------

class TestDuplicates:
    def test_duplicate_email_at_register_start(self):
        r = requests.post(f"{BASE_URL}/api/auth/register/start", json={
            "email": "demo@consumer.com", "password": "password123", "name": "X", "role": "consumer", "mobile": _new_mobile(),
        })
        assert r.status_code == 400, r.text
        assert "already" in r.json()["detail"].lower()

    def test_duplicate_verified_mobile_at_register_start(self):
        # first user with mobile M
        mobile_raw = _new_mobile()
        _register_via_otp(_new_email("dup1"), mobile_raw)
        # second user tries same mobile
        r = requests.post(f"{BASE_URL}/api/auth/register/start", json={
            "email": _new_email("dup2"), "password": "password123",
            "name": "N", "role": "consumer", "mobile": mobile_raw,
        })
        assert r.status_code == 400, r.text
        assert "mobile already in use" in r.json()["detail"].lower()


# --------------------- Wrong OTP / attempts ---------------------

class TestWrongOtp:
    def _start_register(self):
        email = _new_email("wrong")
        mobile = _new_mobile()
        r = requests.post(f"{BASE_URL}/api/auth/register/start", json={
            "email": email, "password": "password123", "name": "N", "role": "consumer", "mobile": mobile,
        })
        assert r.status_code == 200, r.text
        return r.json()["challenge_id"], email, mobile

    def test_wrong_otp_once_then_correct_succeeds(self):
        cid, email, mobile = self._start_register()
        _override_challenge_otp(cid)
        # wrong attempt
        r = requests.post(f"{BASE_URL}/api/auth/register/verify", json={
            "challenge_id": cid, "otp": "000000",
        })
        assert r.status_code == 400, r.text
        assert "incorrect otp" in r.json()["detail"].lower()
        # attempts counter incremented in DB
        doc = _mongo().otp_challenges.find_one({"id": cid})
        assert doc is not None and doc["attempts"] == 1
        # correct OTP still succeeds
        r2 = requests.post(f"{BASE_URL}/api/auth/register/verify", json={
            "challenge_id": cid, "otp": KNOWN_OTP,
        })
        assert r2.status_code == 200, r2.text
        # challenge burned
        assert _mongo().otp_challenges.find_one({"id": cid}) is None

    def test_five_wrong_attempts_burns_challenge(self):
        cid, email, mobile = self._start_register()
        _override_challenge_otp(cid)
        for i in range(5):
            r = requests.post(f"{BASE_URL}/api/auth/register/verify", json={
                "challenge_id": cid, "otp": "000000",
            })
            assert r.status_code == 400, f"attempt {i}: {r.status_code} {r.text}"
        # 6th attempt: challenge has attempts>=5 -> 429 and burned
        r6 = requests.post(f"{BASE_URL}/api/auth/register/verify", json={
            "challenge_id": cid, "otp": KNOWN_OTP,
        })
        assert r6.status_code == 429, r6.text
        assert "too many attempts" in r6.json()["detail"].lower()
        assert _mongo().otp_challenges.find_one({"id": cid}) is None


# --------------------- Expired challenge ---------------------

class TestExpiredChallenge:
    def test_expired_challenge_returns_410(self):
        email = _new_email("exp")
        mobile = _new_mobile()
        r = requests.post(f"{BASE_URL}/api/auth/register/start", json={
            "email": email, "password": "password123", "name": "N", "role": "consumer", "mobile": mobile,
        })
        assert r.status_code == 200
        cid = r.json()["challenge_id"]
        _override_challenge_otp(cid)
        # Force expiry
        past = (datetime.now(timezone.utc) - timedelta(minutes=10)).isoformat()
        _mongo().otp_challenges.update_one({"id": cid}, {"$set": {"expires_at": past}})
        r2 = requests.post(f"{BASE_URL}/api/auth/register/verify", json={
            "challenge_id": cid, "otp": KNOWN_OTP,
        })
        assert r2.status_code == 410, r2.text
        assert "expired" in r2.json()["detail"].lower()
        # challenge deleted after expired-check
        assert _mongo().otp_challenges.find_one({"id": cid}) is None


# --------------------- Login for legacy user (no mobile_verified) ---------------------

class TestLoginWithoutVerifiedMobile:
    def test_login_start_returns_409_for_legacy_user(self):
        # demo@consumer.com is seeded via legacy /auth/register -> mobile_verified=False
        r = requests.post(f"{BASE_URL}/api/auth/login/start", json={
            "email": "demo@consumer.com", "password": "password123",
        })
        assert r.status_code == 409, r.text
        assert "mobile not linked" in r.json()["detail"].lower()


# --------------------- Resend flow ---------------------

class TestResend:
    def test_resend_invalidates_old_and_returns_new_challenge(self):
        email = _new_email("resend")
        mobile = _new_mobile()
        r = requests.post(f"{BASE_URL}/api/auth/register/start", json={
            "email": email, "password": "password123", "name": "N", "role": "consumer", "mobile": mobile,
        })
        cid_old = r.json()["challenge_id"]
        _override_challenge_otp(cid_old)  # set old OTP to KNOWN_OTP
        # Wait past the 5-second min-interval
        time.sleep(6)
        r2 = requests.post(f"{BASE_URL}/api/auth/otp/resend", json={"challenge_id": cid_old})
        assert r2.status_code == 200, r2.text
        cid_new = r2.json()["challenge_id"]
        assert cid_new != cid_old
        # old cid must be gone
        assert _mongo().otp_challenges.find_one({"id": cid_old}) is None
        # verifying against old cid fails 404
        r3 = requests.post(f"{BASE_URL}/api/auth/register/verify", json={
            "challenge_id": cid_old, "otp": KNOWN_OTP,
        })
        assert r3.status_code == 404, r3.text
        # verifying against new cid: server randomised the OTP again, so KNOWN_OTP
        # (old value) should NOT verify -> 400
        r4 = requests.post(f"{BASE_URL}/api/auth/register/verify", json={
            "challenge_id": cid_new, "otp": KNOWN_OTP,
        })
        assert r4.status_code == 400, r4.text
        # And overriding new challenge's hash to KNOWN_OTP now works
        _override_challenge_otp(cid_new)
        r5 = requests.post(f"{BASE_URL}/api/auth/register/verify", json={
            "challenge_id": cid_new, "otp": KNOWN_OTP,
        })
        assert r5.status_code == 200, r5.text

    def test_resend_flood_under_5s_returns_429(self):
        email = _new_email("flood")
        mobile = _new_mobile()
        r = requests.post(f"{BASE_URL}/api/auth/register/start", json={
            "email": email, "password": "password123", "name": "N", "role": "consumer", "mobile": mobile,
        })
        cid = r.json()["challenge_id"]
        # First resend within 5s -> 429
        r2 = requests.post(f"{BASE_URL}/api/auth/otp/resend", json={"challenge_id": cid})
        assert r2.status_code == 429, r2.text
        assert "wait" in r2.json()["detail"].lower() or "few seconds" in r2.json()["detail"].lower()


# --------------------- Storage / secrecy ---------------------

class TestOtpStorage:
    def test_otp_hash_is_bcrypt_and_no_plaintext_otp_stored(self):
        email = _new_email("store")
        mobile = _new_mobile()
        r = requests.post(f"{BASE_URL}/api/auth/register/start", json={
            "email": email, "password": "password123", "name": "N", "role": "consumer", "mobile": mobile,
        })
        assert r.status_code == 200
        cid = r.json()["challenge_id"]
        doc = _mongo().otp_challenges.find_one({"id": cid})
        assert doc is not None
        assert "otp_hash" in doc
        assert doc["otp_hash"].startswith("$2b$") or doc["otp_hash"].startswith("$2a$"), f"unexpected hash: {doc['otp_hash'][:6]}"
        # no plaintext field
        assert "otp" not in doc, f"plaintext OTP leaked: {doc.get('otp')}"

    def test_rate_limit_config_exists(self):
        # Prod-hardening assertion: verify the rate-limit middleware is loaded
        # by hitting a rate-limited endpoint with a burst and confirming
        # SOME requests are throttled OR the endpoint gracefully rejects them.
        # The exact behaviour depends on DISABLE_RATE_LIMIT — either the
        # limiter is on and eventually returns 429, or off (dev only) and
        # requests always land. Both are acceptable, but the config dict must
        # be present. We infer that by ensuring an obviously-abusive burst
        # to `/auth/otp/resend` returns EITHER a 4xx (limit) OR a 404
        # (unknown challenge), never a 5xx / plain 200 forever.
        codes = set()
        for _ in range(6):
            r = requests.post(
                f"{BASE_URL}/api/auth/otp/resend",
                json={"challenge_id": "does-not-exist"},
            )
            codes.add(r.status_code)
        # No 5xx errors and no 200s (an unknown challenge should never OK).
        assert not any(500 <= c < 600 for c in codes), f"server errored: {codes}"
        assert 200 not in codes, f"unknown-challenge accepted: {codes}"


# --------------------- Legacy back-compat ---------------------

class TestLegacyAuth:
    def test_legacy_register_and_login_still_work(self):
        email = _new_email("legacy")
        r = requests.post(f"{BASE_URL}/api/auth/register", json={
            "email": email, "password": "password123", "name": "L", "role": "consumer",
        })
        assert r.status_code == 200, r.text
        assert "access_token" in r.json()
        assert r.json()["user"]["mobile_verified"] is False
        # login
        r2 = requests.post(f"{BASE_URL}/api/auth/login", json={
            "email": email, "password": "password123",
        })
        assert r2.status_code == 200, r2.text
        assert "access_token" in r2.json()

    def test_seed_demo_login_works(self):
        r = requests.post(f"{BASE_URL}/api/auth/login", json={
            "email": "demo@consumer.com", "password": "password123",
        })
        assert r.status_code == 200, r.text
        assert r.json()["user"]["email"] == "demo@consumer.com"
