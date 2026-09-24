"""Private attachment storage for incoming purchase requests.

Local development keeps the existing filesystem behavior. Hosted deployments
of the public request-intake surface (APP_SURFACE=public) are forced to use
an S3-compatible private bucket (Cloudflare R2 is the supported target). The
full ERP surface (APP_SURFACE=full) may instead use persistent local-disk
storage in production, provided an explicit, non-application-directory path
is configured via PROCUREX_DATA_ROOT or INCOMING_REQUEST_UPLOAD_DIR - see
build_attachment_storage().

Every storage call is blocking I/O (boto3 is synchronous). Request handlers
must use the async helpers at the bottom of this module (put_attachment,
get_attachment, delete_attachment, stream_attachment, ...), which run each
call in a dedicated, bounded thread pool - never on the event loop, where a
slow R2 call would stall every other request on the worker - and must not
hold a database session open across a storage call (the PostgreSQL pool is
small; see database.py). Code already running in a worker thread (e.g. the
document extraction worker) may call the storage object directly.
"""

from __future__ import annotations

import asyncio
import functools
import logging
import os
import weakref
from contextlib import contextmanager
from dataclasses import dataclass
from pathlib import Path
from typing import AsyncIterator, BinaryIO, Iterable

import anyio


ROOT_DIR = Path(__file__).resolve().parent
logger = logging.getLogger(__name__)


class AttachmentStorageUnavailable(RuntimeError):
    """The object store failed, refused, or timed out (after retries).

    The message names only the operation and the provider's error code -
    never credentials, endpoint secrets or object contents - so it is safe
    to log. server.py turns it into a 503."""


def _positive_float_env(name: str, default: float) -> float:
    try:
        value = float(os.getenv(name, "").strip() or default)
    except ValueError:
        return default
    return value if value > 0 else default


def _positive_int_env(name: str, default: int) -> int:
    try:
        value = int(os.getenv(name, "").strip() or default)
    except ValueError:
        return default
    return value if value > 0 else default


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


class _S3Body:
    """botocore StreamingBody whose read errors surface as
    AttachmentStorageUnavailable, like the call that returned it."""

    def __init__(self, body, key: str):
        self._body = body
        self._key = key

    def read(self, size: int = -1) -> bytes:
        with _translate_s3_errors("read", self._key):
            return self._body.read() if size is None or size < 0 else self._body.read(size)

    def close(self) -> None:
        self._body.close()


@contextmanager
def _translate_s3_errors(operation: str, key: str):
    """Missing object -> FileNotFoundError; any other provider/transport
    failure (403, 5xx after retries, connect/read timeout, reset) ->
    AttachmentStorageUnavailable with a credential-free message."""
    from botocore.exceptions import BotoCoreError, ClientError

    try:
        yield
    except ClientError as exc:
        error = exc.response.get("Error", {}) or {}
        code = str(error.get("Code", "") or "unknown")
        status = (exc.response.get("ResponseMetadata", {}) or {}).get("HTTPStatusCode")
        if code in {"NoSuchKey", "NotFound", "404"} or status == 404:
            raise FileNotFoundError(key) from None
        raise AttachmentStorageUnavailable(
            f"object storage {operation} failed: {code} (HTTP {status})"
        ) from None
    except BotoCoreError as exc:
        raise AttachmentStorageUnavailable(
            f"object storage {operation} failed: {type(exc).__name__}"
        ) from None


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
        # boto3's defaults are a 60s connect and 60s read timeout with
        # legacy retries - one hung R2 call could hold a request (and a
        # storage thread) for minutes. Worst case with these defaults is
        # about max_attempts x (connect + read) + backoff, i.e. ~40s, and a
        # read timeout applies per socket read, not per object. Every call
        # here is retry-safe: put_object rewrites the same key with the
        # same bytes, get/delete are idempotent.
        self.client = boto3.client(
            "s3",
            endpoint_url=required["R2_ENDPOINT_URL"],
            aws_access_key_id=required["R2_ACCESS_KEY_ID"],
            aws_secret_access_key=required["R2_SECRET_ACCESS_KEY"],
            region_name=os.getenv("R2_REGION", "auto"),
            config=Config(
                connect_timeout=_positive_float_env("R2_CONNECT_TIMEOUT_SECONDS", 3.0),
                read_timeout=_positive_float_env("R2_READ_TIMEOUT_SECONDS", 10.0),
                # total_max_attempts counts the first call; botocore's
                # "max_attempts" key would count retries only (3 -> 4 calls).
                retries={
                    "mode": "standard",
                    "total_max_attempts": _positive_int_env("R2_MAX_ATTEMPTS", 3),
                },
                # At least one pooled connection per storage thread, so
                # threads never queue inside urllib3 for a connection.
                max_pool_connections=max(
                    _positive_int_env("R2_MAX_POOL_CONNECTIONS", 10),
                    _positive_int_env("ATTACHMENT_STORAGE_MAX_THREADS", 10),
                ),
            ),
        )

    def put(self, key: str, content: bytes, media_type: str, sha256: str) -> None:
        with _translate_s3_errors("put", key):
            self.client.put_object(
                Bucket=self.bucket,
                Key=key,
                Body=content,
                ContentLength=len(content),
                ContentType=media_type,
                Metadata={"sha256": sha256},
            )

    def get(self, key: str) -> StoredAttachment:
        with _translate_s3_errors("get", key):
            response = self.client.get_object(Bucket=self.bucket, Key=key)
        return StoredAttachment(_S3Body(response["Body"], key), int(response.get("ContentLength", 0)))

    def delete(self, key: str) -> None:
        with _translate_s3_errors("delete", key):
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


