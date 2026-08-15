from fastapi import FastAPI, APIRouter, HTTPException, Depends, status, Query
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
import os
import re
import logging
import math
import hmac
import hashlib
import base64
from pathlib import Path
from pydantic import BaseModel, Field, EmailStr, model_validator
from typing import List, Optional, Literal, Any, Dict
from collections import defaultdict, deque
import uuid
from datetime import datetime, timezone, timedelta
import jwt
from passlib.context import CryptContext
import razorpay
import firebase_admin_util as fb

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ['DB_NAME']]

# SEC hardening: fail-closed on missing JWT secret in production.
APP_ENV = os.environ.get("APP_ENV", "development").lower()
_JWT_SECRET_ENV = os.environ.get("JWT_SECRET_KEY")
if not _JWT_SECRET_ENV:
    if APP_ENV == "production":
        raise RuntimeError(
            "JWT_SECRET_KEY is required in production. Refusing to start with a default secret."
        )
    _JWT_SECRET_ENV = "gatherspace-dev-only-secret-do-not-use-in-prod"
SECRET_KEY = _JWT_SECRET_ENV
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 60 * 24 * 7  # 7 days

RAZORPAY_KEY_ID = os.environ.get("RAZORPAY_KEY_ID", "rzp_test_placeholder")
RAZORPAY_KEY_SECRET = os.environ.get("RAZORPAY_KEY_SECRET", "placeholder_secret")
_RZP_CONFIGURED = not (
    RAZORPAY_KEY_ID.endswith("placeholder") or RAZORPAY_KEY_SECRET.endswith("placeholder_secret")
)
rzp_client = razorpay.Client(auth=(RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET))

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
security = HTTPBearer()

app = FastAPI()
api_router = APIRouter(prefix="/api")

# SEC-hardening: simple per-IP rate limiting for sensitive endpoints
# (login, register, payment initiation & verification). Bypasses when
# `DISABLE_RATE_LIMIT=1` in local test envs.
_RATE_LIMITS: Dict[str, Dict[str, Any]] = {
    # These limits are per-IP per-endpoint. Values chosen to comfortably fit
    # a real user's worst-case retry pattern (bad network + fat-finger OTP)
    # while still stopping automated brute-force / spam.
    "/api/auth/login": {"max": 20, "window_s": 60},
    "/api/auth/register": {"max": 15, "window_s": 60},
    "/api/auth/register/start": {"max": 20, "window_s": 60},
    "/api/auth/register/verify": {"max": 30, "window_s": 60},
    "/api/auth/login/start": {"max": 20, "window_s": 60},
    "/api/auth/login/verify": {"max": 30, "window_s": 60},
    "/api/auth/otp/resend": {"max": 6, "window_s": 60},
    "/api/auth/firebase-verify": {"max": 20, "window_s": 60},
    "/api/auth/password-reset/verify": {"max": 10, "window_s": 60},
    "/api/payments/order": {"max": 20, "window_s": 60},
    "/api/payments/verify": {"max": 40, "window_s": 60},
    "/api/payments/refund": {"max": 5, "window_s": 60},
}
_RATE_STATE: Dict[str, Dict[str, deque]] = defaultdict(lambda: defaultdict(deque))
_RL_DISABLED = os.environ.get("DISABLE_RATE_LIMIT", "").lower() in ("1", "true", "yes")
# Only honour X-Forwarded-For if the deployment sits behind a trusted proxy
# (Kubernetes ingress, CDN, etc.). Attackers can spoof this header when we
# accept it blindly; opt in via env only in production.
_TRUST_XFF = os.environ.get("TRUST_X_FORWARDED_FOR", "").lower() in ("1", "true", "yes")


@app.middleware("http")
async def rate_limit_middleware(request, call_next):
    if _RL_DISABLED:
        return await call_next(request)
    cfg = _RATE_LIMITS.get(request.url.path)
    if cfg and request.method == "POST":
        client_ip = (request.client.host if request.client else "unknown")
        if _TRUST_XFF:
            fwd = request.headers.get("x-forwarded-for")
            if fwd:
                client_ip = fwd.split(",")[0].strip() or client_ip
        bucket = _RATE_STATE[request.url.path][client_ip]
        now = datetime.now(timezone.utc).timestamp()
        window = cfg["window_s"]
        while bucket and (now - bucket[0]) > window:
            bucket.popleft()
        if len(bucket) >= cfg["max"]:
            from fastapi.responses import JSONResponse
            retry_after = int(window - (now - bucket[0])) if bucket else window
            return JSONResponse(
                status_code=429,
                content={"detail": "Too many requests. Please slow down."},
                headers={"Retry-After": str(max(1, retry_after))},
            )
        bucket.append(now)
    return await call_next(request)

# ---------- Models ----------

class UserCreate(BaseModel):
    email: EmailStr
    password: str = Field(min_length=6)
    name: str
    role: Literal["consumer", "organizer"]
    mobile: Optional[str] = None

class UserLogin(BaseModel):
    email: EmailStr
    password: str
    # Optional role — used when the same (email, password) matches multiple
    # accounts (e.g. same email registered as both attendee + organizer).
    role: Optional[Literal["consumer", "organizer"]] = None

class OtpStartRegister(BaseModel):
    email: EmailStr
    password: str = Field(min_length=6)
    name: str
    role: Literal["consumer", "organizer"]
    mobile: str

class OtpStartLogin(BaseModel):
    email: EmailStr
    password: str

class OtpVerify(BaseModel):
    challenge_id: str
    otp: str = Field(min_length=4, max_length=8)

class OtpResend(BaseModel):
    challenge_id: str

class FirebaseVerifyBody(BaseModel):
    """Payload for `/auth/firebase-verify` — the signup-only endpoint.
    All fields except id_token are required: we insist that phone-verified
    users also set an email + password so they can sign in with either
    factor going forward."""
    id_token: str
    name: str = Field(min_length=1, max_length=80)
    email: EmailStr
    password: str = Field(min_length=8, max_length=128)
    role: Literal["consumer", "organizer"] = "consumer"

class PasswordResetVerifyBody(BaseModel):
    """Payload for `/auth/password-reset/verify`.
    Client verifies a fresh Firebase Phone OTP → hands us the id_token
    proving ownership of the phone → we set a new password on that user."""
    id_token: str
    new_password: str = Field(min_length=8, max_length=128)
    # Required when the mobile has both an attendee and organizer account.
    # If omitted and only one account exists, we reset that one.
    role: Optional[Literal["consumer", "organizer"]] = None

class UserOut(BaseModel):
    id: str
    email: str
    name: str
    role: str
    mobile: Optional[str] = None
    mobile_verified: bool = False

class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserOut

# SEC-hardening: shared image validator — cap base64/data URIs at 3 MiB
# decoded to prevent MongoDB document bloat / DoS via oversized banners.
_MAX_IMAGE_BYTES = 3 * 1024 * 1024  # 3 MiB decoded


def _validate_image_url(value: Optional[str]) -> Optional[str]:
    if value is None or value == "":
        return value
    if not isinstance(value, str):
        raise ValueError("image_url must be a string")
    if len(value) > 8 * 1024 * 1024:  # 8 MB raw string safeguard
        raise ValueError("image_url is too large")
    if value.startswith("data:"):
        try:
            header, b64 = value.split(",", 1)
        except ValueError as e:
            raise ValueError("Invalid data URI") from e
        if not header.startswith("data:image/") or ";base64" not in header:
            raise ValueError("Only base64-encoded images are accepted for uploads")
        # Estimate decoded size cheaply from base64 length.
        approx_bytes = (len(b64) * 3) // 4
        if approx_bytes > _MAX_IMAGE_BYTES:
            raise ValueError("Image exceeds 3 MB. Please upload a smaller image.")
        try:
            base64.b64decode(b64[:64] + "==", validate=False)  # sanity check header
        except Exception as e:
            raise ValueError("Invalid base64 image data") from e
    elif not (value.startswith("http://") or value.startswith("https://")):
        raise ValueError("image_url must be an http(s) URL or a data:image/* base64 URI")
    return value


