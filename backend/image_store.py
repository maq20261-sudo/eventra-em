"""Event cover images on S3.

The app uploads covers as `data:image/...;base64,...` URIs. When S3 is
configured (`S3_BUCKET`), the server decodes them, stores the file under
`event-images/` and keeps only the public URL in MongoDB — so event lists stay
small and the free 512 MB Atlas tier isn't filled with image bytes.

Without `S3_BUCKET` (local dev, tests) values pass through unchanged.

Env:
  S3_BUCKET              bucket name (enables S3)
  S3_REGION              default ap-south-1
  S3_PUBLIC_BASE_URL     optional, e.g. a CloudFront domain; defaults to the
                         bucket's virtual-hosted URL
  AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY   standard boto3 credentials
"""
from __future__ import annotations

import asyncio
import base64
import logging
import os
import uuid
from typing import Optional

log = logging.getLogger("gatherspace.images")

S3_BUCKET = os.environ.get("S3_BUCKET", "").strip()
S3_REGION = os.environ.get("S3_REGION", "ap-south-1").strip() or "ap-south-1"
S3_PUBLIC_BASE_URL = os.environ.get("S3_PUBLIC_BASE_URL", "").strip().rstrip("/")
S3_PREFIX = "event-images/"

_EXT = {"image/jpeg": "jpg", "image/jpg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif"}

_client = None


def enabled() -> bool:
    return bool(S3_BUCKET)


def _s3():
    global _client
    if _client is None:
        import boto3  # imported lazily so local dev doesn't need AWS at import time

        _client = boto3.client("s3", region_name=S3_REGION)
    return _client


def public_url(key: str) -> str:
    base = S3_PUBLIC_BASE_URL or f"https://{S3_BUCKET}.s3.{S3_REGION}.amazonaws.com"
    return f"{base}/{key}"


def decode_data_uri(value: str) -> tuple[bytes, str]:
    """Return (bytes, content_type) for a `data:image/*;base64,` URI."""
    header, b64 = value.split(",", 1)
    content_type = header[5:].split(";", 1)[0].lower()
    if content_type not in _EXT:
        raise ValueError(f"Unsupported image type: {content_type}")
    return base64.b64decode(b64), content_type


def _put(data: bytes, content_type: str) -> str:
    key = f"{S3_PREFIX}{uuid.uuid4().hex}.{_EXT[content_type]}"
    _s3().put_object(
        Bucket=S3_BUCKET,
        Key=key,
        Body=data,
        ContentType=content_type,
        CacheControl="public, max-age=31536000, immutable",
    )
    return public_url(key)


async def persist_image(value: Optional[str]) -> Optional[str]:
    """Upload a data-URI image to S3 and return its URL; anything else
    (http(s) URLs, empty values, or S3 disabled) is returned unchanged."""
    if not value or not enabled() or not value.startswith("data:"):
        return value
    data, content_type = decode_data_uri(value)
    loop = asyncio.get_running_loop()
    url = await loop.run_in_executor(None, _put, data, content_type)
    log.info("Stored event image in S3 (%d bytes) -> %s", len(data), url)
    return url
