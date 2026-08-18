"""Migration 003: Add `status` and `hold_reasons` fields to existing events.

Sets every pre-existing event to `status=ACTIVE` and `hold_reasons=[]`
so historical data remains visible after the EVENT_VERIFICATION_ENABLED
workflow rolls out. New events created after this migration will default
to `status=IN_REVIEW` when the feature flag is ON (see server.py).

Idempotent: safe to run multiple times.
"""
import asyncio
import os
import sys
from pathlib import Path

from motor.motor_asyncio import AsyncIOMotorClient
from dotenv import load_dotenv

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

load_dotenv(Path(__file__).resolve().parents[1] / ".env")


async def run() -> None:
    mongo_url = os.environ["MONGO_URL"]
    db_name = os.environ["DB_NAME"]
    client = AsyncIOMotorClient(mongo_url)
    db = client[db_name]

    total = await db.events.count_documents({})
    missing_status = await db.events.count_documents({"status": {"$exists": False}})
    missing_reasons = await db.events.count_documents({"hold_reasons": {"$exists": False}})
    print(f"[migration 003] {total} events total, {missing_status} missing status, {missing_reasons} missing hold_reasons")

    result_status = await db.events.update_many(
        {"status": {"$exists": False}},
        {"$set": {"status": "ACTIVE"}},
    )
    result_reasons = await db.events.update_many(
        {"hold_reasons": {"$exists": False}},
        {"$set": {"hold_reasons": []}},
    )
    print(f"[migration 003] set status=ACTIVE on {result_status.modified_count} events")
    print(f"[migration 003] set hold_reasons=[] on {result_reasons.modified_count} events")
    # Verify
    still_missing = await db.events.count_documents({
        "$or": [{"status": {"$exists": False}}, {"hold_reasons": {"$exists": False}}],
    })
    print(f"[migration 003] {still_missing} events still missing fields (should be 0)")
    client.close()


if __name__ == "__main__":
    asyncio.run(run())
