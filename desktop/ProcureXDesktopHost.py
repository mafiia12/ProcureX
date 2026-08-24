"""Self-contained desktop host for the installed ProcureX application.

The launcher starts this executable with either ``--backend`` or ``--frontend``.
The maintenance modes use Python's SQLite backup API so live business data is
never copied as an ordinary file.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import shutil
import socket
import sqlite3
import sys
import tempfile
import uuid
from contextlib import closing
from datetime import datetime, timezone
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote, urlsplit


APP_NAME = "ProcureX"
APP_VERSION = "0.3.0"
BACKUP_FORMAT_VERSION = 1
REQUIRED_SCHEMA = {
    "purchases": {"id", "purchase_id", "invoice_number", "invoice_total"},
    "purchase_items": {"id", "purchase_id", "item_id", "line_total"},
    "payments": {"id", "payment_id", "purchase_id", "amount_paid"},
    "price_history": {"id", "record_no", "invoice_number", "final_price"},
    "suppliers": {"id", "name"},
    "items": {"id", "name", "unit"},
}


def data_root() -> Path:
    configured = os.getenv("PROCUREX_DATA_ROOT", "").strip()
    if configured:
        return Path(os.path.expandvars(configured)).resolve()
    local_app_data = os.getenv("LOCALAPPDATA", "").strip()
    if not local_app_data:
        raise RuntimeError(
            "LOCALAPPDATA is unavailable; ProcureX cannot resolve its data folder"
        )
    return (Path(local_app_data) / APP_NAME).resolve()


def data_paths() -> dict[str, Path]:
    root = data_root()
    paths = {
        "root": root,
        "data": root / "data",
        "database": root / "data" / "procurement.db",
        "attachments": root / "data" / "attachments" / "incoming_requests",
        "backups": root / "data" / "backups",
        "logs": root / "logs",
    }
    for name in ("data", "attachments", "backups", "logs"):
        paths[name].mkdir(parents=True, exist_ok=True)
    return paths


def table_counts(connection: sqlite3.Connection) -> dict[str, int]:
    tables = [
        row[0]
        for row in connection.execute(
            "SELECT name FROM sqlite_master "
            "WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
        )
    ]
    return {
        table: connection.execute(f'SELECT COUNT(*) FROM "{table}"').fetchone()[0]
        for table in tables
    }


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def schema_metadata(connection: sqlite3.Connection) -> dict[str, object]:
    tables = {
        row[0]
        for row in connection.execute(
            "SELECT name FROM sqlite_master WHERE type = 'table'"
        )
    }
    missing_tables = sorted(set(REQUIRED_SCHEMA) - tables)
    missing_columns: dict[str, list[str]] = {}
    schema: dict[str, list[str]] = {}
    for table, required_columns in REQUIRED_SCHEMA.items():
        if table not in tables:
            continue
        columns = sorted(
            row[1] for row in connection.execute(f'PRAGMA table_info("{table}")')
        )
        schema[table] = columns
        missing = sorted(required_columns - set(columns))
        if missing:
            missing_columns[table] = missing
    if missing_tables or missing_columns:
        raise RuntimeError(
            "The selected database schema is not compatible with ProcureX 0.3.0"
        )
    encoded = json.dumps(schema, sort_keys=True, separators=(",", ":")).encode()
    return {
        "required_schema_version": "0.3",
        "signature": hashlib.sha256(encoded).hexdigest(),
        "tables": schema,
    }


def verify_database(path: Path, *, immutable: bool = False) -> dict[str, object]:
    if not path.is_file():
        raise FileNotFoundError(f"Database does not exist: {path}")
    immutable_option = "&immutable=1" if immutable else ""
    uri = f"file:{path.as_posix()}?mode=ro{immutable_option}"
    with closing(sqlite3.connect(uri, uri=True)) as connection:
        integrity = connection.execute("PRAGMA integrity_check").fetchone()[0]
        foreign_keys = connection.execute("PRAGMA foreign_key_check").fetchall()
        counts = table_counts(connection)
        schema = schema_metadata(connection)
    if integrity != "ok" or foreign_keys:
        raise RuntimeError(
            f"Database verification failed: integrity={integrity!r}, "
            f"foreign_key_violations={len(foreign_keys)}"
        )
    return {
        "integrity": integrity,
        "foreign_key_violations": 0,
        "table_counts": counts,
        "schema": schema,
    }


def backup_companions(database: Path) -> tuple[Path, Path]:
    stem = database.with_suffix("")
    return Path(f"{stem}.attachments"), Path(f"{stem}.manifest.json")


def attachment_inventory(root: Path) -> list[dict[str, object]]:
    if not root.is_dir():
        return []
    return [
        {
            "path": path.relative_to(root).as_posix(),
            "size_bytes": path.stat().st_size,
            "sha256": sha256_file(path),
        }
        for path in sorted(root.rglob("*"))
        if path.is_file()
    ]


def verify_attachment_inventory(
    root: Path, expected: list[dict[str, object]]
) -> None:
    actual = attachment_inventory(root)
    if actual != expected:
        raise RuntimeError("The backup attachment set failed verification")


def atomic_json(path: Path, payload: dict[str, object]) -> None:
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    os.replace(temporary, path)


def unique_backup_path(database: Path, backup_dir: Path, label: str) -> Path:
    backup_dir.mkdir(parents=True, exist_ok=True)
    safe_label = "".join(
        character for character in label if character.isalnum() or character in "-_"
    )
    safe_label = safe_label or "manual"
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    candidate = backup_dir / f"{database.stem}.{safe_label}-{stamp}{database.suffix}"
    sequence = 1
    while candidate.exists():
        candidate = backup_dir / (
            f"{database.stem}.{safe_label}-{stamp}-{sequence}{database.suffix}"
        )
        sequence += 1
    return candidate


def backup_database(label: str = "manual") -> dict[str, object]:
    paths = data_paths()
    source = paths["database"]
    if not source.is_file():
        return {"status": "no_database", "message": "No ProcureX database exists yet."}
    source_verification = verify_database(source)
    destination = unique_backup_path(source, paths["backups"], label)
    attachments_destination, manifest_path = backup_companions(destination)
    attachments_temporary = Path(f"{attachments_destination}.tmp-{uuid.uuid4().hex}")
    try:
        with closing(sqlite3.connect(source)) as source_connection:
            with closing(sqlite3.connect(destination)) as backup_connection:
                source_connection.backup(backup_connection)
        destination_verification = verify_database(destination, immutable=True)
        if destination_verification["table_counts"] != source_verification["table_counts"]:
            raise RuntimeError("Backup row-count verification failed")

        if paths["attachments"].is_dir():
            shutil.copytree(paths["attachments"], attachments_temporary)
        else:
            attachments_temporary.mkdir(parents=True)
        attachments = attachment_inventory(attachments_temporary)
        os.replace(attachments_temporary, attachments_destination)
        verify_attachment_inventory(attachments_destination, attachments)

        manifest = {
            "format_version": BACKUP_FORMAT_VERSION,
            "app_version": APP_VERSION,
            "created_utc": datetime.now(timezone.utc).isoformat(),
            "database_file": destination.name,
            "database_sha256": sha256_file(destination),
            "schema": destination_verification["schema"],
            "attachments_directory": attachments_destination.name,
            "attachments": attachments,
        }
        atomic_json(manifest_path, manifest)
        atomic_json(
            paths["backups"] / "last-successful-backup.json",
            {
                "created_utc": manifest["created_utc"],
                "database_file": destination.name,
                "manifest_file": manifest_path.name,
                "attachment_count": len(attachments),
            },
        )
        return {
            "status": "ok",
            "message": "Verified database and attachment backup created.",
            "backup": str(destination),
            "manifest": str(manifest_path),
            "attachments": str(attachments_destination),
            "attachment_count": len(attachments),
            **destination_verification,
        }
    except Exception:
        destination.unlink(missing_ok=True)
        manifest_path.unlink(missing_ok=True)
        shutil.rmtree(attachments_temporary, ignore_errors=True)
        shutil.rmtree(attachments_destination, ignore_errors=True)
        raise


def load_backup_manifest(database: Path, verification: dict[str, object]):
    attachments_path, manifest_path = backup_companions(database)
    if not manifest_path.is_file():
        return None, None
    manifest = json.loads(manifest_path.read_text(encoding="utf-8-sig"))
    if manifest.get("format_version") != BACKUP_FORMAT_VERSION:
        raise RuntimeError("The selected backup format is not supported")
    if str(manifest.get("app_version", "")).split(".")[:2] != APP_VERSION.split(".")[:2]:
        raise RuntimeError("The selected backup was created by an incompatible ProcureX version")
    if manifest.get("database_sha256") != sha256_file(database):
        raise RuntimeError("The selected backup database checksum does not match its manifest")
    if manifest.get("schema", {}).get("signature") != verification["schema"]["signature"]:
        raise RuntimeError("The selected backup schema does not match its manifest")
    if not attachments_path.is_dir():
        raise RuntimeError("The selected backup is missing its attachment set")
    verify_attachment_inventory(attachments_path, manifest.get("attachments", []))
    return manifest, attachments_path


def preserve_unverified_database(database: Path, paths: dict[str, Path]) -> str:
    destination = unique_backup_path(database, paths["backups"], "pre-restore-unverified")
    shutil.copy2(database, destination)
    for suffix in ("-wal", "-shm"):
        companion = Path(str(database) + suffix)
        if companion.is_file():
            shutil.copy2(companion, Path(str(destination) + suffix))
    attachments_destination, manifest_path = backup_companions(destination)
    shutil.copytree(paths["attachments"], attachments_destination)
    atomic_json(
        manifest_path,
        {
            "format_version": BACKUP_FORMAT_VERSION,
            "app_version": APP_VERSION,
            "created_utc": datetime.now(timezone.utc).isoformat(),
            "unverified": True,
            "database_file": destination.name,
            "database_sha256": sha256_file(destination),
            "attachments_directory": attachments_destination.name,
            "attachments": attachment_inventory(attachments_destination),
        },
    )
    return str(destination)


def port_is_listening(port: int) -> bool:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as connection:
        connection.settimeout(0.4)
        return connection.connect_ex(("127.0.0.1", port)) == 0


def restore_database(source: Path) -> dict[str, object]:
    if port_is_listening(8000):
        raise RuntimeError("Stop ProcureX before restoring the database")
    source = source.resolve()
    source_verification = verify_database(source)
    manifest, source_attachments = load_backup_manifest(source, source_verification)
    paths = data_paths()
    destination = paths["database"]
    safety_backup = None
    if destination.is_file():
        try:
            safety_backup = backup_database("pre-restore").get("backup")
        except Exception:
            safety_backup = preserve_unverified_database(destination, paths)

    temporary = destination.with_suffix(".restore.tmp")
    database_rollback = destination.with_suffix(".restore.rollback")
    attachment_temporary = Path(f"{paths['attachments']}.restore-{uuid.uuid4().hex}")
    attachment_rollback = Path(f"{paths['attachments']}.rollback-{uuid.uuid4().hex}")
    temporary.unlink(missing_ok=True)
    database_rollback.unlink(missing_ok=True)
    try:
        with closing(
            sqlite3.connect(f"file:{source.as_posix()}?mode=ro", uri=True)
        ) as source_connection:
            with closing(sqlite3.connect(temporary)) as target_connection:
                source_connection.backup(target_connection)
        restored_verification = verify_database(temporary, immutable=True)
        if restored_verification["table_counts"] != source_verification["table_counts"]:
            raise RuntimeError(
                "Restored database row counts do not match the selected backup"
            )
        if source_attachments:
            shutil.copytree(source_attachments, attachment_temporary)
            verify_attachment_inventory(
                attachment_temporary, manifest.get("attachments", [])
            )
            os.replace(paths["attachments"], attachment_rollback)
            try:
                os.replace(attachment_temporary, paths["attachments"])
            except Exception:
                os.replace(attachment_rollback, paths["attachments"])
                raise
        for suffix in ("-wal", "-shm"):
            Path(str(destination) + suffix).unlink(missing_ok=True)
        try:
            if destination.exists():
                os.replace(destination, database_rollback)
            try:
                os.replace(temporary, destination)
            except Exception:
                if database_rollback.exists():
                    os.replace(database_rollback, destination)
                raise
        except Exception:
            if source_attachments and attachment_rollback.exists():
                failed_attachments = Path(f"{paths['attachments']}.failed-{uuid.uuid4().hex}")
                os.replace(paths["attachments"], failed_attachments)
                os.replace(attachment_rollback, paths["attachments"])
            raise
        database_rollback.unlink(missing_ok=True)
        if attachment_rollback.exists():
            shutil.rmtree(attachment_rollback)
    finally:
        temporary.unlink(missing_ok=True)
        shutil.rmtree(attachment_temporary, ignore_errors=True)
    return {
        "status": "ok",
        "message": "Database and matching attachments restored and verified.",
        "database": str(destination),
        "safety_backup": safety_backup,
        "attachment_count": len(manifest.get("attachments", [])) if manifest else None,
        "legacy_database_only_backup": manifest is None,
        **source_verification,
    }


class SpaRequestHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, directory: str, **kwargs):
        super().__init__(*args, directory=directory, **kwargs)

    def log_message(self, format: str, *args) -> None:
        print(f"[frontend] {self.address_string()} {format % args}", flush=True)

    def send_head(self):
        requested = unquote(urlsplit(self.path).path)
        candidate = (Path(self.directory) / requested.lstrip("/")).resolve()
        root = Path(self.directory).resolve()
        if root not in candidate.parents and candidate != root:
            self.send_error(404)
            return None
        if not candidate.exists() and not Path(requested).suffix:
            self.path = "/index.html"
        return super().send_head()


def serve_frontend(root: Path) -> None:
    root = root.resolve()
    if not (root / "index.html").is_file():
        raise FileNotFoundError(
            f"Production frontend build is missing: {root / 'index.html'}"
        )

    def handler(*args, **kwargs):
        return SpaRequestHandler(*args, directory=str(root), **kwargs)

    ThreadingHTTPServer.allow_reuse_address = True
    with ThreadingHTTPServer(("127.0.0.1", 3000), handler) as server:
        print(
            f"Serving ProcureX frontend from {root} on http://127.0.0.1:3000",
            flush=True,
        )
        server.serve_forever()


def serve_backend() -> None:
    data_paths()
    import uvicorn
    from server import app

    uvicorn.run(app, host="127.0.0.1", port=8000, log_level="info", access_log=False)


def write_result(path: str | None, payload: dict[str, object]) -> None:
    rendered = json.dumps(payload, ensure_ascii=False, indent=2)
    if path:
        Path(path).write_text(rendered, encoding="utf-8")
    print(rendered, flush=True)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="ProcureX desktop runtime")
    modes = parser.add_mutually_exclusive_group(required=True)
    modes.add_argument("--backend", action="store_true")
    modes.add_argument("--frontend", metavar="DIRECTORY")
    modes.add_argument("--backup", action="store_true")
    modes.add_argument("--restore", metavar="DATABASE")
    modes.add_argument("--self-test", action="store_true")
    parser.add_argument("--label", default="manual")
    parser.add_argument("--result-file")
    parser.add_argument("--data-root")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    if args.data_root:
        os.environ["PROCUREX_DATA_ROOT"] = str(Path(args.data_root).resolve())
    try:
        if args.backend:
            serve_backend()
        elif args.frontend:
            serve_frontend(Path(args.frontend))
        elif args.backup:
            write_result(args.result_file, backup_database(args.label))
        elif args.restore:
            write_result(args.result_file, restore_database(Path(args.restore)))
        else:
            paths = data_paths()
            write_result(
                args.result_file,
                {
                    "status": "ok",
                    "message": "ProcureX desktop runtime self-test passed.",
                    "data_root": str(paths["root"]),
                    "python": sys.version,
                },
            )
        return 0
    except Exception as error:
        payload = {
            "status": "error",
            "message": str(error),
            "type": type(error).__name__,
        }
        write_result(args.result_file, payload)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
