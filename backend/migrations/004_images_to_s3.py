"""Migration 004: move base64 event cover images from MongoDB to S3.

Events created before S3 was configured store their uploaded cover as a
`data:image/...;base64,...` string inside the event document. This uploads
each one to S3 (see image_store.py) and replaces it with the public URL.

Requires S3_BUCKET (+ AWS credentials) in the environment.
Idempotent: only events whose image_url still starts with "data:" are touched.

    docker compose exec backend python migrations/004_images_to_s3.py
"""
import asyncio
import os
import sys
from pathlib import Path

from dotenv import load_dotenv
from motor.motor_asyncio import AsyncIOMotorClient

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
load_dotenv(Path(__file__).resolve().parents[1] / ".env")

import image_store  # noqa: E402


async def run() -> None:
    if not image_store.enabled():
        raise SystemExit("[migration 004] S3_BUCKET is not set — nothing to do.")
    client = AsyncIOMotorClient(os.environ["MONGO_URL"])
    db = client[os.environ["DB_NAME"]]

    query = {"image_url": {"$regex": "^data:"}}
    total = await db.events.count_documents(query)
    print(f"[migration 004] {total} event(s) with embedded images")
    moved = failed = 0
    async for ev in db.events.find(query, {"_id": 0, "id": 1, "image_url": 1}):
        try:
            url = await image_store.persist_image(ev["image_url"])
            await db.events.update_one({"id": ev["id"]}, {"$set": {"image_url": url}})
            moved += 1
        except Exception as exc:  # keep going; report at the end
            failed += 1
            print(f"[migration 004] event {ev['id']}: {exc}")
    print(f"[migration 004] moved {moved}, failed {failed}")
    client.close()


if __name__ == "__main__":
    asyncio.run(run())
