"""Upload existing incoming-request attachments to a private R2 bucket."""

from __future__ import annotations

import argparse
import hashlib
import os
import sqlite3
from pathlib import Path


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--sqlite", type=Path, required=True)
    parser.add_argument("--upload-root", type=Path, required=True)
    parser.add_argument("--execute", action="store_true")
    args = parser.parse_args()
    if not args.execute:
        print("Dry run only. Re-run with --execute after validating paths and R2 credentials.")

    try:
        import boto3
        from botocore.exceptions import ClientError
    except ImportError as exc:
        raise SystemExit("Install requirements-production.txt before running this script") from exc
    settings = {name: os.getenv(name, "") for name in (
        "R2_ENDPOINT_URL", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_BUCKET_NAME",
    )}
    missing = [name for name, value in settings.items() if not value]
    if missing:
        raise SystemExit(f"Missing R2 settings: {', '.join(missing)}")
    client = boto3.client(
        "s3", endpoint_url=settings["R2_ENDPOINT_URL"],
        aws_access_key_id=settings["R2_ACCESS_KEY_ID"],
        aws_secret_access_key=settings["R2_SECRET_ACCESS_KEY"], region_name="auto",
    )
    connection = sqlite3.connect(f"file:{args.sqlite.resolve().as_posix()}?mode=ro", uri=True)
    connection.row_factory = sqlite3.Row
    rows = connection.execute(
        "SELECT stored_filename, media_type, sha256 FROM incoming_request_attachments"
    ).fetchall()
    uploaded = 0
    for row in rows:
        source = (args.upload_root.resolve() / row["stored_filename"]).resolve()
        if args.upload_root.resolve() not in source.parents or not source.is_file():
            raise RuntimeError(f"Missing or invalid local attachment: {row['stored_filename']}")
        digest = hashlib.sha256(source.read_bytes()).hexdigest()
        if digest != row["sha256"]:
            raise RuntimeError(f"Checksum mismatch: {row['stored_filename']}")
        try:
            client.head_object(Bucket=settings["R2_BUCKET_NAME"], Key=row["stored_filename"])
            raise RuntimeError(f"R2 object already exists; refusing overwrite: {row['stored_filename']}")
        except ClientError as exc:
            if exc.response.get("ResponseMetadata", {}).get("HTTPStatusCode") != 404:
                raise
        if args.execute:
            client.upload_file(
                str(source), settings["R2_BUCKET_NAME"], row["stored_filename"],
                ExtraArgs={"ContentType": row["media_type"], "Metadata": {"sha256": digest}},
            )
            uploaded += 1
    print(f"Validated {len(rows)} attachment(s); uploaded {uploaded}.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
