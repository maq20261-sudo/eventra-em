"""Migration 002 — Introduce start_date + end_date on existing events.

Per product decision:
  - For each event lacking `start_date`: set start_date = existing `date`.
  - For each event lacking `end_date`: set end_date = start_date + 1 day.

Idempotent: events that already have both fields are skipped.

Usage:
    python backend/migrations/002_start_end_date.py
"""
from __future__ import annotations

import asyncio
import os
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from dotenv import load_dotenv
from motor.motor_asyncio import AsyncIOMotorClient

load_dotenv(Path(__file__).resolve().parent.parent / ".env")


def _parse(iso: str) -> datetime:
    """Robust ISO parse; treat naive datetimes as UTC."""
    dt = datetime.fromisoformat(iso.replace("Z", "+00:00"))
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt


async def run() -> None:
    mongo_url = os.environ.get("MONGO_URL")
    db_name = os.environ.get("DB_NAME", "test_database")
    if not mongo_url:
        raise SystemExit("MONGO_URL is not set — cannot run migration.")
    client = AsyncIOMotorClient(mongo_url)
    db = client[db_name]

    cursor = db.events.find({})
    total = 0
    updated = 0
    skipped = 0
    errored = 0
    async for e in cursor:
        total += 1
        already_start = e.get("start_date")
        already_end = e.get("end_date")
        if already_start and already_end:
            skipped += 1
            continue
        raw_date = e.get("date")
        if not raw_date:
            errored += 1
            print(f"  ⚠️  {e.get('title', e['id'])}: missing `date` — skipped")
            continue
        try:
            start = _parse(already_start or raw_date)
        except Exception as ex:
            errored += 1
            print(f"  ⚠️  {e.get('title', e['id'])}: invalid start_date ({ex}) — skipped")
            continue
        end = None
        if already_end:
            try:
                end = _parse(already_end)
            except Exception:
                end = None
        if end is None or end <= start:
            end = start + timedelta(days=1)

        await db.events.update_one(
            {"id": e["id"]},
            {"$set": {
                "start_date": start.isoformat(),
                "end_date": end.isoformat(),
                # Keep legacy `date` in sync with start_date so old clients keep working.
                "date": start.isoformat(),
            }},
        )
        updated += 1
        print(f"  ✓ {e.get('title', e['id'])[:40]}: {start.date()} → {end.date()}")

    print("\n=== Migration Summary ===")
    print(f"Scanned:  {total} event(s)")
    print(f"Updated:  {updated}")
    print(f"Skipped:  {skipped} (already have start/end)")
    print(f"Errored:  {errored}")
    client.close()


if __name__ == "__main__":
    asyncio.run(run())
