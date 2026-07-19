"""Seed script to populate demo events for testing."""
import asyncio
import os
import uuid
from datetime import datetime, timezone, timedelta
from motor.motor_asyncio import AsyncIOMotorClient
from passlib.context import CryptContext
from dotenv import load_dotenv
from pathlib import Path

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

async def main():
    client = AsyncIOMotorClient(os.environ['MONGO_URL'])
    db = client[os.environ['DB_NAME']]

    # Wipe demo data
    await db.users.delete_many({"email": {"$in": ["demo@organizer.com", "demo@consumer.com"]}})
    await db.events.delete_many({"seeded": True})
    await db.bookings.delete_many({})

    # Create demo organizer
    org_id = str(uuid.uuid4())
    await db.users.insert_one({
        "id": org_id,
        "email": "demo@organizer.com",
        "name": "Aria Events Co.",
        "role": "organizer",
        "password_hash": pwd_context.hash("password123"),
        "created_at": datetime.now(timezone.utc).isoformat(),
    })

    # Create demo consumer
    con_id = str(uuid.uuid4())
    await db.users.insert_one({
        "id": con_id,
        "email": "demo@consumer.com",
        "name": "Sam Rivera",
        "role": "consumer",
        "password_hash": pwd_context.hash("password123"),
        "created_at": datetime.now(timezone.utc).isoformat(),
    })

    # San Francisco lat/lng as demo center
    base_lat, base_lng = 37.7749, -122.4194

    events = [
        {
            "title": "Sunset Symphony Live",
            "description": "An unforgettable evening of live orchestral music under the open sky. Bring your loved ones for a night of timeless classics and modern arrangements performed by the city's finest musicians.",
            "category": "Music",
            "image_url": "https://images.pexels.com/photos/894557/pexels-photo-894557.jpeg?auto=compress&cs=tinysrgb&dpr=2&h=650&w=940",
            "date": (datetime.now(timezone.utc) + timedelta(days=5)).isoformat(),
            "location_name": "Golden Gate Park Amphitheater",
            "latitude": base_lat + 0.01,
            "longitude": base_lng - 0.005,
            "price": 799.0,
            "booking_type": "seat_map",
            "seat_rows": 8,
            "seat_cols": 10,
        },
        {
            "title": "Modernism Reimagined",
            "description": "Explore contemporary works from emerging artists in a curated gallery exhibition. General admission ticket includes complimentary refreshments and gallery guide.",
            "category": "Art",
            "image_url": "https://images.pexels.com/photos/15086258/pexels-photo-15086258.jpeg?auto=compress&cs=tinysrgb&dpr=2&h=650&w=940",
            "date": (datetime.now(timezone.utc) + timedelta(days=10)).isoformat(),
            "location_name": "SFMOMA Annex",
            "latitude": base_lat - 0.008,
            "longitude": base_lng + 0.011,
            "price": 299.0,
            "booking_type": "general",
            "total_seats": 200,
        },
        {
            "title": "AI & The Future of Work",
            "description": "A hands-on tech conference featuring keynote speakers from leading AI companies. Reserve your time slot for the exclusive founder Q&A sessions.",
            "category": "Tech",
            "image_url": "https://images.pexels.com/photos/29180747/pexels-photo-29180747.jpeg",
            "date": (datetime.now(timezone.utc) + timedelta(days=15)).isoformat(),
            "location_name": "Moscone West",
            "latitude": base_lat + 0.02,
            "longitude": base_lng + 0.02,
            "price": 1499.0,
            "booking_type": "time_slot",
            "time_slots": [
                "10:00 AM - Founder Q&A",
                "12:00 PM - Product Deep-Dive",
                "02:00 PM - AI Ethics Panel",
                "04:00 PM - Networking Mixer",
            ],
        },
        {
            "title": "Neon Nights DJ Set",
            "description": "The rooftop is alive with pulsing beats and city skyline views. Grab your seats for the hottest DJ set of the season.",
            "category": "Music",
            "image_url": "https://images.pexels.com/photos/10781266/pexels-photo-10781266.jpeg?auto=compress&cs=tinysrgb&dpr=2&h=650&w=940",
            "date": (datetime.now(timezone.utc) + timedelta(days=3)).isoformat(),
            "location_name": "Sky Terrace, Downtown",
            "latitude": base_lat + 0.003,
            "longitude": base_lng - 0.02,
            "price": 499.0,
            "booking_type": "general",
            "total_seats": 150,
        },
        {
            "title": "Founders Roundtable",
            "description": "Intimate fireside chats with successful startup founders. Small group sessions — reserve your slot early.",
            "category": "Tech",
            "image_url": "https://images.pexels.com/photos/2608517/pexels-photo-2608517.jpeg?auto=compress&cs=tinysrgb&dpr=2&h=650&w=940",
            "date": (datetime.now(timezone.utc) + timedelta(days=20)).isoformat(),
            "location_name": "Innovation Hub SF",
            "latitude": base_lat - 0.015,
            "longitude": base_lng - 0.012,
            "price": 0.0,
            "booking_type": "time_slot",
            "time_slots": ["11:00 AM Session", "01:00 PM Session", "03:00 PM Session"],
        },
    ]

    for e in events:
        e.update({
            "id": str(uuid.uuid4()),
            "organizer_id": org_id,
            "organizer_name": "Aria Events Co.",
            "booked_count": 0,
            "seeded": True,
            "created_at": datetime.now(timezone.utc).isoformat(),
        })
        await db.events.insert_one(e)

    print(f"Seeded {len(events)} events + 2 demo users")
    client.close()

if __name__ == "__main__":
    asyncio.run(main())
