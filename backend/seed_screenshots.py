"""Demo data for the store screenshots — LOCAL ONLY.

Creates a Mumbai-based organizer, ten good-looking upcoming events around
the app's default location (Mumbai, so no real GPS area ever appears in a
screenshot), a set of attendees with bookings, and a few check-ins so the
organizer analytics have numbers. Events and bookings go through the real
API so they look exactly like ones made in the app.

Run inside the backend container while the local stack is up:

    docker compose exec backend python seed_screenshots.py

Logins (password `password123`):
    attendee  riya@example.com   (the one to capture with)
    organizer studio@example.com

Re-running wipes and recreates only this script's data.
"""
import asyncio
import os
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path

import httpx
from dotenv import load_dotenv
from motor.motor_asyncio import AsyncIOMotorClient
from passlib.context import CryptContext

load_dotenv(Path(__file__).parent / ".env")

API = os.environ.get("SCREENSHOT_API", "http://127.0.0.1:8001/api")
PASSWORD = "password123"
TAG = "screenshots"
pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

ORGANIZER = {"email": "studio@example.com", "name": "Mumbai Live Co.", "role": "organizer"}
CAPTURE_USER = {"email": "riya@example.com", "name": "Riya Sharma", "role": "consumer"}
CROWD = [
    ("arjun@example.com", "Arjun Mehta"),
    ("sana@example.com", "Sana Khan"),
    ("kabir@example.com", "Kabir Iyer"),
    ("meera@example.com", "Meera Nair"),
    ("dev@example.com", "Dev Patel"),
    ("ishita@example.com", "Ishita Rao"),
]


def px(photo_id: int) -> str:
    return f"https://images.pexels.com/photos/{photo_id}/pexels-photo-{photo_id}.jpeg?auto=compress&cs=tinysrgb&w=940"


def at(days: int, hour: int, minute: int = 0) -> str:
    """`days` from today at hour:minute IST, as a UTC ISO string."""
    ist = timezone(timedelta(hours=5, minutes=30))
    d = datetime.now(ist).replace(hour=hour, minute=minute, second=0, microsecond=0) + timedelta(days=days)
    return d.astimezone(timezone.utc).isoformat()


def end(start_iso: str, hours: float) -> str:
    return (datetime.fromisoformat(start_iso) + timedelta(hours=hours)).isoformat()


