from fastapi import FastAPI, APIRouter, HTTPException, Depends, status, Query
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
import os
import logging
import math
from pathlib import Path
from pydantic import BaseModel, Field, EmailStr
from typing import List, Optional, Literal
import uuid
from datetime import datetime, timezone, timedelta
import jwt
from passlib.context import CryptContext

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ['DB_NAME']]

SECRET_KEY = os.environ.get("JWT_SECRET_KEY", "gatherspace-secret-key-change-me-in-prod")
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 60 * 24 * 7  # 7 days

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
security = HTTPBearer()

app = FastAPI()
api_router = APIRouter(prefix="/api")

# ---------- Models ----------

class UserCreate(BaseModel):
    email: EmailStr
    password: str = Field(min_length=6)
    name: str
    role: Literal["consumer", "organizer"]

class UserLogin(BaseModel):
    email: EmailStr
    password: str

class UserOut(BaseModel):
    id: str
    email: str
    name: str
    role: str

class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserOut

class EventCreate(BaseModel):
    title: str
    description: str
    category: str  # Music, Art, Tech, Food, Sports, Other
    image_url: Optional[str] = None
    date: str  # ISO
    location_name: str
    latitude: float
    longitude: float
    price: float = 0.0
    booking_type: Literal["seat_map", "general", "time_slot"]
    # For seat_map
    seat_rows: Optional[int] = None
    seat_cols: Optional[int] = None
    # For general
    total_seats: Optional[int] = None
    # For time_slot
    time_slots: Optional[List[str]] = None  # list of ISO times or labels

class EventUpdate(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    category: Optional[str] = None
    image_url: Optional[str] = None
    date: Optional[str] = None
    location_name: Optional[str] = None
    latitude: Optional[float] = None
    longitude: Optional[float] = None
    price: Optional[float] = None

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
    checked_in: bool = False
    checked_in_at: Optional[str] = None
    created_at: str

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

async def get_current_user(creds: HTTPAuthorizationCredentials = Depends(security)):
    token = creds.credentials
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        user_id = payload.get("sub")
        if not user_id:
            raise HTTPException(status_code=401, detail="Invalid token")
    except jwt.PyJWTError:
        raise HTTPException(status_code=401, detail="Invalid token")
    user = await db.users.find_one({"id": user_id}, {"_id": 0})
    if not user:
        raise HTTPException(status_code=401, detail="User not found")
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
        "organizer_id": e["organizer_id"],
        "organizer_name": e.get("organizer_name", "Organizer"),
        "booked_count": e.get("booked_count", 0),
        "distance_km": distance_km,
        "is_featured": is_featured,
        "featured_until": featured_until,
        "created_at": e["created_at"],
    }

# ---------- Auth Routes ----------

