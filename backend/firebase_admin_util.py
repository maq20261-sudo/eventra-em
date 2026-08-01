"""Firebase Admin SDK helper — verifies Firebase ID tokens issued after
successful phone-number OTP (via Firebase Phone Auth on the client).

Loading strategy (safe for missing credentials during dev):
  * If the service-account JSON file at FIREBASE_ADMIN_JSON_PATH exists,
    initialize the Admin SDK once. Otherwise, mark as disabled and every
    verify call will raise a clear error.
"""
from __future__ import annotations
import os
import re
import logging
from pathlib import Path
from typing import Optional

import firebase_admin
from firebase_admin import credentials, auth as fb_auth

log = logging.getLogger("firebase")

_ROOT = Path(__file__).parent
_CRED_PATH = Path(os.environ.get(
    "FIREBASE_ADMIN_JSON_PATH",
    str(_ROOT / "credentials" / "firebase-admin.json"),
))

_APP: Optional[firebase_admin.App] = None
_ENABLED = False

try:
    if _CRED_PATH.exists():
        cred = credentials.Certificate(str(_CRED_PATH))
        _APP = firebase_admin.initialize_app(cred, name="gs-firebase")
        _ENABLED = True
        log.info("Firebase Admin initialized (project_id=%s)", _APP.project_id)
    else:
        log.warning("Firebase Admin disabled — credentials not found at %s", _CRED_PATH)
except Exception as e:  # pragma: no cover - init should be deterministic
    log.exception("Firebase Admin init failed: %s", e)


class FirebaseAuthError(Exception):
    """Raised when the client-supplied ID token can't be trusted."""


def is_enabled() -> bool:
    return _ENABLED and _APP is not None


def verify_id_token(id_token: str) -> dict:
    """Verify a Firebase ID token and return the decoded claims dict.
    Raises FirebaseAuthError on any failure (bad signature, expired, revoked,
    or Firebase Admin not initialised)."""
    if not is_enabled():
        raise FirebaseAuthError("Firebase Admin not configured on server")
    try:
        # check_revoked=True adds one extra network call but catches sign-outs.
        claims = fb_auth.verify_id_token(id_token, app=_APP, check_revoked=False)
        return claims
    except fb_auth.ExpiredIdTokenError:
        raise FirebaseAuthError("ID token expired. Please sign in again.")
    except fb_auth.RevokedIdTokenError:
        raise FirebaseAuthError("ID token revoked. Please sign in again.")
    except fb_auth.InvalidIdTokenError as e:
        raise FirebaseAuthError(f"Invalid Firebase ID token: {e}")
    except Exception as e:
        raise FirebaseAuthError(f"Token verification failed: {e}")


def normalize_e164(phone: str) -> str:
    """Return a phone number in E.164 (+91XXXXXXXXXX). Assumes India as
    the default country when the '+' prefix is missing."""
    if not phone:
        raise ValueError("Empty phone")
    digits = re.sub(r"\D", "", phone)
    if phone.startswith("+"):
        return "+" + digits
    if len(digits) == 10 and digits[0] in "6789":
        return "+91" + digits
    if len(digits) == 12 and digits.startswith("91"):
        return "+" + digits
    return "+" + digits
