"""One-off migration: back-fill per-slot capacity on legacy time_slot events.

Before this migration:
    - `time_slots` was a List[str] (labels only).
    - `slot_capacity` was a single event-wide int (usually 1).

After this migration:
    - Each time_slot event gets a new `slot_capacities: Dict[str, int]`
      mapping label -> capacity (default 50 for legacy events per product
      requirement).
    - `slot_capacity` is left in place as a fallback for older code paths
      but is not the source of truth anymore.

Idempotent: safe to re-run — events that already have `slot_capacities`
are skipped.

Usage:
    python backend/migrations/001_time_slot_capacities.py
"""
from __future__ import annotations

import asyncio
import os
import sys
from pathlib import Path

# Ensure backend/ is on the path so we can reuse server's Mongo client
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from dotenv import load_dotenv
from motor.motor_asyncio import AsyncIOMotorClient

load_dotenv(Path(__file__).resolve().parent.parent / ".env")

DEFAULT_CAPACITY = 50


async def run() -> None:
    mongo_url = os.environ.get("MONGO_URL")
    db_name = os.environ.get("DB_NAME", "test_database")
    if not mongo_url:
        raise SystemExit("MONGO_URL is not set — cannot run migration.")
    client = AsyncIOMotorClient(mongo_url)
    db = client[db_name]

    cursor = db.events.find({"booking_type": "time_slot"})
    total = 0
    updated = 0
    skipped = 0
    async for e in cursor:
        total += 1
        slots = e.get("time_slots") or []
        # Skip events that already have per-slot capacity info.
        if isinstance(e.get("slot_capacities"), dict) and e["slot_capacities"]:
            # Even if it exists, make sure every current slot has a capacity.
            caps = dict(e["slot_capacities"])
            missing = [s for s in slots if s not in caps]
            if not missing:
                skipped += 1
                continue
            for s in missing:
                caps[s] = DEFAULT_CAPACITY
        else:
            caps = {s: DEFAULT_CAPACITY for s in slots if isinstance(s, str)}

        if not caps:
            skipped += 1
            continue

        await db.events.update_one(
            {"id": e["id"]},
            {"$set": {
                "slot_capacities": caps,
                # Keep slot_capacity for backward compat, set to max cap.
                "slot_capacity": max(caps.values()),
            }},
        )
        updated += 1
        print(f"  ✓ {e.get('title', e['id'])}: {len(caps)} slot(s) → {DEFAULT_CAPACITY} seats each")

    print("\n=== Migration Summary ===")
    print(f"Scanned:  {total} time_slot event(s)")
    print(f"Updated:  {updated}")
    print(f"Skipped:  {skipped} (already migrated)")
    client.close()


if __name__ == "__main__":
    asyncio.run(run())