@api_router.post("/auth/register", response_model=TokenResponse)
async def register(body: UserCreate):
    existing = await db.users.find_one({"email": body.email})
    if existing:
        raise HTTPException(status_code=400, detail="Email already registered")
    user_id = str(uuid.uuid4())
    doc = {
        "id": user_id,
        "email": body.email,
        "name": body.name,
        "role": body.role,
        "password_hash": hash_password(body.password),
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.users.insert_one(doc)
    token = create_access_token({"sub": user_id, "role": body.role})
    return TokenResponse(
        access_token=token,
        user=UserOut(id=user_id, email=body.email, name=body.name, role=body.role),
    )

@api_router.post("/auth/login", response_model=TokenResponse)
async def login(body: UserLogin):
    user = await db.users.find_one({"email": body.email})
    if not user or not verify_password(body.password, user["password_hash"]):
        raise HTTPException(status_code=401, detail="Invalid email or password")
    token = create_access_token({"sub": user["id"], "role": user["role"]})
    return TokenResponse(
        access_token=token,
        user=UserOut(id=user["id"], email=user["email"], name=user["name"], role=user["role"]),
    )

@api_router.get("/auth/me", response_model=UserOut)
async def me(user=Depends(get_current_user)):
    return UserOut(id=user["id"], email=user["email"], name=user["name"], role=user["role"])

# ---------- Event Routes ----------

@api_router.post("/events", response_model=EventOut)
async def create_event(body: EventCreate, user=Depends(require_role("organizer"))):
    event_id = str(uuid.uuid4())
    doc = body.model_dump()
    doc.update({
        "id": event_id,
        "organizer_id": user["id"],
        "organizer_name": user["name"],
        "booked_count": 0,
        "created_at": datetime.now(timezone.utc).isoformat(),
    })
    await db.events.insert_one(doc)
    doc.pop("_id", None)
    return event_doc_to_out(doc)

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
        query["title"] = {"$regex": search, "$options": "i"}
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

@api_router.get("/events/{event_id}", response_model=EventOut)
async def get_event(event_id: str):
    e = await db.events.find_one({"id": event_id}, {"_id": 0})
    if not e:
        raise HTTPException(status_code=404, detail="Event not found")
    return event_doc_to_out(e)

@api_router.put("/events/{event_id}", response_model=EventOut)
async def update_event(event_id: str, body: EventUpdate, user=Depends(require_role("organizer"))):
    e = await db.events.find_one({"id": event_id})
    if not e:
        raise HTTPException(status_code=404, detail="Event not found")
    if e["organizer_id"] != user["id"]:
        raise HTTPException(status_code=403, detail="Not your event")
    update_data = {k: v for k, v in body.model_dump().items() if v is not None}
    if update_data:
        await db.events.update_one({"id": event_id}, {"$set": update_data})
    updated = await db.events.find_one({"id": event_id}, {"_id": 0})
    return event_doc_to_out(updated)

@api_router.delete("/events/{event_id}")
async def delete_event(event_id: str, user=Depends(require_role("organizer"))):
    e = await db.events.find_one({"id": event_id})
    if not e:
        raise HTTPException(status_code=404, detail="Event not found")
    if e["organizer_id"] != user["id"]:
        raise HTTPException(status_code=403, detail="Not your event")
    await db.events.delete_one({"id": event_id})
    return {"ok": True}

@api_router.get("/events/{event_id}/booked-seats")
async def get_booked_seats(event_id: str):
    bookings = await db.bookings.find({"event_id": event_id, "status": "confirmed"}, {"_id": 0}).to_list(1000)
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

@api_router.post("/bookings", response_model=BookingOut)
async def create_booking(body: BookingCreate, user=Depends(require_role("consumer"))):
    event = await db.events.find_one({"id": body.event_id}, {"_id": 0})
    if not event:
        raise HTTPException(status_code=404, detail="Event not found")

    # Validate seat availability
    if event["booking_type"] == "seat_map":
        if not body.seats:
            raise HTTPException(status_code=400, detail="Please select seats")
        existing = await db.bookings.find({"event_id": body.event_id, "status": "confirmed"}, {"_id": 0}).to_list(1000)
        taken = set()
        for b in existing:
            if b.get("seats"):
                taken.update(b["seats"])
        for s in body.seats:
            if s in taken:
                raise HTTPException(status_code=400, detail=f"Seat {s} already booked")
        total_price = event["price"] * len(body.seats)
        num_units = len(body.seats)
    elif event["booking_type"] == "general":
        if not body.num_seats or body.num_seats < 1:
            raise HTTPException(status_code=400, detail="Please choose number of seats")
        existing = await db.bookings.find({"event_id": body.event_id, "status": "confirmed"}, {"_id": 0}).to_list(1000)
        booked = sum(b.get("num_seats", 0) for b in existing)
        if booked + body.num_seats > (event.get("total_seats") or 0):
            raise HTTPException(status_code=400, detail="Not enough seats available")
        total_price = event["price"] * body.num_seats
        num_units = body.num_seats
    elif event["booking_type"] == "time_slot":
        if not body.time_slot:
            raise HTTPException(status_code=400, detail="Please pick a time slot")
        existing = await db.bookings.find({"event_id": body.event_id, "status": "confirmed"}, {"_id": 0}).to_list(1000)
        taken_slots = {b.get("time_slot") for b in existing}
        if body.time_slot in taken_slots:
            raise HTTPException(status_code=400, detail="Time slot already booked")
        total_price = event["price"]
        num_units = 1
    else:
        raise HTTPException(status_code=400, detail="Invalid booking type")

    booking_id = str(uuid.uuid4())
    doc = {
        "id": booking_id,
        "event_id": body.event_id,
        "user_id": user["id"],
        "seats": body.seats,
        "num_seats": body.num_seats,
        "time_slot": body.time_slot,
        "total_price": total_price,
        "status": "confirmed",
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.bookings.insert_one(doc)
    await db.events.update_one({"id": body.event_id}, {"$inc": {"booked_count": num_units}})

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
        checked_in=False,
        checked_in_at=None,
        created_at=doc["created_at"],
    )

@api_router.get("/bookings/me", response_model=List[BookingOut])
async def my_bookings(user=Depends(get_current_user)):
    bookings = await db.bookings.find({"user_id": user["id"]}, {"_id": 0}).to_list(500)
    bookings.sort(key=lambda x: x.get("created_at", ""), reverse=True)
    out = []
    for b in bookings:
        event = await db.events.find_one({"id": b["event_id"]}, {"_id": 0})
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
            checked_in=b.get("checked_in", False),
            checked_in_at=b.get("checked_in_at"),
            created_at=b["created_at"],
        ))
    return out