class EventCreate(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    description: str = Field(min_length=1, max_length=5000)
    category: str = Field(min_length=1, max_length=64)  # Music, Art, Tech, Food, Sports, Other
    image_url: Optional[str] = None
    date: str  # ISO
    location_name: str = Field(min_length=1, max_length=200)
    latitude: float = Field(ge=-90.0, le=90.0)
    longitude: float = Field(ge=-180.0, le=180.0)
    price: float = Field(default=0.0, ge=0.0, le=10_000_000.0)
    booking_type: Literal["seat_map", "general", "time_slot"]
    # For seat_map
    seat_rows: Optional[int] = Field(default=None, ge=1, le=100)
    seat_cols: Optional[int] = Field(default=None, ge=1, le=100)
    # For general
    total_seats: Optional[int] = Field(default=None, ge=1, le=1_000_000)
    # For time_slot — accepts either List[str] (legacy) or List[{"time":str, "capacity":int}] (new).
    # Normalized to List[str] + slot_capacities dict in _normalize_time_slots below.
    time_slots: Optional[List[Any]] = None
    slot_capacity: Optional[int] = Field(default=1, ge=1, le=100_000)  # DEFAULT seats per slot (legacy fallback)

    @model_validator(mode="after")
    def _validate_image(self):
        self.image_url = _validate_image_url(self.image_url)
        return self

class EventUpdate(BaseModel):
    title: Optional[str] = Field(default=None, min_length=1, max_length=200)
    description: Optional[str] = Field(default=None, min_length=1, max_length=5000)
    category: Optional[str] = Field(default=None, min_length=1, max_length=64)
    image_url: Optional[str] = None
    date: Optional[str] = None
    location_name: Optional[str] = Field(default=None, min_length=1, max_length=200)
    latitude: Optional[float] = Field(default=None, ge=-90.0, le=90.0)
    longitude: Optional[float] = Field(default=None, ge=-180.0, le=180.0)
    price: Optional[float] = Field(default=None, ge=0.0, le=10_000_000.0)
    # For time_slot events: allow organizer to edit slots + per-slot capacity.
    time_slots: Optional[List[Any]] = None
    slot_capacity: Optional[int] = Field(default=None, ge=1, le=100_000)

    @model_validator(mode="after")
    def _validate_image(self):
        self.image_url = _validate_image_url(self.image_url)
        return self

class EventOut(BaseModel):
    id: str
    title: str
    description: str
    category: str
    image_url: Optional[str] = None
    date: str
    location_name: str
    latitude: float
    longitude: float
    price: float
    booking_type: str
    seat_rows: Optional[int] = None
    seat_cols: Optional[int] = None
    total_seats: Optional[int] = None
    time_slots: Optional[List[str]] = None
    slot_capacity: Optional[int] = 1
    # Per-slot capacity map: {"10:00": 20, "11:00": 30, ...}. May be None on
    # legacy events (fallback to `slot_capacity` for those).
    slot_capacities: Optional[Dict[str, int]] = None
    # Per-slot availability array parallel to `time_slots`:
    #   [{time, capacity, booked, remaining, sold_out}]
    slots_info: Optional[List[Dict[str, Any]]] = None
    organizer_id: str
    organizer_name: str
    booked_count: int = 0
    distance_km: Optional[float] = None
    is_featured: bool = False
    featured_until: Optional[str] = None
    created_at: str

class BookingCreate(BaseModel):
    event_id: str
    seats: Optional[List[str]] = None  # e.g., ["A1", "A2"] for seat_map
    num_seats: Optional[int] = None  # for general
    time_slot: Optional[str] = None  # for time_slot

class BookingOut(BaseModel):
    id: str
    event_id: str
    event: Optional[EventOut] = None
    user_id: str
    user_name: Optional[str] = None
    seats: Optional[List[str]] = None
    num_seats: Optional[int] = None
    time_slot: Optional[str] = None
    total_price: float
    status: str  # confirmed / cancelled / checked_in
    payment_status: str = "free"  # paid / unpaid / free / refunded / refund_pending / refund_failed
    checked_in: bool = False
    checked_in_at: Optional[str] = None
    created_at: str
    cancelled_at: Optional[str] = None
    refund: Optional[Dict[str, Any]] = None  # {status, id, amount, provider, processed_at, note}

# ---------- Helpers ----------

def hash_password(p: str) -> str:
    return pwd_context.hash(p)

def verify_password(p: str, h: str) -> bool:
    try:
        return pwd_context.verify(p, h)
    except Exception:
        return False

def create_access_token(payload: dict) -> str:
    data = payload.copy()
    data["exp"] = datetime.now(timezone.utc) + timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    return jwt.encode(data, SECRET_KEY, algorithm=ALGORITHM)

def _mint_user_token(user: dict) -> str:
    """Include a per-user `tv` (token version) claim so we can invalidate all
    outstanding sessions by bumping the field in Mongo (e.g. on password
    reset / logout). Sessions issued before the bump will fail the tv
    equality check in `get_current_user` and be rejected.

    Default 0 (not 1) so that a `$inc` on a missing field — which starts
    from 0 and lands at 1 — is properly distinguished from tokens minted
    before the bump.
    """
    return create_access_token({
        "sub": user["id"],
        "role": user["role"],
        "tv": int(user.get("token_version", 0)),
    })

async def _bump_token_version(user_id: str) -> None:
    """Invalidate every JWT previously issued for this user."""
    await db.users.update_one({"id": user_id}, {"$inc": {"token_version": 1}})

async def get_current_user(creds: HTTPAuthorizationCredentials = Depends(security)):
    token = creds.credentials
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        user_id = payload.get("sub")
        token_version = payload.get("tv", 1)
        if not user_id:
            raise HTTPException(status_code=401, detail="Invalid token")
    except jwt.PyJWTError:
        raise HTTPException(status_code=401, detail="Invalid token")
    user = await db.users.find_one({"id": user_id}, {"_id": 0})
    if not user:
        raise HTTPException(status_code=401, detail="User not found")
    # SEC hardening: reject stale sessions after password reset / logout.
    if int(user.get("token_version", 0)) != int(token_version):
        raise HTTPException(status_code=401, detail="Session expired. Please sign in again.")
    return user

def require_role(role: str):
    async def dep(user=Depends(get_current_user)):
        if user["role"] != role:
            raise HTTPException(status_code=403, detail=f"Requires {role} role")
        return user
    return dep

def haversine_km(lat1, lon1, lat2, lon2):
    R = 6371.0
    dLat = math.radians(lat2 - lat1)
    dLon = math.radians(lon2 - lon1)
    a = (math.sin(dLat/2)**2 + math.cos(math.radians(lat1)) *
         math.cos(math.radians(lat2)) * math.sin(dLon/2)**2)
    c = 2 * math.atan2(math.sqrt(a), math.sqrt(1-a))
    return R * c

def event_doc_to_out(e: dict, distance_km: Optional[float] = None) -> dict:
    now_iso = datetime.now(timezone.utc).isoformat()
    featured_until = e.get("featured_until")
    is_featured = bool(featured_until and featured_until > now_iso)
    return {
        "id": e["id"],
        "title": e["title"],
        "description": e.get("description", ""),
        "category": e.get("category", "Other"),
        "image_url": e.get("image_url"),
        "date": e["date"],
        "location_name": e["location_name"],
        "latitude": e["latitude"],
        "longitude": e["longitude"],
        "price": e.get("price", 0.0),
        "booking_type": e["booking_type"],
        "seat_rows": e.get("seat_rows"),
        "seat_cols": e.get("seat_cols"),
        "total_seats": e.get("total_seats"),
        "time_slots": e.get("time_slots"),
        "slot_capacity": e.get("slot_capacity", 1),
        "slot_capacities": e.get("slot_capacities"),
        "slots_info": e.get("slots_info"),
        "organizer_id": e["organizer_id"],
        "organizer_name": e.get("organizer_name", "Organizer"),
        "booked_count": e.get("booked_count", 0),
        "distance_km": distance_km,
        "is_featured": is_featured,
        "featured_until": featured_until,
        "created_at": e["created_at"],
    }

# ---------- Auth Routes ----------

def _user_out(user: dict) -> UserOut:
    return UserOut(
        id=user["id"], email=user["email"], name=user["name"], role=user["role"],
        mobile=user.get("mobile"), mobile_verified=bool(user.get("mobile_verified")),
    )

@api_router.post("/auth/register", response_model=TokenResponse)
async def register(body: UserCreate):
    """Register a new account. The same email can be registered as both
    "consumer" and "organizer" (two independent accounts) so long as the
    role differs — we only reject a duplicate (email, role) pair."""
    if await db.users.find_one({"email": body.email, "role": body.role}):
        # Neutral message to avoid confirming account existence to attackers.
        raise HTTPException(status_code=400, detail="Unable to register with these details. Please sign in if you already have an account.")
    user_id = str(uuid.uuid4())
    doc = {
        "id": user_id,
        "email": body.email,
        "name": body.name,
        "role": body.role,
        "password_hash": hash_password(body.password),
        "mobile": body.mobile,
        "mobile_verified": False,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "token_version": 0,
    }
    await db.users.insert_one(doc)
    token = _mint_user_token(doc)
    return TokenResponse(access_token=token, user=_user_out(doc))

@api_router.post("/auth/login")
async def login(body: UserLogin):
    """Sign in with email + password. If the same email exists as multiple
    roles and the caller didn't specify one, we return a 200 payload asking
    the client to prompt the user for role selection."""
    # Collect all accounts under this email whose password matches. This
    # lets a user share the same password (or different ones) across roles.
    all_users = await db.users.find({"email": body.email}).to_list(None)
    matched = [u for u in all_users if verify_password(body.password, u["password_hash"])]

    # SEC-003: constant-work path. If no candidate accounts exist, still run
    # a dummy bcrypt verify so response time doesn't distinguish "unknown
    # email" from "wrong password".
    if not all_users:
        verify_password(body.password, "$2b$12$" + "a" * 53)

    if not matched:
        raise HTTPException(status_code=401, detail="Invalid email or password")

    # Role explicitly requested? Filter down to that role.
    if body.role:
        matched = [u for u in matched if u["role"] == body.role]
        if not matched:
            # Uniform message — never disclose whether the role exists.
            raise HTTPException(status_code=401, detail="Invalid email or password")

    if len(matched) > 1:
        # Two accounts (attendee + organizer) both matched. Ask the client
        # to disambiguate — we return HTTP 200 with a flag so the app can
        # surface a role picker without treating this as an auth failure.
        return {
            "multiple_roles": True,
            "roles": sorted({u["role"] for u in matched}),
            "message": "This email is registered as multiple roles. Please choose which account to sign in as.",
        }

    user = matched[0]
    token = _mint_user_token(user)
    return TokenResponse(access_token=token, user=_user_out(user)).model_dump()

# ---------- OTP-gated Auth (MSG91) ----------

import msg91_client as msg91

async def _send_challenge(kind: str, email: str, mobile91: str, extra: Optional[dict] = None) -> str:
    """Create a fresh OTP challenge doc + send SMS. Returns challenge_id."""
    otp = msg91.generate_otp()
    challenge_id = str(uuid.uuid4())
    now = datetime.now(timezone.utc)
    doc = {
        "id": challenge_id,
        "kind": kind,  # 'register' or 'login'
        "email": email,
        "mobile": mobile91,
        "otp_hash": hash_password(otp),  # never store plaintext OTP
        "attempts": 0,
        "expires_at": (now + timedelta(minutes=msg91.OTP_TTL)).isoformat(),
        "created_at": now.isoformat(),
        "extra": extra or {},
    }
    await db.otp_challenges.insert_one(doc)
    try:
        await msg91.send_otp(mobile91, otp)
    except msg91.MSG91Error as e:
        # rollback so a broken send doesn't leave a dangling challenge
        await db.otp_challenges.delete_one({"id": challenge_id})
        raise HTTPException(status_code=502, detail=f"Couldn't send OTP: {e}")
    return challenge_id

async def _consume_challenge(challenge_id: str, otp: str, kind: str) -> dict:
    ch = await db.otp_challenges.find_one({"id": challenge_id, "kind": kind})
    if not ch:
        raise HTTPException(status_code=404, detail="Challenge not found or expired")
    if datetime.fromisoformat(ch["expires_at"]) < datetime.now(timezone.utc):
        await db.otp_challenges.delete_one({"id": challenge_id})
        raise HTTPException(status_code=410, detail="OTP expired. Please request a new one.")
    if ch["attempts"] >= 5:
        await db.otp_challenges.delete_one({"id": challenge_id})
        raise HTTPException(status_code=429, detail="Too many attempts. Please request a new OTP.")
    if not verify_password(otp, ch["otp_hash"]):
        await db.otp_challenges.update_one({"id": challenge_id}, {"$inc": {"attempts": 1}})
        raise HTTPException(status_code=400, detail="Incorrect OTP")
    # success — burn the challenge
    await db.otp_challenges.delete_one({"id": challenge_id})
    return ch

@api_router.post("/auth/register/start")
async def register_start(body: OtpStartRegister):
    try:
        mobile91 = msg91.normalize_in_mobile(body.mobile)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    if await db.users.find_one({"email": body.email}):
        raise HTTPException(status_code=400, detail="Email already registered")
    if await db.users.find_one({"mobile": mobile91, "mobile_verified": True}):
        raise HTTPException(status_code=400, detail="Mobile already in use")
    extra = {
        "password_hash": hash_password(body.password),
        "name": body.name,
        "role": body.role,
    }
    cid = await _send_challenge("register", body.email, mobile91, extra=extra)
    return {"challenge_id": cid, "mobile_masked": msg91.mask_mobile(mobile91), "expires_in_seconds": msg91.OTP_TTL * 60}

@api_router.post("/auth/register/verify", response_model=TokenResponse)
async def register_verify(body: OtpVerify):
    ch = await _consume_challenge(body.challenge_id, body.otp, "register")
    if await db.users.find_one({"email": ch["email"]}):
        raise HTTPException(status_code=400, detail="Email already registered")
    user_id = str(uuid.uuid4())
    doc = {
        "id": user_id,
        "email": ch["email"],
        "name": ch["extra"]["name"],
        "role": ch["extra"]["role"],
        "password_hash": ch["extra"]["password_hash"],
        "mobile": ch["mobile"],
        "mobile_verified": True,
        "mobile_verified_at": datetime.now(timezone.utc).isoformat(),
        "created_at": datetime.now(timezone.utc).isoformat(),
        "token_version": 0,
    }
    await db.users.insert_one(doc)
    token = _mint_user_token(doc)
    return TokenResponse(access_token=token, user=_user_out(doc))

@api_router.post("/auth/login/start")
async def login_start(body: OtpStartLogin):
    user = await db.users.find_one({"email": body.email})
    if not user or not verify_password(body.password, user["password_hash"]):
        raise HTTPException(status_code=401, detail="Invalid email or password")
    if not user.get("mobile") or not user.get("mobile_verified"):
        raise HTTPException(status_code=409, detail="Mobile not linked. Please complete mobile verification from Profile before logging in with OTP.")
    cid = await _send_challenge("login", body.email, user["mobile"], extra={"user_id": user["id"]})
    return {"challenge_id": cid, "mobile_masked": msg91.mask_mobile(user["mobile"]), "expires_in_seconds": msg91.OTP_TTL * 60}

@api_router.post("/auth/login/verify", response_model=TokenResponse)
async def login_verify(body: OtpVerify):
    ch = await _consume_challenge(body.challenge_id, body.otp, "login")
    user = await db.users.find_one({"id": ch["extra"]["user_id"]})
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    token = _mint_user_token(user)
    return TokenResponse(access_token=token, user=_user_out(user))

@api_router.post("/auth/otp/resend")
async def otp_resend(body: OtpResend):
    old = await db.otp_challenges.find_one({"id": body.challenge_id})
    if not old:
        raise HTTPException(status_code=404, detail="Challenge not found")
    # Enforce a small min-interval on resends (5s) to prevent spam
    created = datetime.fromisoformat(old["created_at"])
    if (datetime.now(timezone.utc) - created).total_seconds() < 5:
        raise HTTPException(status_code=429, detail="Please wait a few seconds before requesting a new OTP")
    await db.otp_challenges.delete_one({"id": body.challenge_id})
    cid = await _send_challenge(old["kind"], old["email"], old["mobile"], extra=old.get("extra"))
    return {"challenge_id": cid, "mobile_masked": msg91.mask_mobile(old["mobile"]), "expires_in_seconds": msg91.OTP_TTL * 60}


# ---------- Firebase Phone Auth (SIGNUP ONLY — login uses /auth/login) -----
@api_router.post("/auth/firebase-verify", response_model=TokenResponse)
async def firebase_verify(body: FirebaseVerifyBody):
    """Signup endpoint. The app runs a Firebase Phone Auth challenge on the
    client and hands us the resulting ID token. After verifying the token
    (proves phone ownership) we create a fresh account with the caller's
    email + password, so they can later sign in with either factor.

    We reject if the phone, email, or firebase_uid is already tied to any
    existing user — the caller should sign in via `/auth/login` instead of
    trying to re-register.
    """
    if not fb.is_enabled():
        raise HTTPException(status_code=503, detail="Firebase Admin not configured on server")
    try:
        claims = fb.verify_id_token(body.id_token)
    except fb.FirebaseAuthError as e:
        raise HTTPException(status_code=401, detail=str(e))

    phone_number = claims.get("phone_number")
    firebase_uid = claims.get("uid") or claims.get("user_id")
    if not phone_number or not firebase_uid:
        raise HTTPException(status_code=400, detail="Firebase token missing phone number claim")

    mobile_stored = phone_number.lstrip("+")
    email = body.email.strip().lower()
    name = body.name.strip()

    # Refuse duplicates FOR THIS ROLE only. The same phone/email may be
    # registered as both attendee and organizer — those are two separate
    # accounts. But re-registering the same (email OR mobile, role) triple
    # would create a genuine duplicate.
    existing = await db.users.find_one({
        "$and": [
            {"role": body.role},
            {"$or": [
                {"firebase_uid": firebase_uid},
                {"mobile": mobile_stored},
                {"email": email},
            ]},
        ]
    })
    if existing:
        # We deliberately don't leak WHICH field collided — otherwise this
        # doubles as an account-enumeration oracle.
        raise HTTPException(
            status_code=409,
            detail="An account with this role is already registered on this phone/email. Please sign in instead.",
        )

    now_iso = datetime.now(timezone.utc).isoformat()
    user = {
        "id": str(uuid.uuid4()),
        "email": email,
        "name": name,
        "role": body.role,
        "password_hash": hash_password(body.password),
        "mobile": mobile_stored,
        "mobile_verified": True,
        "mobile_verified_at": now_iso,
        "firebase_uid": firebase_uid,
        "created_at": now_iso,
        "auth_provider": "firebase_phone",
        "token_version": 0,
    }
    await db.users.insert_one(user)

    token = _mint_user_token(user)
    return TokenResponse(access_token=token, user=_user_out(user))


# ---------- Password Reset (Firebase Phone OTP-gated) ----------
@api_router.post("/auth/password-reset/verify")
async def password_reset_verify(body: PasswordResetVerifyBody):
    """The client (a) collects the user's mobile, (b) runs Firebase Phone
    Auth to get an id_token proving ownership, (c) collects a new password,
    then posts everything here. We match the token's phone to a user, swap
    their password, and issue a fresh JWT so they land in the app signed-in.
    """
    if not fb.is_enabled():
        raise HTTPException(status_code=503, detail="Verification service is unavailable. Please try again later.")
    try:
        claims = fb.verify_id_token(body.id_token)
    except fb.FirebaseAuthError as e:
        # Deliberately generic — never leak whether a phone/email is registered.
        raise HTTPException(status_code=401, detail="Verification failed. Please request a new OTP and retry.")

    phone_number = claims.get("phone_number")
    firebase_uid = claims.get("uid") or claims.get("user_id")
    if not phone_number:
        raise HTTPException(status_code=400, detail="Missing phone number in verification token.")
    mobile_stored = phone_number.lstrip("+")

    # Find ALL users on this mobile (up to two: attendee + organizer).
    users = await db.users.find({"mobile": mobile_stored}).to_list(None)
    if not users and firebase_uid:
        users = await db.users.find({"firebase_uid": firebase_uid}).to_list(None)

    if not users:
        raise HTTPException(
            status_code=404,
            detail="No account is registered with this mobile number. Please sign up first.",
        )

    # Multi-role disambiguation.
    if len(users) > 1 and not body.role:
        return {
            "multiple_roles": True,
            "roles": sorted({u["role"] for u in users}),
            "message": "This mobile is registered as multiple roles. Please choose which account to reset.",
        }
    if body.role:
        users = [u for u in users if u["role"] == body.role]
        if not users:
            raise HTTPException(status_code=404, detail="No account for this role. Please sign up first.")
    user = users[0]

    now_iso = datetime.now(timezone.utc).isoformat()
    await db.users.update_one(
        {"id": user["id"]},
        {"$set": {
            "password_hash": hash_password(body.new_password),
            "password_reset_at": now_iso,
            # Keep the firebase_uid in sync — helps future flows.
            "firebase_uid": firebase_uid or user.get("firebase_uid"),
            "mobile_verified": True,
        },
         # SEC: invalidate every previously-issued JWT so an attacker who
         # already stole a token can't stay signed in through a reset.
         "$inc": {"token_version": 1}},
    )
    # Reload so the newly-minted token carries the fresh token_version.
    user = await db.users.find_one({"id": user["id"]}, {"_id": 0})

    token = _mint_user_token(user)
    return TokenResponse(access_token=token, user=_user_out(user)).model_dump()


@api_router.get("/auth/me", response_model=UserOut)
async def me(user=Depends(get_current_user)):
    return _user_out(user)


@api_router.post("/auth/logout")
async def logout(user=Depends(get_current_user)):
    """Server-side logout — bumps the user's token_version so every JWT
    already issued for them becomes invalid immediately (including any
    stolen ones sitting on a compromised device)."""
    await _bump_token_version(user["id"])
    return {"ok": True, "message": "Signed out on all devices"}

# ---------- Event Helpers ----------

DEFAULT_SLOT_CAPACITY = 50

def _normalize_time_slots(raw: Any, default_capacity: int) -> tuple:
    """Accept either List[str] (legacy) or List[{"time","capacity"}] (new).
    Returns (time_slot_labels, {label: capacity}). Duplicates keep the last
    capacity. Empty/blank labels are dropped. Capacity clamped to [1, 100_000].
    """
    labels: List[str] = []
    caps: Dict[str, int] = {}
    if not raw:
        return labels, caps
    for item in raw:
        if isinstance(item, str):
            label = item.strip()
            cap = int(default_capacity or 1)
        elif isinstance(item, dict):
            label = str(item.get("time", "")).strip()
            try:
                cap = int(item.get("capacity") or default_capacity or 1)
            except (TypeError, ValueError):
                cap = int(default_capacity or 1)
        else:
            continue
        if not label:
            continue
        cap = max(1, min(100_000, cap))
        if label not in labels:
            labels.append(label)
        caps[label] = cap
    return labels, caps

# ---------- Event Routes ----------

@api_router.post("/events", response_model=EventOut)
async def create_event(body: EventCreate, user=Depends(require_role("organizer"))):
    event_id = str(uuid.uuid4())
    doc = body.model_dump()
    # Normalize time_slots so we store labels + capacities separately.
    if doc.get("booking_type") == "time_slot":
        default_cap = int(doc.get("slot_capacity") or DEFAULT_SLOT_CAPACITY)
        labels, caps = _normalize_time_slots(doc.get("time_slots"), default_cap)
        if not labels:
            raise HTTPException(status_code=400, detail="At least one time slot is required")
        doc["time_slots"] = labels
        doc["slot_capacities"] = caps
        # Keep `slot_capacity` for legacy fallback but reflect the highest.
        doc["slot_capacity"] = max(caps.values()) if caps else default_cap
    else:
        doc["time_slots"] = None
        doc["slot_capacities"] = None
    doc.update({
        "id": event_id,
        "organizer_id": user["id"],
        "organizer_name": user["name"],
        "booked_count": 0,
        "created_at": datetime.now(timezone.utc).isoformat(),
    })
    await db.events.insert_one(doc)
    doc.pop("_id", None)
    out = event_doc_to_out(doc)
    out["slots_info"] = await _compute_slots_info(doc)
    return out

@api_router.get("/events", response_model=List[EventOut])
async def list_events(
    lat: Optional[float] = None,
    lng: Optional[float] = None,
    radius_km: float = 10.0,
    category: Optional[str] = None,
    search: Optional[str] = None,
):
    query = {}
    if category and category != "All":
        query["category"] = category
    if search:
        # SEC-hardening: escape user input to prevent ReDoS / regex injection,
        # cap length, and search only via case-insensitive substring match.
        safe = re.escape(search.strip())[:128]
        if safe:
            query["title"] = {"$regex": safe, "$options": "i"}
    events = await db.events.find(query, {"_id": 0}).to_list(500)
    results = []
    for e in events:
        distance = None
        if lat is not None and lng is not None:
            distance = haversine_km(lat, lng, e["latitude"], e["longitude"])
            if distance > radius_km:
                continue
        results.append(event_doc_to_out(e, distance))
    # Sort: featured first, then by distance/date
    def sort_key(x):
        featured_rank = 0 if x.get("is_featured") else 1
        if lat is not None and lng is not None:
            secondary = x["distance_km"] if x.get("distance_km") is not None else 9999
        else:
            secondary = x["date"]
        return (featured_rank, secondary)
    results.sort(key=sort_key)
    return results

async def _compute_slots_info(e: dict) -> Optional[List[Dict[str, Any]]]:
    """For time_slot events, returns per-slot availability so the client can
    show "N seats left" and disable sold-out slots."""
    if e.get("booking_type") != "time_slot" or not e.get("time_slots"):
        return None
    fallback_cap = int(e.get("slot_capacity") or DEFAULT_SLOT_CAPACITY)
    slot_caps: Dict[str, int] = e.get("slot_capacities") or {}
    # Count confirmed / checked-in bookings grouped by slot, summing num_seats
    # so that group time-slot bookings (>1 seat per booking) are counted
    # correctly.
    cursor = db.bookings.aggregate([
        {"$match": {"event_id": e["id"], "status": {"$in": ["confirmed", "checked_in"]}}},
        {"$group": {"_id": "$time_slot", "n": {"$sum": {"$ifNull": ["$num_seats", 1]}}}},
    ])
    counts = {row["_id"]: row["n"] async for row in cursor}
    out = []
    for slot in e["time_slots"]:
        cap = int(slot_caps.get(slot, fallback_cap))
        booked = int(counts.get(slot, 0))
        remaining = max(0, cap - booked)
        out.append({
            "time": slot,
            "capacity": cap,
            "booked": booked,
            "remaining": remaining,
            "sold_out": remaining <= 0,
        })
    return out


@api_router.get("/events/{event_id}", response_model=EventOut)
async def get_event(event_id: str):
    e = await db.events.find_one({"id": event_id}, {"_id": 0})
    if not e:
        raise HTTPException(status_code=404, detail="Event not found")
    out = event_doc_to_out(e)
    out["slots_info"] = await _compute_slots_info(e)
    return out

@api_router.put("/events/{event_id}", response_model=EventOut)
async def update_event(event_id: str, body: EventUpdate, user=Depends(require_role("organizer"))):
    e = await db.events.find_one({"id": event_id})
    if not e:
        raise HTTPException(status_code=404, detail="Event not found")
    if e["organizer_id"] != user["id"]:
        raise HTTPException(status_code=403, detail="Not your event")
    update_data = {k: v for k, v in body.model_dump().items() if v is not None}
    # If organizer is updating time_slots on a time_slot event, normalize them
    # into labels + capacities. This lets them add slots or adjust per-slot
    # capacity later.
    if "time_slots" in update_data and e.get("booking_type") == "time_slot":
        default_cap = int(update_data.get("slot_capacity") or e.get("slot_capacity") or DEFAULT_SLOT_CAPACITY)
        labels, caps = _normalize_time_slots(update_data["time_slots"], default_cap)
        if not labels:
            raise HTTPException(status_code=400, detail="At least one time slot is required")
        update_data["time_slots"] = labels
        update_data["slot_capacities"] = caps
        update_data["slot_capacity"] = max(caps.values()) if caps else default_cap
    elif "time_slots" in update_data:
        # Non-time_slot events can't have time_slots.
        update_data.pop("time_slots", None)
    if update_data:
        await db.events.update_one({"id": event_id}, {"$set": update_data})
    updated = await db.events.find_one({"id": event_id}, {"_id": 0})
    out = event_doc_to_out(updated)
    out["slots_info"] = await _compute_slots_info(updated)
    return out

@api_router.delete("/events/{event_id}")
async def delete_event(event_id: str, user=Depends(require_role("organizer"))):
    e = await db.events.find_one({"id": event_id})
    if not e:
        raise HTTPException(status_code=404, detail="Event not found")
    if e["organizer_id"] != user["id"]:
        raise HTTPException(status_code=403, detail="Not your event")
    await db.events.delete_one({"id": event_id})
    return {"ok": True}

async def _reconcile_event_availability(event_id: str) -> dict:
    """Rebuild `booked_seats`, `booked_slots`, and `booked_count` on the event
    doc based on the actual bookings collection — the source of truth. This
    self-heals any drift caused by stale data or aborted rollbacks so the
    atomic booking guard is always consistent with the seat-availability view.
    Returns the reconciled event doc (or None if missing).
    """
    bookings = await db.bookings.find(
        {"event_id": event_id, "status": {"$in": ["confirmed", "checked_in"]}},
        {"_id": 0, "seats": 1, "time_slot": 1, "num_seats": 1},
    ).to_list(5000)
    booked_seats: list = []
    booked_slots: list = []
    booked_count = 0
    for b in bookings:
        if b.get("seats"):
            booked_seats.extend(b["seats"])
            booked_count += len(b["seats"])
        elif b.get("time_slot"):
            # Group time-slot bookings support num_seats > 1 (defaults to 1).
            booked_slots.append(b["time_slot"])
            booked_count += int(b.get("num_seats") or 1)
        elif b.get("num_seats"):
            booked_count += int(b["num_seats"] or 0)
    return await db.events.find_one_and_update(
        {"id": event_id},
        {"$set": {
            "booked_seats": booked_seats,
            "booked_slots": booked_slots,
            "booked_count": booked_count,
        }},
        return_document=True,
    )


@api_router.get("/events/{event_id}/booked-seats")
async def get_booked_seats(event_id: str):
    # Self-heal on read so the frontend seat map and the atomic booking
    # guard always see the same source of truth.
    await _reconcile_event_availability(event_id)
    bookings = await db.bookings.find({"event_id": event_id, "status": {"$in": ["confirmed", "checked_in"]}}, {"_id": 0}).to_list(1000)
    booked_seats = []
    booked_slots = []
    total_general = 0
    for b in bookings:
        if b.get("seats"):
            booked_seats.extend(b["seats"])
        if b.get("time_slot"):
            booked_slots.append(b["time_slot"])
        if b.get("num_seats"):
            total_general += b["num_seats"]
    return {
        "booked_seats": booked_seats,
        "booked_slots": booked_slots,
        "total_general_booked": total_general,
    }

@api_router.get("/organizer/events", response_model=List[EventOut])
async def my_events(user=Depends(require_role("organizer"))):
    events = await db.events.find({"organizer_id": user["id"]}, {"_id": 0}).to_list(500)
    events.sort(key=lambda x: x.get("created_at", ""), reverse=True)
    return [event_doc_to_out(e) for e in events]

# ---------- Booking Routes ----------

async def _perform_booking(body: BookingCreate, user: dict, payment: Optional[Dict[str, Any]] = None) -> BookingOut:
    event = await db.events.find_one({"id": body.event_id}, {"_id": 0})
    if not event:
        raise HTTPException(status_code=404, detail="Event not found")

    # SEC-003 fix: compute price + units up front, then perform an ATOMIC
    # capacity/uniqueness check via `findOneAndUpdate` on the events doc.
    # Two concurrent bookings can no longer both pass a stale read.
    #
    # Additionally, to guard against drift between event.booked_seats/slots
    # and the bookings collection (source of truth), we reconcile on failure
    # and retry once — this eliminates a class of "seat just booked" false
    # rejections caused by stale array state.
    booking_id = str(uuid.uuid4())
    booking_type = event["booking_type"]

    async def _try_reserve():
        if booking_type == "seat_map":
            if not body.seats:
                raise HTTPException(status_code=400, detail="Please select seats")
            price = event["price"] * len(body.seats)
            units = len(body.seats)
            cond = {
                "id": body.event_id,
                "booked_seats": {"$not": {"$elemMatch": {"$in": body.seats}}},
            }
            upd = {
                "$inc": {"booked_count": units},
                "$push": {"booked_seats": {"$each": body.seats}},
            }
            return price, units, await db.events.find_one_and_update(cond, upd)

        if booking_type == "general":
            if not body.num_seats or body.num_seats < 1:
                raise HTTPException(status_code=400, detail="Please choose number of seats")
            price = event["price"] * body.num_seats
            units = body.num_seats
            capacity = int(event.get("total_seats") or 0)
            cond = {
                "id": body.event_id,
                "$expr": {"$lte": [{"$add": [{"$ifNull": ["$booked_count", 0]}, units]}, capacity]},
            }
            upd = {"$inc": {"booked_count": units}}
            return price, units, await db.events.find_one_and_update(cond, upd)

        if booking_type == "time_slot":
            if not body.time_slot:
                raise HTTPException(status_code=400, detail="Please pick a time slot")
            if body.time_slot not in (event.get("time_slots") or []):
                raise HTTPException(status_code=400, detail="Selected slot is not available for this event.")
            # Per-slot capacity (falls back to slot_capacity for legacy events).
            slot_caps: Dict[str, int] = event.get("slot_capacities") or {}
            fallback_cap = int(event.get("slot_capacity") or DEFAULT_SLOT_CAPACITY)
            slot_cap = int(slot_caps.get(body.time_slot, fallback_cap))
            # Allow group booking: num_seats optional, defaults to 1 for back-compat.
            units = int(body.num_seats or 1)
            if units < 1:
                raise HTTPException(status_code=400, detail="Please choose at least 1 seat")
            price = event["price"] * units
            # Sum booked seats for this slot from confirmed/checked_in bookings.
            agg = db.bookings.aggregate([
                {"$match": {
                    "event_id": body.event_id,
                    "time_slot": body.time_slot,
                    "status": {"$in": ["confirmed", "checked_in"]},
                }},
                {"$group": {"_id": None, "n": {"$sum": {"$ifNull": ["$num_seats", 1]}}}},
            ])
            existing = 0
            async for row in agg:
                existing = int(row.get("n") or 0)
            if existing + units > slot_cap:
                remaining = max(0, slot_cap - existing)
                raise HTTPException(
                    status_code=409,
                    detail=(f"Only {remaining} seat(s) left in this slot." if remaining > 0
                            else f"This slot is fully booked ({slot_cap}/{slot_cap} seats)."),
                )
            # Atomic guard: increment global booked_count; mark slot in
            # booked_slots array once it becomes full so legacy clients still
            # see it as unavailable.
            cond = {"id": body.event_id}
            upd = {"$inc": {"booked_count": units}}
            if existing + units >= slot_cap:
                upd["$addToSet"] = {"booked_slots": body.time_slot}
            return price, units, await db.events.find_one_and_update(cond, upd)

        raise HTTPException(status_code=400, detail="Invalid booking type")

    # For seat_map / time_slot bookings, always reconcile the event doc's
    # booked_seats / booked_slots from the bookings collection BEFORE the
    # atomic guard. This closes an oversell hole: if the event doc *under*-
    # reports a real booking (drift or partial rollback), the atomic guard's
    # first attempt would otherwise succeed and create a duplicate. Cheap
    # single roundtrip; safer than a retry-on-failure loop.
    if booking_type in ("seat_map", "time_slot"):
        event = await _reconcile_event_availability(body.event_id) or event

    total_price, num_units, result = await _try_reserve()
    if not result:
        # Over-reporting drift: some seats/slots are stale in the event array
        # but no real booking exists for them. Reconcile + retry once.
        await _reconcile_event_availability(body.event_id)
        event = await db.events.find_one({"id": body.event_id}, {"_id": 0}) or event
        total_price, num_units, result = await _try_reserve()

    if not result:
        if booking_type == "seat_map":
            raise HTTPException(status_code=409, detail="One or more selected seats were just booked. Please pick different seats.")
        if booking_type == "general":
            raise HTTPException(status_code=409, detail="Not enough seats available")
        if booking_type == "time_slot":
            raise HTTPException(status_code=409, detail="Time slot already booked")

    doc = {
        "id": booking_id,
        "event_id": body.event_id,
        "user_id": user["id"],
        "seats": body.seats,
        # For time_slot events, `num_units` reflects the actual number of
        # seats booked (defaults to 1). For general, it mirrors body.num_seats.
        "num_seats": num_units if booking_type in ("general", "time_slot") else body.num_seats,
        "time_slot": body.time_slot,
        "total_price": total_price,
        "status": "confirmed",
        "payment_status": "paid" if payment else ("unpaid" if total_price > 0 else "free"),
        "payment": payment,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    try:
        await db.bookings.insert_one(doc)
    except Exception:
        # Roll back the reservation if the booking insert fails.
        rollback: Dict[str, Any] = {"$inc": {"booked_count": -num_units}}
        if booking_type == "seat_map":
            rollback["$pullAll"] = {"booked_seats": body.seats}
        elif booking_type == "time_slot":
            rollback["$pull"] = {"booked_slots": body.time_slot}
        await db.events.update_one({"id": body.event_id}, rollback)
        raise

    return BookingOut(
        id=booking_id,
        event_id=body.event_id,
        event=EventOut(**event_doc_to_out(event)),
        user_id=user["id"],
        user_name=user.get("name"),
        seats=body.seats,
        num_seats=body.num_seats,
        time_slot=body.time_slot,
        total_price=total_price,
        status="confirmed",
        payment_status=doc["payment_status"],
        checked_in=False,
        checked_in_at=None,
        created_at=doc["created_at"],
    )

@api_router.post("/bookings", response_model=BookingOut)
async def create_booking(body: BookingCreate, user=Depends(require_role("consumer"))):
    # Pay-at-venue path (no gateway). For paid events without payment info, mark unpaid.
    return await _perform_booking(body, user, payment=None)

@api_router.get("/bookings/me", response_model=List[BookingOut])
async def my_bookings(user=Depends(get_current_user)):
    bookings = await db.bookings.find({"user_id": user["id"]}, {"_id": 0}).to_list(500)
    bookings.sort(key=lambda x: x.get("created_at", ""), reverse=True)
    out = []
    for b in bookings:
        event = await db.events.find_one({"id": b["event_id"]}, {"_id": 0})
        payment_status = b.get("payment_status")
        if not payment_status:
            payment_status = "free" if b.get("total_price", 0) == 0 else "unpaid"
        out.append(BookingOut(
            id=b["id"],
            event_id=b["event_id"],
            event=EventOut(**event_doc_to_out(event)) if event else None,
            user_id=b["user_id"],
            user_name=user.get("name"),
            seats=b.get("seats"),
            num_seats=b.get("num_seats"),
            time_slot=b.get("time_slot"),
            total_price=b.get("total_price", 0),
            status=b.get("status", "confirmed"),
            payment_status=payment_status,
            checked_in=b.get("checked_in", False),
            checked_in_at=b.get("checked_in_at"),
            created_at=b["created_at"],
            cancelled_at=b.get("cancelled_at"),
            refund=b.get("refund"),
        ))
    return out

# ---------- Cancel policy ----------
CANCEL_CUTOFF_HOURS = int(os.environ.get("CANCEL_CUTOFF_HOURS", "2"))

async def _release_booking_inventory(booking: dict) -> None:
    """Free up the seats / slots / count that this booking was holding so a
    cancellation makes room for other users to book."""
    event_id = booking["event_id"]
    if booking.get("seats"):
        await db.events.update_one(
            {"id": event_id},
            {"$pullAll": {"booked_seats": booking["seats"]}},
        )
    if booking.get("num_seats"):
        await db.events.update_one(
            {"id": event_id},
            {"$inc": {"booked_count": -int(booking["num_seats"])}},
        )
    if booking.get("time_slot"):
        # Some events have multi-user slots (many can book the same slot). We
        # only remove the slot from booked_slots if no other CONFIRMED booking
        # is still holding it — otherwise other users lose their reservation.
        slot = booking["time_slot"]
        still_held = await db.bookings.count_documents({
            "event_id": event_id,
            "time_slot": slot,
            "id": {"$ne": booking["id"]},
            "status": {"$in": ["confirmed", "checked_in"]},
        })
        if still_held == 0:
            await db.events.update_one(
                {"id": event_id},
                {"$pull": {"booked_slots": slot}},
            )

def _cancellation_error(reason: str, code: int = 400) -> HTTPException:
    return HTTPException(status_code=code, detail=reason)

async def _issue_razorpay_refund(payment: dict) -> Dict[str, Any]:
    """Fire a normal-speed refund via Razorpay. Returns a refund record with
    a status of `processed` (T+5–7 days settlement) or `refund_failed`."""
    pay_id = payment.get("payment_id")
    amount_paise = int(payment.get("amount_paise") or round(float(payment.get("amount_inr", 0)) * 100))
    if not pay_id or amount_paise <= 0:
        return {
            "status": "refund_failed",
            "provider": "razorpay",
            "error": "Missing payment id or amount",
            "processed_at": datetime.now(timezone.utc).isoformat(),
        }
    if not _RZP_CONFIGURED:
        return {
            "status": "refund_failed",
            "provider": "razorpay",
            "error": "Razorpay not configured on server",
            "processed_at": datetime.now(timezone.utc).isoformat(),
        }
    try:
        # `speed=normal` → T+5–7 business days, no surcharge.
        # Razorpay SDK is sync; run in a thread pool to avoid blocking loop.
        import asyncio
        loop = asyncio.get_running_loop()
        refund = await loop.run_in_executor(
            None,
            lambda: rzp_client.payment.refund(pay_id, {"amount": amount_paise, "speed": "normal"}),
        )
        return {
            "status": "refund_pending",  # money is on the way back over 5-7 days
            "provider": "razorpay",
            "id": refund.get("id"),
            "amount_paise": refund.get("amount", amount_paise),
            "amount_inr": (refund.get("amount", amount_paise)) / 100.0,
            "speed": refund.get("speed_requested", "normal"),
            "processed_at": datetime.now(timezone.utc).isoformat(),
            "note": "Refund initiated. It typically reflects in 5-7 business days.",
        }
    except Exception as e:
        return {
            "status": "refund_failed",
            "provider": "razorpay",
            "error": str(e),
            "processed_at": datetime.now(timezone.utc).isoformat(),
            "note": "Automatic refund failed. Our team will process it manually within 24 hours.",
        }

@api_router.post("/bookings/{booking_id}/cancel")
async def cancel_booking(booking_id: str, user=Depends(get_current_user)):
    """Cancel a confirmed booking and, if it was paid online, initiate a
    refund back to the user's original payment method via Razorpay."""
    b = await db.bookings.find_one({"id": booking_id})
    if not b or b["user_id"] != user["id"]:
        raise _cancellation_error("Booking not found", code=404)
    if b.get("status") == "cancelled":
        raise _cancellation_error("This booking is already cancelled")
    if b.get("checked_in"):
        raise _cancellation_error("This ticket has already been used and cannot be cancelled")

    # Enforce time-based cancellation window (default 2h before start).
    event = await db.events.find_one({"id": b["event_id"]})
    if not event:
        raise _cancellation_error("Event not found", code=404)
    try:
        event_start = datetime.fromisoformat(event["date"].replace("Z", "+00:00"))
        if event_start.tzinfo is None:
            event_start = event_start.replace(tzinfo=timezone.utc)
    except Exception:
        event_start = None
    now = datetime.now(timezone.utc)
    if event_start and event_start < now:
        raise _cancellation_error("The event has already started or ended; cancellations are closed.")
    if event_start and (event_start - now).total_seconds() < CANCEL_CUTOFF_HOURS * 3600:
        raise _cancellation_error(
            f"Cancellations are closed within {CANCEL_CUTOFF_HOURS} hours of the event start time."
        )

    now_iso = now.isoformat()

    # SEC-002: Atomically claim the cancellation. Only ONE concurrent
    # request can flip the booking into the intermediate `cancelling` state,
    # so double-cancels (double-refunds) become impossible even under a
    # rapid double-click.
    claimed = await db.bookings.find_one_and_update(
        {
            "id": booking_id,
            "user_id": user["id"],
            "status": {"$in": ["confirmed"]},
            "checked_in": {"$ne": True},
        },
        {"$set": {"status": "cancelling", "cancelling_at": now_iso}},
    )
    if not claimed:
        # Someone else already flipped it (or the state changed between the
        # early checks and now). Return a friendly conflict.
        raise _cancellation_error("This booking is already being processed. Please refresh.", code=409)

    update_doc: Dict[str, Any] = {
        "status": "cancelled",
        "cancelled_at": now_iso,
    }

    # 1. Free inventory FIRST so another user can grab the seat immediately.
    try:
        await _release_booking_inventory(claimed)
    except Exception as exc:
        # If freeing inventory fails, we still cancel; the startup reconciler
        # will fix drift on next boot. Log for visibility.
        logging.warning("release_booking_inventory failed for %s: %s", booking_id, exc)

    # 2. If the booking was paid online, initiate refund via Razorpay.
    payment = claimed.get("payment") or {}
    was_paid_online = (
        claimed.get("payment_status") == "paid"
        and payment.get("provider") == "razorpay"
        and payment.get("payment_id")
    )
    if was_paid_online:
        refund = await _issue_razorpay_refund(payment)
        update_doc["refund"] = refund
        # Update payment_status based on refund outcome.
        if refund.get("status") == "refund_pending":
            update_doc["payment_status"] = "refund_pending"
        elif refund.get("status") == "refund_failed":
            update_doc["payment_status"] = "refund_failed"

    await db.bookings.update_one({"id": booking_id}, {"$set": update_doc})

    # Return the fresh booking so the client shows the refund state.
    fresh = await db.bookings.find_one({"id": booking_id}, {"_id": 0})
    return {
        "ok": True,
        "booking_id": booking_id,
        "status": "cancelled",
        "cancelled_at": now_iso,
        "refund": fresh.get("refund"),
        "payment_status": fresh.get("payment_status", "free" if b.get("total_price", 0) == 0 else "unpaid"),
        "message": (
            "Booking cancelled. Refund initiated — reflects in 5-7 business days."
            if fresh.get("refund", {}).get("status") == "refund_pending"
            else "Booking cancelled."
        ),
    }

# ---------- Feature/Boost ----------

FEATURE_TIERS = {
    "24h": {"hours": 24, "price": 99, "label": "1 Day Boost"},
    "7d": {"hours": 24 * 7, "price": 299, "label": "7 Day Boost"},
    "30d": {"hours": 24 * 30, "price": 799, "label": "30 Day Boost"},
}

class BoostRequest(BaseModel):
    tier: Literal["24h", "7d", "30d"]

@api_router.get("/events/{event_id}/feature-tiers")
async def get_feature_tiers(event_id: str):
    return FEATURE_TIERS

async def _apply_boost(event_id: str, user: dict, tier: str, payment: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    e = await db.events.find_one({"id": event_id})
    if not e:
        raise HTTPException(status_code=404, detail="Event not found")
    if e["organizer_id"] != user["id"]:
        raise HTTPException(status_code=403, detail="Not your event")
    if tier not in FEATURE_TIERS:
        raise HTTPException(status_code=400, detail="Invalid tier")
    t = FEATURE_TIERS[tier]
    now = datetime.now(timezone.utc)
    current_until = e.get("featured_until")
    base = now
    if current_until:
        try:
            existing = datetime.fromisoformat(current_until)
            if existing > now:
                base = existing
        except Exception:
            pass
    new_until = base + timedelta(hours=t["hours"])
    update: Dict[str, Any] = {"featured_until": new_until.isoformat()}
    if payment:
        update["last_boost_payment"] = payment
    await db.events.update_one({"id": event_id}, {"$set": update})
    return {
        "ok": True,
        "featured_until": new_until.isoformat(),
        "tier": tier,
        "amount_charged": t["price"],
    }

@api_router.post("/events/{event_id}/feature")
async def feature_event(event_id: str, body: BoostRequest, user=Depends(require_role("organizer"))):
    """SEC-001 fix: This endpoint no longer grants free boosts.
    Organizers must go through the paid `/payments/create_order` +
    `/payments/verify` flow. Kept for API back-compat.
    """
    raise HTTPException(
        status_code=402,
        detail="Payment required. Use /api/payments/create_order with kind='boost' to boost an event.",
    )

# ---------- Check-in (QR) ----------

class CheckInRequest(BaseModel):
    booking_id: str

async def _safe_booking_for_scanner(b: dict) -> dict:
    """Trim a booking dict for the scanner UI. Strips payment ids and any
    other sensitive fields the organizer's phone doesn't need to see."""
    return {
        "id": b.get("id"),
        "event_id": b.get("event_id"),
        "user_id": b.get("user_id"),
        "seats": b.get("seats"),
        "num_seats": b.get("num_seats"),
        "time_slot": b.get("time_slot"),
        "total_price": b.get("total_price", 0),
        "status": b.get("status", "confirmed"),
        "checked_in": b.get("checked_in", False),
        "checked_in_at": b.get("checked_in_at"),
        "cancelled_at": b.get("cancelled_at"),
        # Only surface a coarse paid/unpaid/refunded flag — no ids/amounts.
        "payment_status": b.get("payment_status", "free" if b.get("total_price", 0) == 0 else "unpaid"),
    }

async def _load_booking_for_organizer(booking_id: str, user: dict):
    b = await db.bookings.find_one({"id": booking_id}, {"_id": 0})
    if not b:
        raise HTTPException(status_code=404, detail="Ticket not found")
    event = await db.events.find_one({"id": b["event_id"]}, {"_id": 0})
    if not event:
        raise HTTPException(status_code=404, detail="Event not found")
    if event["organizer_id"] != user["id"]:
        raise HTTPException(status_code=403, detail="This ticket belongs to a different organizer")
    return b, event

@api_router.post("/checkin/preview")
async def checkin_preview(body: CheckInRequest, user=Depends(require_role("organizer"))):
    """Return booking + attendee details without checking in.
    Used by the scanner to show a confirmation prompt to the organizer.
    """
    b, event = await _load_booking_for_organizer(body.booking_id, user)
    attendee = await db.users.find_one({"id": b["user_id"]}, {"_id": 0})
    return {
        "ok": True,
        "cancelled": b.get("status") == "cancelled",
        "already_checked_in": bool(b.get("checked_in")),
        "checked_in_at": b.get("checked_in_at"),
        "booking": await _safe_booking_for_scanner(b),
        "event_title": event["title"],
        "attendee_name": attendee.get("name") if attendee else None,
        # Attendee email deliberately omitted from scanner responses (SEC hardening).
    }

@api_router.post("/checkin")
async def checkin_booking(body: CheckInRequest, user=Depends(require_role("organizer"))):
    b, event = await _load_booking_for_organizer(body.booking_id, user)
    if b.get("status") == "cancelled":
        raise HTTPException(status_code=400, detail="This booking was cancelled")
    if b.get("checked_in"):
        return {
            "ok": True,
            "already_checked_in": True,
            "booking": await _safe_booking_for_scanner(b),
            "event_title": event["title"],
            "checked_in_at": b.get("checked_in_at"),
        }
    now_iso = datetime.now(timezone.utc).isoformat()
    await db.bookings.update_one(
        {"id": body.booking_id},
        {"$set": {"checked_in": True, "checked_in_at": now_iso, "status": "checked_in"}},
    )
    # Look up attendee name
    attendee = await db.users.find_one({"id": b["user_id"]}, {"_id": 0})
    updated = {**b, "checked_in": True, "checked_in_at": now_iso, "status": "checked_in"}
    return {
        "ok": True,
        "already_checked_in": False,
        "booking": await _safe_booking_for_scanner(updated),
        "event_title": event["title"],
        "attendee_name": attendee.get("name") if attendee else None,
        "checked_in_at": now_iso,
    }

# ---------- Payments (Razorpay) ----------

class PaymentOrderCreate(BaseModel):
    kind: Literal["booking", "boost"]
    # For kind=booking
    event_id: Optional[str] = None
    seats: Optional[List[str]] = None
    num_seats: Optional[int] = None
    time_slot: Optional[str] = None
    # For kind=boost
    boost_event_id: Optional[str] = None
    tier: Optional[Literal["24h", "7d", "30d"]] = None

class PaymentVerify(BaseModel):
    intent_id: str
    razorpay_order_id: str
    razorpay_payment_id: str
    razorpay_signature: str

def _rzp_available() -> bool:
    return _RZP_CONFIGURED

def _compute_booking_amount(event: dict, seats: Optional[List[str]], num_seats: Optional[int], time_slot: Optional[str]) -> float:
    bt = event["booking_type"]
    if bt == "seat_map":
        if not seats:
            raise HTTPException(status_code=400, detail="Please select seats")
        return event["price"] * len(seats)
    if bt == "general":
        if not num_seats or num_seats < 1:
            raise HTTPException(status_code=400, detail="Please choose number of seats")
        return event["price"] * num_seats
    if bt == "time_slot":
        if not time_slot:
            raise HTTPException(status_code=400, detail="Please pick a time slot")
        units = int(num_seats or 1)
        if units < 1:
            units = 1
        return event["price"] * units
    raise HTTPException(status_code=400, detail="Invalid booking type")

@api_router.get("/payments/config")
async def payment_config():
    return {
        "provider": "razorpay",
        "key_id": RAZORPAY_KEY_ID if _rzp_available() else "",
        "configured": _rzp_available(),
        "currency": "INR",
        "usd_to_inr": 83,
    }

@api_router.post("/payments/order")
async def create_payment_order(body: PaymentOrderCreate, user=Depends(get_current_user)):
    if not _rzp_available():
        raise HTTPException(
            status_code=503,
            detail="Payments are not configured. Ask the app owner to add Razorpay test keys to backend .env (RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET).",
        )

    now_iso = datetime.now(timezone.utc).isoformat()

    if body.kind == "booking":
        if user["role"] != "consumer":
            raise HTTPException(status_code=403, detail="Consumers only")
        if not body.event_id:
            raise HTTPException(status_code=400, detail="event_id required")
        event = await db.events.find_one({"id": body.event_id}, {"_id": 0})
        if not event:
            raise HTTPException(status_code=404, detail="Event not found")
        amount_inr = _compute_booking_amount(event, body.seats, body.num_seats, body.time_slot)
        if amount_inr <= 0:
            raise HTTPException(status_code=400, detail="Free event — no payment needed")
        amount_paise = int(round(amount_inr * 100))
        description = f"Booking · {event['title']}"

    elif body.kind == "boost":
        if user["role"] != "organizer":
            raise HTTPException(status_code=403, detail="Organizers only")
        if not body.boost_event_id or not body.tier:
            raise HTTPException(status_code=400, detail="boost_event_id and tier required")
        ev = await db.events.find_one({"id": body.boost_event_id})
        if not ev:
            raise HTTPException(status_code=404, detail="Event not found")
        if ev["organizer_id"] != user["id"]:
            raise HTTPException(status_code=403, detail="Not your event")
        tier_cfg = FEATURE_TIERS[body.tier]
        amount_inr = float(tier_cfg["price"])
        amount_paise = int(round(amount_inr * 100))
        description = f"{tier_cfg['label']} · {ev['title']}"

    else:
        raise HTTPException(status_code=400, detail="Invalid kind")

    intent_id = str(uuid.uuid4())
    try:
        rzp_order = rzp_client.order.create({
            "amount": amount_paise,
            "currency": "INR",
            "receipt": intent_id[:40],
            "notes": {"kind": body.kind, "intent_id": intent_id},
        })
    except Exception as exc:
        logger = logging.getLogger(__name__)
        logger.error("Razorpay order create failed: %s", exc)
        raise HTTPException(status_code=502, detail=f"Razorpay order creation failed: {exc}")

    intent_doc = {
        "id": intent_id,
        "user_id": user["id"],
        "kind": body.kind,
        "payload": body.model_dump(),
        "amount_paise": amount_paise,
        "amount_inr": amount_inr,
        "razorpay_order_id": rzp_order["id"],
        "status": "created",
        "description": description,
        "created_at": now_iso,
    }
    await db.payment_intents.insert_one(intent_doc)

    return {
        "intent_id": intent_id,
        "razorpay_order_id": rzp_order["id"],
        "razorpay_key_id": RAZORPAY_KEY_ID,
        "amount_paise": amount_paise,
        "amount_inr": amount_inr,
        "currency": "INR",
        "description": description,
        "prefill": {
            "name": user.get("name", ""),
            "email": user.get("email", ""),
        },
    }

@api_router.post("/payments/verify")
async def verify_payment(body: PaymentVerify, user=Depends(get_current_user)):
    intent = await db.payment_intents.find_one({"id": body.intent_id}, {"_id": 0})
    if not intent:
        raise HTTPException(status_code=404, detail="Payment intent not found")
    if intent["user_id"] != user["id"]:
        raise HTTPException(status_code=403, detail="Not your payment")
    if intent["razorpay_order_id"] != body.razorpay_order_id:
        raise HTTPException(status_code=400, detail="Order id mismatch")
    if intent["status"] == "paid":
        # Idempotent: return existing result
        return {"ok": True, "already_paid": True, "result": intent.get("result")}

    # Verify signature
    expected = hmac.new(
        RAZORPAY_KEY_SECRET.encode("utf-8"),
        f"{body.razorpay_order_id}|{body.razorpay_payment_id}".encode("utf-8"),
        hashlib.sha256,
    ).hexdigest()
    if not hmac.compare_digest(expected, body.razorpay_signature):
        await db.payment_intents.update_one(
            {"id": body.intent_id},
            {"$set": {"status": "signature_failed"}},
        )
        raise HTTPException(status_code=400, detail="Invalid payment signature")

    payment_info = {
        "provider": "razorpay",
        "order_id": body.razorpay_order_id,
        "payment_id": body.razorpay_payment_id,
        "amount_paise": intent["amount_paise"],
        "amount_inr": intent["amount_inr"],
        "paid_at": datetime.now(timezone.utc).isoformat(),
    }

    kind = intent["kind"]
    payload = intent["payload"]
    result: Dict[str, Any]
    if kind == "booking":
        booking_body = BookingCreate(
            event_id=payload["event_id"],
            seats=payload.get("seats"),
            num_seats=payload.get("num_seats"),
            time_slot=payload.get("time_slot"),
        )
        booking = await _perform_booking(booking_body, user, payment=payment_info)
        result = {"kind": "booking", "booking": booking.model_dump()}
    elif kind == "boost":
        boost_res = await _apply_boost(payload["boost_event_id"], user, payload["tier"], payment=payment_info)
        result = {"kind": "boost", **boost_res}
    else:
        raise HTTPException(status_code=400, detail="Unknown intent kind")

    await db.payment_intents.update_one(
        {"id": body.intent_id},
        {"$set": {
            "status": "paid",
            "payment": payment_info,
            "result": result,
        }},
    )
    return {"ok": True, "already_paid": False, "result": result}

# ---------- Analytics ----------

@api_router.get("/analytics/organizer")
async def organizer_analytics(user=Depends(require_role("organizer"))):
    events = await db.events.find({"organizer_id": user["id"]}, {"_id": 0}).to_list(500)
    event_ids = [e["id"] for e in events]
    bookings = await db.bookings.find(
        {"event_id": {"$in": event_ids}, "status": {"$in": ["confirmed", "checked_in"]}}, {"_id": 0}
    ).to_list(5000)

    total_revenue = sum(b.get("total_price", 0) for b in bookings)
    total_tickets = 0
    checked_in_tickets = 0
    for b in bookings:
        if b.get("seats"):
            total_tickets += len(b["seats"])
            if b.get("checked_in"):
                checked_in_tickets += len(b["seats"])
        elif b.get("num_seats"):
            total_tickets += b["num_seats"]
            if b.get("checked_in"):
                checked_in_tickets += b["num_seats"]
        else:
            total_tickets += 1
            if b.get("checked_in"):
                checked_in_tickets += 1
    total_events = len(events)

    # Per-event breakdown
    per_event = []
    for e in events:
        ev_bookings = [b for b in bookings if b["event_id"] == e["id"]]
        ev_revenue = sum(b.get("total_price", 0) for b in ev_bookings)
        ev_tickets = 0
        for b in ev_bookings:
            if b.get("seats"):
                ev_tickets += len(b["seats"])
            elif b.get("num_seats"):
                ev_tickets += b["num_seats"]
            else:
                ev_tickets += 1
        per_event.append({
            "event_id": e["id"],
            "title": e["title"],
            "revenue": ev_revenue,
            "tickets": ev_tickets,
            "date": e["date"],
        })

    # Category breakdown
    category_counts = {}
    for e in events:
        cat = e.get("category", "Other")
        category_counts[cat] = category_counts.get(cat, 0) + 1

    return {
        "total_revenue": total_revenue,
        "total_tickets": total_tickets,
        "checked_in_tickets": checked_in_tickets,
        "total_events": total_events,
        "unique_attendees": len(set(b["user_id"] for b in bookings)),
        "per_event": per_event,
        "category_breakdown": category_counts,
    }

# ---------- Root ----------

@api_router.get("/")
async def root():
    return {"message": "GatherSpace API", "status": "ok"}

# Include the router in the main app
app.include_router(api_router)

# SEC-hardening: explicit CORS allowlist (no wildcard + credentials contradiction).
# Configure via `CORS_ORIGINS` env (comma-separated) or fall back to preview
# hostnames that are safe to allow.
_default_origins = [
    "http://localhost:3000",
    "http://localhost:19006",
    "http://localhost:8081",
]
_env_origins = [o.strip() for o in os.environ.get("CORS_ORIGINS", "").split(",") if o.strip()]
_allowed_origins = _env_origins or _default_origins
# Match Expo/EAS preview URLs and Emergent preview subdomains via regex.
_allowed_origin_regex = os.environ.get(
    "CORS_ORIGIN_REGEX",
    r"^https://.*\.(preview\.emergentagent\.com|emergentagent\.com|exp\.direct|expo\.dev)$",
)
app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=_allowed_origins,
    allow_origin_regex=_allowed_origin_regex,
    allow_methods=["GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type", "Accept", "Origin", "X-Requested-With"],
    max_age=600,
)

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)


@app.on_event("startup")
async def _startup_indexes_and_backfill():
    """SEC-003: enforce uniqueness at the DB layer and backfill legacy data."""
    try:
        await db.events.create_index("id", unique=True)
        await db.bookings.create_index("id", unique=True)
        await db.bookings.create_index([("event_id", 1), ("user_id", 1)])
        # Same email can now exist as both consumer AND organizer accounts,
        # so uniqueness is enforced on the (email, role) pair rather than
        # email alone. Drop the legacy single-field unique index if present.
        try:
            await db.users.drop_index("email_1")
        except Exception:
            pass
        await db.users.create_index([("email", 1), ("role", 1)], unique=True, name="email_role_unique")
        await db.payment_intents.create_index("id", unique=True)
        await db.payment_intents.create_index("razorpay_order_id")
        await db.otp_challenges.create_index("id", unique=True)
        # TTL: challenges auto-expire from Mongo 10 min after creation (safety net)
        await db.otp_challenges.create_index("created_at")
        logger.info("Indexes ensured.")
    except Exception as e:  # pragma: no cover - best-effort
        logger.warning("Index creation warning: %s", e)

    # Reconcile booked_seats / booked_slots / booked_count on ALL events from
    # the bookings collection (source of truth). Runs on every startup so any
    # drift from aborted transactions or stale data is self-healed.
    try:
        all_events = await db.events.find({}, {"_id": 0, "id": 1}).to_list(5000)
        healed = 0
        for ev in all_events:
            await _reconcile_event_availability(ev["id"])
            healed += 1
        if healed:
            logger.info("Reconciled booked_* arrays for %d event(s).", healed)
    except Exception as e:  # pragma: no cover
        logger.warning("Reconcile warning: %s", e)


@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()
