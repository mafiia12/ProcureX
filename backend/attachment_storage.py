"""Private attachment storage for incoming purchase requests.

Local development keeps the existing filesystem behavior. Hosted deployments
of the public request-intake surface (APP_SURFACE=public) are forced to use
an S3-compatible private bucket (Cloudflare R2 is the supported target). The
full ERP surface (APP_SURFACE=full) may instead use persistent local-disk
storage in production, provided an explicit, non-application-directory path
is configured via PROCUREX_DATA_ROOT or INCOMING_REQUEST_UPLOAD_DIR - see
build_attachment_storage().
"""

from __future__ import annotations

import asyncio
import os
import weakref
from dataclasses import dataclass
from pathlib import Path
from typing import Any, BinaryIO, Callable

from anyio import CapacityLimiter, to_thread


ROOT_DIR = Path(__file__).resolve().parent

# Blocking storage calls (boto3/R2, local disk) run in worker threads, but
# NOT on the thread pool that sync routes (login, approvals, RFQ, portal)
# share: measured, 45 downloads hanging on R2 held all 40 default threads
# and login took 62.7s. A separate cap keeps storage from ever taking more
# than this many threads per process; extra calls wait asynchronously.
STORAGE_MAX_CONCURRENCY = max(1, int(os.getenv("STORAGE_MAX_CONCURRENCY", "8")))
_storage_limiters: "weakref.WeakKeyDictionary[asyncio.AbstractEventLoop, CapacityLimiter]" = (
    weakref.WeakKeyDictionary()
)


async def run_storage_io(func: Callable[..., Any], *args: Any) -> Any:
    """Run one blocking storage call off the event loop, within the
    storage-only concurrency cap (one limiter per event loop)."""
    loop = asyncio.get_running_loop()
    limiter = _storage_limiters.get(loop)
    if limiter is None:
        limiter = _storage_limiters[loop] = CapacityLimiter(STORAGE_MAX_CONCURRENCY)
    return await to_thread.run_sync(func, *args, limiter=limiter)


@dataclass
class StoredAttachment:
    body: BinaryIO
    content_length: int


class AttachmentStorage:
    def put(self, key: str, content: bytes, media_type: str, sha256: str) -> None:
        raise NotImplementedError

    def get(self, key: str) -> StoredAttachment:
        raise NotImplementedError

    def delete(self, key: str) -> None:
        raise NotImplementedError


class LocalAttachmentStorage(AttachmentStorage):
    def __init__(self, root: Path):
        self.root = root.resolve()

    def _target(self, key: str) -> Path:
        target = (self.root / key).resolve()
        if self.root not in target.parents:
            raise ValueError("Invalid attachment key")
        return target

    def put(self, key: str, content: bytes, media_type: str, sha256: str) -> None:
        target = self._target(key)
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(content)

    def get(self, key: str) -> StoredAttachment:
        target = self._target(key)
        if not target.is_file():
            raise FileNotFoundError(key)
        return StoredAttachment(target.open("rb"), target.stat().st_size)

    def delete(self, key: str) -> None:
        target = self._target(key)
        if target.is_file():
            target.unlink()
        parent = target.parent
        if parent != self.root and parent.is_dir() and not any(parent.iterdir()):
            parent.rmdir()