# ---------- Async helpers for request handlers ----------
#
# One CapacityLimiter per event loop (anyio limiters bind to the loop that
# first waits on them; tests create several). ATTACHMENT_STORAGE_MAX_THREADS
# caps concurrent storage calls per worker process: excess calls queue for
# a slot instead of spawning threads, and because this is a separate
# limiter from Starlette's default thread pool (40, used by every sync
# `def` route), slow storage can never starve unrelated sync routes.

_limiters: "weakref.WeakKeyDictionary[asyncio.AbstractEventLoop, anyio.CapacityLimiter]" = (
    weakref.WeakKeyDictionary()
)
STREAM_CHUNK_BYTES = 64 * 1024


def _storage_limiter() -> anyio.CapacityLimiter:
    loop = asyncio.get_running_loop()
    limiter = _limiters.get(loop)
    if limiter is None:
        limiter = anyio.CapacityLimiter(_positive_int_env("ATTACHMENT_STORAGE_MAX_THREADS", 10))
        _limiters[loop] = limiter
    return limiter


async def run_storage_call(function, *args):
    """Run one blocking storage call off the event loop."""
    return await anyio.to_thread.run_sync(
        functools.partial(function, *args), limiter=_storage_limiter()
    )


async def put_attachment(key: str, content: bytes, media_type: str, sha256: str) -> None:
    await run_storage_call(get_attachment_storage().put, key, content, media_type, sha256)


async def get_attachment(key: str) -> StoredAttachment:
    return await run_storage_call(get_attachment_storage().get, key)


async def delete_attachment(key: str) -> None:
    await run_storage_call(get_attachment_storage().delete, key)


def delete_attachments_quietly(keys: Iterable[str]) -> None:
    """Best-effort cleanup for code already off the event loop. Never
    raises: a failed cleanup must not replace the error that caused it."""
    storage = get_attachment_storage()
    for key in keys:
        try:
            storage.delete(key)
        except Exception as exc:
            logger.warning("Attachment cleanup failed: key=%s error=%s", key, _describe_error(exc))


async def delete_attachments_quietly_async(keys: Iterable[str]) -> None:
    """Async twin of delete_attachments_quietly."""
    for key in list(keys):
        try:
            await delete_attachment(key)
        except Exception as exc:
            logger.warning("Attachment cleanup failed: key=%s error=%s", key, _describe_error(exc))


async def stream_attachment(stored: StoredAttachment, chunk_size: int = STREAM_CHUNK_BYTES) -> AsyncIterator[bytes]:
    """StreamingResponse body: reads fixed-size chunks off the event loop
    and always closes the underlying file/HTTP body (returning an R2
    connection to the pool), including when the client disconnects."""
    try:
        while True:
            chunk = await run_storage_call(stored.body.read, chunk_size)
            if not chunk:
                break
            yield chunk
    finally:
        try:
            stored.body.close()
        except Exception:
            pass


def _describe_error(exc: BaseException) -> str:
    if isinstance(exc, AttachmentStorageUnavailable):
        return str(exc)
    return type(exc).__name__
