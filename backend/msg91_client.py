"""MSG91 SMS OTP client (v5 API).

Uses control.msg91.com/api/v5/otp — the modern OTP API with template_id.
Supports a MOCK MODE for unit tests (set MSG91_MOCK_MODE=1 in env).

Env vars required:
  MSG91_AUTHKEY       - authentication key from MSG91 panel
  MSG91_TEMPLATE_ID   - DLT-approved OTP template ID (24-char hex)
  MSG91_SENDER_ID     - numeric/6-alpha sender ID
  MSG91_OTP_TTL_MINUTES (default 5)
  MSG91_OTP_LENGTH    (default 6)
  MSG91_MOCK_MODE     (default "0"; when "1" no real SMS is sent, and any
                       6-digit OTP verifies as long as it matches the challenge)
"""
from __future__ import annotations
import os
import re
import secrets
from typing import Optional

import httpx

MSG91_AUTHKEY = os.environ.get("MSG91_AUTHKEY", "")
MSG91_TEMPLATE_ID = os.environ.get("MSG91_TEMPLATE_ID", "")
MSG91_SENDER_ID = os.environ.get("MSG91_SENDER_ID", "")
OTP_TTL = int(os.environ.get("MSG91_OTP_TTL_MINUTES", "5"))
OTP_LENGTH = int(os.environ.get("MSG91_OTP_LENGTH", "6"))
MOCK_MODE = os.environ.get("MSG91_MOCK_MODE", "0").lower() in ("1", "true", "yes")

BASE_URL = "https://control.msg91.com/api/v5"


class MSG91Error(Exception):
    """Wraps MSG91 API failures."""


def normalize_in_mobile(raw: str) -> str:
    """Accepts '+91 98765 43210', '9876543210', '919876543210', etc.
    Returns '91XXXXXXXXXX' (12 digits). Raises ValueError for non-Indian numbers.
    """
    digits = re.sub(r"\D", "", raw or "")
    if digits.startswith("91") and len(digits) == 12:
        digits = digits[2:]
    if len(digits) != 10:
        raise ValueError("India mobile must be 10 digits")
    if digits[0] not in "6789":
        raise ValueError("Not a valid India mobile prefix (must start 6/7/8/9)")
    return "91" + digits


def mask_mobile(mobile91: str) -> str:
    """91XXXXXXXXXX → +91 98XX XX3210 (for logs / UI)."""
    if not mobile91 or len(mobile91) < 12:
        return mobile91 or ""
    core = mobile91[2:]
    return f"+91 {core[:2]}XX XX{core[-4:]}"


def generate_otp() -> str:
    """Server-side OTP generation so we can verify locally in MOCK_MODE and
    also send it explicitly to MSG91 (rather than letting them auto-generate)."""
    return "".join(secrets.choice("0123456789") for _ in range(OTP_LENGTH))


async def send_otp(mobile91: str, otp: str) -> None:
    """Send OTP via MSG91 v5 API. Raises MSG91Error on failure."""
    if MOCK_MODE:
        print(f"[MSG91 MOCK] send_otp mobile={mask_mobile(mobile91)} otp={otp}")
        return
    if not MSG91_AUTHKEY or not MSG91_TEMPLATE_ID:
        raise MSG91Error("MSG91 not configured (missing authkey or template_id)")

    params = {
        "template_id": MSG91_TEMPLATE_ID,
        "mobile": mobile91,
        "authkey": MSG91_AUTHKEY,
        "otp": otp,
        "otp_expiry": OTP_TTL,
        "otp_length": OTP_LENGTH,
    }
    if MSG91_SENDER_ID:
        params["sender"] = MSG91_SENDER_ID

    try:
        async with httpx.AsyncClient(timeout=10) as client:
            r = await client.post(f"{BASE_URL}/otp", params=params, headers={"accept": "application/json"})
        data = r.json() if r.headers.get("content-type", "").startswith("application/json") else {}
        # Always log MSG91's response so we can debug delivery failures (200 OK
        # from MSG91 doesn't imply SMS was actually sent — the body carries the
        # real result e.g. {"type":"error","message":"template not approved"}).
        print(f"[MSG91] send_otp mobile={mask_mobile(mobile91)} http={r.status_code} body={data or r.text!r}")
        if r.status_code >= 400 or data.get("type") == "error":
            msg = data.get("message") or r.text
            raise MSG91Error(f"MSG91 send failed: {msg}")
    except httpx.HTTPError as e:
        raise MSG91Error(f"MSG91 network error: {e}") from e


async def verify_otp_remote(mobile91: str, otp: str) -> bool:
    """Verify OTP via MSG91 v5 verify endpoint. Used ONLY if you let MSG91
    auto-generate the OTP. We generate + send our own, so we verify locally
    against the challenge doc — this helper is provided for completeness."""
    if MOCK_MODE:
        return True
    if not MSG91_AUTHKEY:
        raise MSG91Error("MSG91 not configured")
    params = {"authkey": MSG91_AUTHKEY, "mobile": mobile91, "otp": otp}
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            r = await client.get(f"{BASE_URL}/otp/verify", params=params)
        data = r.json() if r.headers.get("content-type", "").startswith("application/json") else {}
        return bool(r.status_code < 400 and data.get("type") == "success")
    except httpx.HTTPError as e:
        raise MSG91Error(f"MSG91 network error: {e}") from e