class S3AttachmentStorage(AttachmentStorage):
    def __init__(self):
        try:
            import boto3
            from botocore.config import Config
        except ImportError as exc:  # pragma: no cover - production dependency guard
            raise RuntimeError("boto3 is required when ATTACHMENT_STORAGE_BACKEND=s3") from exc

        required = {
            "R2_ENDPOINT_URL": os.getenv("R2_ENDPOINT_URL", "").strip(),
            "R2_ACCESS_KEY_ID": os.getenv("R2_ACCESS_KEY_ID", "").strip(),
            "R2_SECRET_ACCESS_KEY": os.getenv("R2_SECRET_ACCESS_KEY", "").strip(),
            "R2_BUCKET_NAME": os.getenv("R2_BUCKET_NAME", "").strip(),
        }
        missing = [name for name, value in required.items() if not value]
        if missing:
            raise RuntimeError(f"Missing S3/R2 settings: {', '.join(missing)}")
        self.bucket = required["R2_BUCKET_NAME"]
        # botocore's bare defaults (60s connect + 60s read, legacy retries)
        # were never reviewed for this app. Measured against a fake
        # endpoint: with 5s/30s and 3 attempts a hung R2 took ~124s to fail
        # and an unreachable one ~25s - far past the frontend's 30s timeout.
        # The read timeout is per socket read, not per transfer, so 10s
        # still allows the largest configured attachments (25-30MB).
        # 'standard' retries skip 4xx/auth failures and add jittered
        # backoff for transient errors. Pool size matches the storage
        # concurrency cap. All env-overridable; see
        # docs/production-capacity-plan.md, "S3/R2 attachment storage".
        self.client = boto3.client(
            "s3",
            endpoint_url=required["R2_ENDPOINT_URL"],
            aws_access_key_id=required["R2_ACCESS_KEY_ID"],
            aws_secret_access_key=required["R2_SECRET_ACCESS_KEY"],
            region_name=os.getenv("R2_REGION", "auto"),
            config=Config(
                connect_timeout=float(os.getenv("R2_CONNECT_TIMEOUT_SECONDS", "3")),
                read_timeout=float(os.getenv("R2_READ_TIMEOUT_SECONDS", "10")),
                max_pool_connections=STORAGE_MAX_CONCURRENCY,
                # total_max_attempts counts the first try; botocore's "max_attempts"
                # key counts retries only (3 meant 4 tries, measured).
                retries={"mode": "standard", "total_max_attempts": int(os.getenv("R2_MAX_ATTEMPTS", "2"))},
            ),
        )

    def put(self, key: str, content: bytes, media_type: str, sha256: str) -> None:
        self.client.put_object(
            Bucket=self.bucket,
            Key=key,
            Body=content,
            ContentLength=len(content),
            ContentType=media_type,
            Metadata={"sha256": sha256},
        )

    def get(self, key: str) -> StoredAttachment:
        try:
            response = self.client.get_object(Bucket=self.bucket, Key=key)
        except self.client.exceptions.NoSuchKey as exc:
            raise FileNotFoundError(key) from exc
        return StoredAttachment(response["Body"], int(response.get("ContentLength", 0)))

    def delete(self, key: str) -> None:
        self.client.delete_object(Bucket=self.bucket, Key=key)


def _resolve_configured_local_root() -> Path | None:
    """Mirrors server.py's _runtime_paths() attachment-path precedence
    (PROCUREX_DATA_ROOT first, then the attachment-specific override) so
    diagnostics and the actual storage backend never disagree about where
    attachments live. Returns None if neither is explicitly configured -
    callers decide whether that's acceptable for the current environment."""
    data_root = os.getenv("PROCUREX_DATA_ROOT", "").strip()
    if data_root:
        return (
            Path(os.path.expandvars(data_root)).resolve()
            / "data" / "attachments" / "incoming_requests"
        )
    upload_dir = os.getenv("INCOMING_REQUEST_UPLOAD_DIR", "").strip()
    if upload_dir:
        return Path(os.path.expandvars(upload_dir)).resolve()
    return None


def build_attachment_storage() -> AttachmentStorage:
    backend = os.getenv("ATTACHMENT_STORAGE_BACKEND", "local").strip().lower()
    environment = os.getenv("APP_ENV", "development").strip().lower()
    surface = os.getenv("APP_SURFACE", "full").strip().lower()
    is_hosted = environment in {"staging", "production"}

    # The public surface's architecture is unchanged: hosted deployments of
    # the public request-intake API always require private S3-compatible
    # storage, regardless of what the full ERP surface is doing.
    if is_hosted and surface == "public" and backend != "s3":
        raise RuntimeError(
            f"{environment.capitalize()} public-surface deployments require ATTACHMENT_STORAGE_BACKEND=s3"
        )
    if backend == "s3":
        return S3AttachmentStorage()
    if backend != "local":
        raise RuntimeError("ATTACHMENT_STORAGE_BACKEND must be 'local' or 's3'")

    configured_root = _resolve_configured_local_root()
    if is_hosted and surface == "full":
        # The single-instance full-ERP architecture approves persistent local
        # disk for attachments, but only an explicitly configured one - never
        # a silent default into the application/release directory, which is
        # replaced on every deploy.
        if configured_root is None:
            raise RuntimeError(
                f"{environment.capitalize()} full-surface local attachment storage requires an "
                "explicit persistent path via PROCUREX_DATA_ROOT or INCOMING_REQUEST_UPLOAD_DIR - "
                "it must not silently fall back to a path inside the application directory"
            )
        if configured_root == ROOT_DIR or ROOT_DIR in configured_root.parents:
            raise RuntimeError(
                f"{environment.capitalize()} full-surface attachment storage path "
                f"({configured_root}) must be outside the application directory so it "
                "survives code releases"
            )
        return LocalAttachmentStorage(configured_root)

    root = configured_root or (ROOT_DIR / "storage" / "incoming_requests")
    return LocalAttachmentStorage(root)


_storage: AttachmentStorage | None = None


def get_attachment_storage() -> AttachmentStorage:
    global _storage
    if _storage is None:
        _storage = build_attachment_storage()
    return _storage
