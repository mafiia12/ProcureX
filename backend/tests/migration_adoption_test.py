import sqlite3
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from scripts.adopt_existing_sqlite import adopt_database, alembic_head, create_fresh_reference
from scripts.schema_fingerprint import semantic_schema


def _make_unversioned(database):
    create_fresh_reference(database)
    with sqlite3.connect(database) as connection:
        connection.execute("DROP TABLE alembic_version")


def test_adopts_only_after_semantic_match_and_preserves_business_tables(tmp_path):
    database = tmp_path / "compatible.db"
    _make_unversioned(database)
    with sqlite3.connect(database) as connection:
        connection.execute(
            "INSERT INTO suppliers "
            "(id, code, name, specialty, group_name, governorate, city, address, "
            "contact_person, phone, whatsapp, email, payment_terms, lead_time_days, "
            "rating, status, notes, extra_data) "
            "VALUES ('supplier-1', 'SUP-0001', 'Supplier', '', '', '', '', '', '', "
            "'', '', '', '', '', '', '', '', '{}')"
        )

    report = adopt_database(database, tmp_path / "backups")

    assert report["status"] == "adopted"
    # Compared against the live Alembic head rather than a hardcoded revision
    # id, so this assertion doesn't go stale every time a migration is added.
    assert report["recorded_revision"] == alembic_head()
    assert report["before"]["counts"] == report["after"]["counts"]
    assert report["before"]["financial_totals"] == report["after"]["financial_totals"]
    assert report["before"]["row_digests"] == report["after"]["row_digests"]
    assert report["after"]["counts"]["suppliers"] == 1
    assert (tmp_path / "backups" / "compatible.pre-alembic-adoption.db").is_file()


def test_refuses_schema_mismatch_without_creating_version_table(tmp_path):
    database = tmp_path / "mismatch.db"
    _make_unversioned(database)
    with sqlite3.connect(database) as connection:
        connection.execute("ALTER TABLE suppliers ADD COLUMN unexpected TEXT")

    with pytest.raises(RuntimeError, match="Semantic schema mismatch"):
        adopt_database(database, tmp_path / "backups")

    with sqlite3.connect(database) as connection:
        tables = {
            row[0]
            for row in connection.execute(
                "SELECT name FROM sqlite_master WHERE type='table'"
            )
        }
    assert "alembic_version" not in tables


def test_semantic_schema_ignores_non_key_column_declaration_order(tmp_path):
    first = sqlite3.connect(tmp_path / "first.db")
    second = sqlite3.connect(tmp_path / "second.db")
    try:
        first.execute("CREATE TABLE sample (id TEXT PRIMARY KEY, name TEXT, note TEXT)")
        second.execute("CREATE TABLE sample (id TEXT PRIMARY KEY, note TEXT, name TEXT)")
        assert semantic_schema(first) == semantic_schema(second)
    finally:
        first.close()
        second.close()