# key -> event payload (POST /events). Coordinates are around central Mumbai.
EVENTS = {
    "party": dict(
        title="Bollywood Retro Night", category="Music", image_url=px(1190298),
        description="Dance to 70s, 80s and 90s Bollywood classics with a live DJ, neon visuals and a packed dance floor. Dress code: retro glam.",
        start=(3, 21), hours=4, location_name="Blue Frog Arena, Lower Parel", latitude=18.9986, longitude=72.8259,
        price=799, booking_type="general", total_seats=300, featured=True),
    "sufi": dict(
        title="Sufi & Strings Live", category="Music", image_url=px(1105666),
        description="An evening of soulful Sufi qawwali reimagined with a string quartet. Reserved seating, doors open 45 minutes early.",
        start=(5, 19, 30), hours=3, location_name="Bandra Amphitheatre", latitude=19.0544, longitude=72.8205,
        price=999, booking_type="seat_map", seat_rows=8, seat_cols=10, featured=True),
    "rock": dict(
        title="Indie Rock Fest", category="Music", image_url=px(167636),
        description="Six homegrown indie bands, one loud night. Food trucks and merch stalls open from 5 PM.",
        start=(9, 17), hours=6, location_name="Andheri Sports Complex", latitude=19.1197, longitude=72.8468,
        price=1299, booking_type="general", total_seats=800),
    "comedy": dict(
        title="Stand-up: Local Train Diaries", category="Other", image_url=px(2608517),
        description="Mumbai's sharpest new comics on commutes, landlords and monsoon chaos. 18+ show.",
        start=(2, 20), hours=2, location_name="The Habitat, Khar West", latitude=19.0718, longitude=72.8362,
        price=499, booking_type="general", total_seats=120),
    "pottery": dict(
        title="Clay & Chai Pottery Workshop", category="Art", image_url=px(2162938),
        description="Learn wheel throwing from scratch and take home your own cup. All materials and unlimited chai included.",
        start=(4, 11), hours=6, location_name="Kiln Studio, Bandra West", latitude=19.0596, longitude=72.8295,
        price=1499, booking_type="time_slot",
        time_slots=[{"time": "11:00 AM", "capacity": 10}, {"time": "02:00 PM", "capacity": 10}, {"time": "05:00 PM", "capacity": 10}]),
    "yoga": dict(
        title="Sunrise Yoga at Marine Drive", category="Sports", image_url=px(3822583),
        description="A calm 60-minute flow by the sea for all levels. Bring a mat and water — free entry, registration required.",
        start=(6, 6, 30), hours=1, location_name="Marine Drive Promenade", latitude=18.9432, longitude=72.8235,
        price=0, booking_type="time_slot",
        time_slots=[{"time": "06:30 AM", "capacity": 40}, {"time": "07:45 AM", "capacity": 40}]),
    "food": dict(
        title="Monsoon Street Food Walk", category="Food", image_url=px(1640777),
        description="A guided tasting walk through Colaba's hidden food lanes — eight stops, vegetarian options at every one.",
        start=(7, 17, 30), hours=3, location_name="Colaba Causeway", latitude=18.9067, longitude=72.8147,
        price=899, booking_type="general", total_seats=25),
    "ai": dict(
        title="AI Builders Meetup", category="Tech", image_url=px(29180747),
        description="Lightning talks from founders shipping AI products in India, followed by demos and networking.",
        start=(8, 18), hours=3, location_name="Hiranandani Business Park, Powai", latitude=19.1176, longitude=72.9060,
        price=299, booking_type="time_slot",
        time_slots=[{"time": "06:00 PM - Talks", "capacity": 80}, {"time": "08:00 PM - Demos", "capacity": 60}]),
    "art": dict(
        title="Modern Indian Art Showcase", category="Art", image_url=px(15086258),
        description="Forty contemporary artists, one weekend. Guided walkthroughs every hour and a live painting corner.",
        start=(10, 11), hours=8, location_name="Kala Ghoda Gallery", latitude=18.9281, longitude=72.8318,
        price=349, booking_type="general", total_seats=400),
    "cricket": dict(
        title="Cricket Final Screening", category="Sports", image_url=px(976866),
        description="Watch the final on a giant LED wall with 500 fans, stadium snacks and a halftime quiz.",
        start=(12, 19), hours=4, location_name="Worli Sea Face Grounds", latitude=19.0096, longitude=72.8156,
        price=399, booking_type="general", total_seats=500),
}

# (attendee email, event key, booking body extras, check in?)
BOOKINGS = [
    # The capture account: three upcoming tickets.
    ("riya@example.com", "sufi", {"seats": ["C5", "C6"]}, False),
    ("riya@example.com", "pottery", {"time_slot": "02:00 PM", "num_seats": 1}, False),
    ("riya@example.com", "comedy", {"num_seats": 2}, False),
    # Crowd: fills the seat map and gives analytics something to show.
    ("arjun@example.com", "sufi", {"seats": ["A3", "A4"]}, True),
    ("sana@example.com", "sufi", {"seats": ["B6", "B7", "B8"]}, True),
    ("kabir@example.com", "sufi", {"seats": ["D2", "D3"]}, False),
    ("meera@example.com", "sufi", {"seats": ["E9", "E10"]}, True),
    ("dev@example.com", "sufi", {"seats": ["C1"]}, False),
    ("ishita@example.com", "sufi", {"seats": ["F4", "F5"]}, False),
    ("arjun@example.com", "party", {"num_seats": 4}, True),
    ("sana@example.com", "party", {"num_seats": 2}, True),
    ("kabir@example.com", "party", {"num_seats": 3}, False),
    ("meera@example.com", "rock", {"num_seats": 2}, False),
    ("dev@example.com", "rock", {"num_seats": 5}, True),
    ("ishita@example.com", "comedy", {"num_seats": 2}, True),
    ("kabir@example.com", "comedy", {"num_seats": 1}, False),
    ("arjun@example.com", "food", {"num_seats": 2}, False),
    ("sana@example.com", "ai", {"time_slot": "06:00 PM - Talks", "num_seats": 1}, True),
    ("dev@example.com", "pottery", {"time_slot": "11:00 AM", "num_seats": 2}, True),
    ("meera@example.com", "yoga", {"time_slot": "06:30 AM", "num_seats": 1}, False),
    ("ishita@example.com", "art", {"num_seats": 3}, False),
]


