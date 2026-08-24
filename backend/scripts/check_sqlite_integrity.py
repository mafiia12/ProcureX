"""Read-only SQLite integrity, foreign-key, count, and checksum verification."""

from __future__ import annotations

import argparse
import hashlib
import json
import sqlite3
from pathlib import Path


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def inspect_database(path: Path) -> dict:
    resolved = path.resolve()
    if not resolved.is_file():
        raise SystemExit(f"SQLite database not found: {resolved}")
    connection = sqlite3.connect(f"file:{resolved.as_posix()}?mode=ro", uri=True)
    try:
        connection.execute("PRAGMA query_only=ON")
        integrity = connection.execute("PRAGMA integrity_check").fetchone()[0]
        violations = connection.execute("PRAGMA foreign_key_check").fetchall()
        tables = [row[0] for row in connection.execute(
            "SELECT name FROM sqlite_master "
            "WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
        )]
        counts = {
            table: connection.execute(f'SELECT COUNT(*) FROM "{table}"').fetchone()[0]
            for table in tables
        }
    finally:
        connection.close()
    if integrity != "ok":
        raise SystemExit(f"SQLite integrity check failed: {integrity}")
    if violations:
        raise SystemExit(f"SQLite foreign-key violations: {violations}")
    return {
        "database": str(resolved),
        "sha256": sha256(resolved),
        "integrity": integrity,
        "foreign_key_violations": 0,
        "counts": counts,
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("database", type=Path)
    args = parser.parse_args()
    print(json.dumps(inspect_database(args.database), indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
