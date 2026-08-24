"""Back up, verify through R2 round-trip, then upgrade production with Alembic.

This command is deliberately production-only and refuses to run without an
explicit successful release-gate attestation. It is never called by local startup.
"""

from __future__ import annotations

import hashlib
import os
import shutil
import subprocess
import sys
import tempfile
from datetime import datetime, timezone
from pathlib import Path


BACKEND_DIR = Path(__file__).resolve().parents[1]


def required(name: str) -> str:
    value = os.getenv(name, "").strip()
    if not value:
        raise SystemExit(f"{name} is required")
    return value


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def run_checked(arguments: list[str], *, cwd: Path | None = None) -> None:
    subprocess.run(arguments, cwd=cwd, check=True)


def pg_database_url(url: str) -> str:
    if url.startswith("postgresql+psycopg://"):
        return url.replace("postgresql+psycopg://", "postgresql://", 1)
    return url


def main() -> int:
    if os.getenv("APP_ENV", "").strip().lower() != "production":
        raise SystemExit("This migration runner is restricted to APP_ENV=production")
    if os.getenv("APP_SURFACE", "").strip().lower() != "public":
        raise SystemExit("Production migration requires APP_SURFACE=public")
    if os.getenv("RELEASE_GATE_PASSED", "").strip().lower() != "true":
        raise SystemExit("RELEASE_GATE_PASSED=true is required after all CI checks pass")
    database_url = required("DATABASE_URL")
    if not database_url.startswith(("postgres://", "postgresql://", "postgresql+psycopg://")):
        raise SystemExit("Production migration requires a PostgreSQL DATABASE_URL")
    pg_dump = shutil.which("pg_dump")
    pg_restore = shutil.which("pg_restore")
    if not pg_dump or not pg_restore:
        raise SystemExit("pg_dump and pg_restore are required")

    endpoint = required("R2_ENDPOINT_URL")
    bucket = required("R2_BACKUP_BUCKET")
    access_key = required("R2_BACKUP_ACCESS_KEY_ID")
    secret_key = required("R2_BACKUP_SECRET_ACCESS_KEY")
    try:
        import boto3
    except ImportError as exc:
        raise SystemExit("boto3 is required") from exc

    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    release = required("RELEASE_COMMIT_SHA")
    object_name = f"procurex-pre-migration-{stamp}-{release[:12]}.dump"
    key = f"postgres/pre-migration/{object_name}"
    with tempfile.TemporaryDirectory(prefix="procurex-production-migration-") as temporary:
        directory = Path(temporary)
        backup = directory / object_name
        restored_copy = directory / f"verified-{object_name}"
        checksum_file = directory / f"{object_name}.sha256"
        restored_checksum_file = directory / f"verified-{object_name}.sha256"

        run_checked([
            pg_dump, "--format=custom", "--no-owner", "--no-acl",
            pg_database_url(database_url), "--file", str(backup),
        ])
        run_checked([pg_restore, "--list", str(backup)])
        checksum = sha256(backup)
        checksum_file.write_text(f"{checksum}  {object_name}\n", encoding="ascii")

        client = boto3.client(
            "s3",
            endpoint_url=endpoint,
            aws_access_key_id=access_key,
            aws_secret_access_key=secret_key,
            region_name=os.getenv("R2_REGION", "auto"),
        )
        client.upload_file(str(backup), bucket, key)
        client.upload_file(str(checksum_file), bucket, f"{key}.sha256")
        client.download_file(bucket, key, str(restored_copy))
        client.download_file(bucket, f"{key}.sha256", str(restored_checksum_file))
        recorded_checksum = restored_checksum_file.read_text(encoding="ascii").split()[0]
        if recorded_checksum != checksum or sha256(restored_copy) != checksum:
            raise SystemExit("R2 backup round-trip checksum verification failed")
        run_checked([pg_restore, "--list", str(restored_copy)])

        print(f"Verified pre-migration backup: s3://{bucket}/{key}")
        run_checked(
            [sys.executable, "-m", "alembic", "-c", "alembic.ini", "upgrade", "head"],
            cwd=BACKEND_DIR,
        )
    print("Production Alembic upgrade completed after verified backup")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