async def main():
    if os.environ.get("APP_ENV", "development").lower() == "production" or "mongodb.net" in os.environ.get("MONGO_URL", ""):
        raise SystemExit("seed_screenshots.py is for the LOCAL database only.")

    client = AsyncIOMotorClient(os.environ["MONGO_URL"])
    db = client[os.environ["DB_NAME"]]

    # Wipe this script's previous run.
    emails = [ORGANIZER["email"], CAPTURE_USER["email"]] + [e for e, _ in CROWD]
    old_users = [u["id"] async for u in db.users.find({"email": {"$in": emails}}, {"id": 1})]
    old_events = [e["id"] async for e in db.events.find({"seeded": TAG}, {"id": 1})]
    await db.bookings.delete_many({"$or": [{"user_id": {"$in": old_users}}, {"event_id": {"$in": old_events}}]})
    await db.events.delete_many({"id": {"$in": old_events}})
    await db.users.delete_many({"id": {"$in": old_users}})

    now = datetime.now(timezone.utc).isoformat()
    pw_hash = pwd_context.hash(PASSWORD)
    people = [ORGANIZER, CAPTURE_USER] + [{"email": e, "name": n, "role": "consumer"} for e, n in CROWD]
    for p in people:
        await db.users.insert_one({"id": str(uuid.uuid4()), **p, "password_hash": pw_hash, "created_at": now})

    async with httpx.AsyncClient(base_url=API, timeout=30) as http:
        tokens = {}
        for p in people:
            r = await http.post("/auth/login", json={"email": p["email"], "password": PASSWORD, "role": p["role"]})
            r.raise_for_status()
            tokens[p["email"]] = r.json()["access_token"]
        org = {"Authorization": f"Bearer {tokens[ORGANIZER['email']]}"}

        ids = {}
        for key, e in EVENTS.items():
            body = {k: v for k, v in e.items() if k not in ("start", "hours", "featured")}
            body["start_date"] = at(*e["start"])
            body["end_date"] = end(body["start_date"], e["hours"])
            r = await http.post("/events", json=body, headers=org)
            if r.status_code >= 400:
                raise SystemExit(f"Creating '{e['title']}' failed: {r.status_code} {r.text}")
            ids[key] = r.json()["id"]
            update = {"seeded": TAG}
            if e.get("featured"):
                update["featured_until"] = (datetime.now(timezone.utc) + timedelta(days=7)).isoformat()
            await db.events.update_one({"id": ids[key]}, {"$set": update})

        made = checked = 0
        for email, key, extra, check_in in BOOKINGS:
            r = await http.post("/bookings", json={"event_id": ids[key], **extra},
                                headers={"Authorization": f"Bearer {tokens[email]}"})
            if r.status_code >= 400:
                print(f"  ! booking {email} -> {key} failed: {r.status_code} {r.text[:120]}")
                continue
            made += 1
            if check_in:
                c = await http.post("/checkin", json={"booking_id": r.json()["id"]}, headers=org)
                checked += c.status_code < 400

    print(f"Screenshot data ready: {len(EVENTS)} events, {made} bookings, {checked} check-ins.")
    print(f"Log in as {CAPTURE_USER['email']} (attendee) or {ORGANIZER['email']} (organizer), password {PASSWORD}.")
    client.close()


if __name__ == "__main__":
    asyncio.run(main())
