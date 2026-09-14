"""Compute semantic and exact-DDL fingerprints for ProcureX SQLite databases."""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import sqlite3
from pathlib import Path
from typing import Any


def _canonical_json(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def _hash(value: Any) -> str:
    return hashlib.sha256(_canonical_json(value).encode("utf-8")).hexdigest()


def _normalize_type(value: str) -> str:
    upper = (value or "").strip().upper()
    if "INT" in upper:
        return "INTEGER"
    if any(token in upper for token in ("CHAR", "CLOB", "TEXT")):
        return "TEXT"
    if "JSON" in upper:
        return "JSON"
    if any(token in upper for token in ("REAL", "FLOA", "DOUB")):
        return "REAL"
    if any(token in upper for token in ("NUM", "DEC")):
        return "NUMERIC"
    if "BLOB" in upper or not upper:
        return "BLOB"
    return upper


def _normalize_default(value: Any) -> str | None:
    if value is None:
        return None
    result = str(value).strip()
    while result.startswith("(") and result.endswith(")"):
        result = result[1:-1].strip()
    if len(result) >= 2 and result[0] == result[-1] == '"':
        result = "'" + result[1:-1].replace("'", "''") + "'"
    return result


def _table_names(connection: sqlite3.Connection) -> list[str]:
    return [
        row[0]
        for row in connection.execute(
            "SELECT name FROM sqlite_master WHERE type='table' "
            "AND name NOT LIKE 'sqlite_%' AND name <> 'alembic_version' ORDER BY name"
        )
    ]


def _index_columns(connection: sqlite3.Connection, name: str) -> tuple[str, ...]:
    escaped = name.replace('"', '""')
    return tuple(
        row[2]
        for row in connection.execute(f'PRAGMA index_info("{escaped}")')
        if row[2] is not None
    )


def _logical_indexes(
    indexes: list[dict[str, Any]], unique_sets: set[tuple[str, ...]]
) -> list[dict[str, Any]]:
    candidates = [
        item for item in indexes if not item["unique"] and item["origin"] == "c"
    ]
    result: list[dict[str, Any]] = []
    for item in candidates:
        columns = tuple(item["columns"])
        # A unique key or a longer B-tree index provides the same left-prefix
        # lookup.  Ignore these redundant physical indexes semantically while
        # retaining them in the exact-DDL diagnostic.
        covered_by_unique = any(
            len(key) >= len(columns) and key[: len(columns)] == columns
            for key in unique_sets
        )
        covered_by_index = any(
            other is not item
            and len(other["columns"]) > len(columns)
            and tuple(other["columns"][: len(columns)]) == columns
            for other in candidates
        )
        if not covered_by_unique and not covered_by_index:
            result.append({"columns": list(columns), "unique": False})
    return sorted(result, key=lambda item: tuple(item["columns"]))


def _check_constraints(create_sql: str) -> list[str]:
    checks = []
    for expression in re.findall(r"CHECK\s*\(([^()]*)\)", create_sql, flags=re.I):
        checks.append(re.sub(r"\s+", " ", expression.strip()).lower())
    return sorted(set(checks))


def semantic_schema(connection: sqlite3.Connection) -> dict[str, Any]:
    tables: dict[str, Any] = {}
    for table in _table_names(connection):
        escaped = table.replace('"', '""')
        columns_raw = list(connection.execute(f'PRAGMA table_info("{escaped}")'))
        columns = [
            {
                "name": row[1],
                "type": _normalize_type(row[2]),
                # SQLite may report NOT NULL=false for a non-integer PK even
                # though the key is logically required.
                "required": bool(row[3] or row[5]),
                "default": _normalize_default(row[4]),
            }
            for row in columns_raw
        ]
        # Column declaration order has no semantic effect when names, types,
        # keys, constraints, and indexes match. Legacy SQLite migrations append
        # additive columns, while Alembic can declare the same columns inline.
        columns.sort(key=lambda item: item["name"])
        primary_key = [
            row[1] for row in sorted(columns_raw, key=lambda item: item[5]) if row[5]
        ]
        indexes = []
        for row in connection.execute(f'PRAGMA index_list("{escaped}")'):
            indexes.append(
                {
                    "name": row[1],
                    "unique": bool(row[2]),
                    "origin": row[3],
                    "columns": list(_index_columns(connection, row[1])),
                }
            )
        unique_sets = {
            tuple(item["columns"])
            for item in indexes
            if item["unique"] and item["columns"]
        }
        foreign_keys = [
            {
                "columns": [row[3]],
                "referred_table": row[2],
                "referred_columns": [row[4]],
                "on_update": (row[5] or "NO ACTION").upper(),
                "on_delete": (row[6] or "NO ACTION").upper(),
            }
            for row in connection.execute(f'PRAGMA foreign_key_list("{escaped}")')
        ]
        foreign_keys.sort(
            key=lambda item: (
                tuple(item["columns"]),
                item["referred_table"],
                tuple(item["referred_columns"]),
            )
        )
        create_sql = connection.execute(
            "SELECT sql FROM sqlite_master WHERE type='table' AND name=?", (table,)
        ).fetchone()[0]
        tables[table] = {
            "columns": columns,
            "primary_key": primary_key,
            "foreign_keys": foreign_keys,
            "unique_constraints": [list(value) for value in sorted(unique_sets)],
            "indexes": _logical_indexes(indexes, unique_sets),
            "checks": _check_constraints(create_sql or ""),
        }
    return {"tables": tables}


def release_semantic_schema(connection: sqlite3.Connection) -> dict[str, Any]:
    """Return the narrowly normalized release-compatibility schema.

    ``semantic_schema`` remains stable because its historical hashes are an
    audit and adoption input. This release view additionally normalizes proven
    SQLite storage equivalents while keeping every exception explicit.
    """
    schema = semantic_schema(connection)
    for table, definition in schema["tables"].items():
        for column in definition["columns"]:
            if column["type"] in {"INTEGER", "REAL", "NUMERIC", "BOOLEAN"}:
                quoted_number = re.fullmatch(
                    r"'([-+]?(?:\d+(?:\.\d*)?|\.\d+))'",
                    column["default"] or "",
                )
                if quoted_number:
                    column["default"] = quoted_number.group(1)
            if (
                table == "incoming_purchase_request_items"
                and column["name"] == "correction_draft"
                and column["type"] == "TEXT"
            ):
                column["type"] = "JSON"
            if (
                table == "daily_reports"
                and column["name"] == "snapshot_data"
                and column["default"] is None
            ):
                column["default"] = "'{}'"

        # Duplicate copies of the same B-tree have no additional logical
        # lookup behavior. exact_ddl() continues to expose both by name.
        definition["indexes"] = list({
            (tuple(index["columns"]), index["unique"]): index
            for index in definition["indexes"]
        }.values())
        definition["indexes"].sort(key=lambda item: tuple(item["columns"]))
    return schema


def exact_ddl(connection: sqlite3.Connection) -> list[dict[str, str]]:
    tables = set(_table_names(connection))
    return [
        {"type": row[0], "name": row[1], "table": row[2], "sql": row[3]}
        for row in connection.execute(
            "SELECT type, name, tbl_name, sql FROM sqlite_master "
            "WHERE type IN ('table','index') AND sql IS NOT NULL ORDER BY type, name"
        )
        if row[2] in tables
    ]


def fingerprint(path: Path) -> dict[str, Any]:
    path = path.resolve()
    if not path.is_file():
        raise FileNotFoundError(path)
    with sqlite3.connect(f"file:{path.as_posix()}?mode=ro", uri=True) as connection:
        semantic = semantic_schema(connection)
        exact = exact_ddl(connection)
        revision_row = (
            connection.execute("SELECT version_num FROM alembic_version").fetchone()
            if "alembic_version" in {
                row[0]
                for row in connection.execute(
                    "SELECT name FROM sqlite_master WHERE type='table'"
                )
            }
            else None
        )
    return {
        "path": str(path),
        "alembic_revision": revision_row[0] if revision_row else None,
        "table_count": len(semantic["tables"]),
        "semantic_sha256": _hash(semantic),
        "exact_ddl_sha256": _hash(exact),
        "semantic": semantic,
        "exact_ddl": exact,
    }


def compare(results: list[dict[str, Any]]) -> dict[str, Any]:
    reference = results[0]
    comparisons = []
    for result in results[1:]:
        reference_tables = reference["semantic"]["tables"]
        candidate_tables = result["semantic"]["tables"]
        table_differences = {}
        for table in sorted(set(reference_tables) | set(candidate_tables)):
            if reference_tables.get(table) != candidate_tables.get(table):
                table_differences[table] = {
                    "reference": reference_tables.get(table),
                    "candidate": candidate_tables.get(table),
                }
        comparisons.append(
            {
                "reference": reference["path"],
                "candidate": result["path"],
                "semantic_match": not table_differences,
                "exact_ddl_match": (
                    reference["exact_ddl_sha256"] == result["exact_ddl_sha256"]
                ),
                "different_tables": table_differences,
            }
        )
    return {"databases": results, "comparisons": comparisons}


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("databases", nargs="+", type=Path)
    parser.add_argument("--output", type=Path)
    parser.add_argument("--summary-only", action="store_true")
    args = parser.parse_args()
    results = [fingerprint(path) for path in args.databases]
    report = compare(results) if len(results) > 1 else results[0]
    if args.summary_only:
        for database in results:
            database.pop("semantic", None)
            database.pop("exact_ddl", None)
        if isinstance(report, dict):
            for comparison in report.get("comparisons", []):
                comparison.pop("different_tables", None)
    rendered = json.dumps(report, ensure_ascii=False, indent=2)
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(rendered + "\n", encoding="utf-8")
    print(rendered)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