@api_router.post("/bookings/{booking_id}/cancel")
async def cancel_booking(booking_id: str, user=Depends(get_current_user)):
    b = await db.bookings.find_one({"id": booking_id})
    if not b or b["user_id"] != user["id"]:
        raise HTTPException(status_code=404, detail="Booking not found")
    await db.bookings.update_one({"id": booking_id}, {"$set": {"status": "cancelled"}})
    return {"ok": True}

# ---------- Feature/Boost ----------

FEATURE_TIERS = {
    "24h": {"hours": 24, "price": 4.99, "label": "1 Day Boost"},
    "7d": {"hours": 24 * 7, "price": 14.99, "label": "7 Day Boost"},
    "30d": {"hours": 24 * 30, "price": 39.99, "label": "30 Day Boost"},
}

class BoostRequest(BaseModel):
    tier: Literal["24h", "7d", "30d"]

@api_router.get("/events/{event_id}/feature-tiers")
async def get_feature_tiers(event_id: str):
    return FEATURE_TIERS

@api_router.post("/events/{event_id}/feature")
async def feature_event(event_id: str, body: BoostRequest, user=Depends(require_role("organizer"))):
    e = await db.events.find_one({"id": event_id})
    if not e:
        raise HTTPException(status_code=404, detail="Event not found")
    if e["organizer_id"] != user["id"]:
        raise HTTPException(status_code=403, detail="Not your event")
    tier = FEATURE_TIERS[body.tier]
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
    new_until = base + timedelta(hours=tier["hours"])
    await db.events.update_one(
        {"id": event_id},
        {"$set": {"featured_until": new_until.isoformat()}},
    )
    return {
        "ok": True,
        "featured_until": new_until.isoformat(),
        "tier": body.tier,
        "amount_charged": tier["price"],
    }

# ---------- Check-in (QR) ----------

class CheckInRequest(BaseModel):
    booking_id: str

@api_router.post("/checkin")
async def checkin_booking(body: CheckInRequest, user=Depends(require_role("organizer"))):
    b = await db.bookings.find_one({"id": body.booking_id}, {"_id": 0})
    if not b:
        raise HTTPException(status_code=404, detail="Ticket not found")
    event = await db.events.find_one({"id": b["event_id"]}, {"_id": 0})
    if not event:
        raise HTTPException(status_code=404, detail="Event not found")
    if event["organizer_id"] != user["id"]:
        raise HTTPException(status_code=403, detail="This ticket belongs to a different organizer")
    if b.get("status") == "cancelled":
        raise HTTPException(status_code=400, detail="This booking was cancelled")
    if b.get("checked_in"):
        return {
            "ok": True,
            "already_checked_in": True,
            "booking": b,
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
    return {
        "ok": True,
        "already_checked_in": False,
        "booking": {**b, "checked_in": True, "checked_in_at": now_iso, "status": "checked_in"},
        "event_title": event["title"],
        "attendee_name": attendee.get("name") if attendee else None,
        "checked_in_at": now_iso,
    }

# ---------- Analytics ----------

@api_router.get("/analytics/organizer")
async def organizer_analytics(user=Depends(require_role("organizer"))):
    events = await db.events.find({"organizer_id": user["id"]}, {"_id": 0}).to_list(500)
    event_ids = [e["id"] for e in events]
    bookings = await db.bookings.find(
        {"event_id": {"$in": event_ids}, "status": "confirmed"}, {"_id": 0}
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

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()
