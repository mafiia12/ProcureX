import importlib.util
import json
import sqlite3
from contextlib import closing
from pathlib import Path

import pytest


MODULE_PATH = Path(__file__).with_name("ProcureXDesktopHost.py")
SPEC = importlib.util.spec_from_file_location("procurex_desktop_host", MODULE_PATH)
host = importlib.util.module_from_spec(SPEC)
assert SPEC.loader is not None
SPEC.loader.exec_module(host)


def create_compatible_database(path: Path, invoice: str = "INV-001") -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with closing(sqlite3.connect(path)) as connection:
        connection.executescript(
            """
            CREATE TABLE purchases (
                id TEXT PRIMARY KEY, purchase_id TEXT, invoice_number TEXT,
                invoice_total REAL
            );
            CREATE TABLE purchase_items (
                id TEXT PRIMARY KEY, purchase_id TEXT, item_id TEXT,
                line_total REAL
            );
            CREATE TABLE payments (
                id TEXT PRIMARY KEY, payment_id TEXT, purchase_id TEXT,
                amount_paid REAL
            );
            CREATE TABLE price_history (
                id TEXT PRIMARY KEY, record_no INTEGER, invoice_number TEXT,
                final_price REAL
            );
            CREATE TABLE suppliers (id TEXT PRIMARY KEY, name TEXT);
            CREATE TABLE items (id TEXT PRIMARY KEY, name TEXT, unit TEXT);
            """
        )
        connection.execute(
            "INSERT INTO purchases VALUES ('1', 'PUR-1', ?, 125.5)", (invoice,)
        )
        connection.execute("INSERT INTO suppliers VALUES ('1', 'Supplier')")
        connection.execute("INSERT INTO items VALUES ('1', 'Item', 'piece')")
        connection.commit()


def prepare_data_root(tmp_path: Path, monkeypatch) -> tuple[Path, Path]:
    root = tmp_path / "ProcureX"
    monkeypatch.setenv("PROCUREX_DATA_ROOT", str(root))
    # Restore tests exercise isolated scratch data. A separately running local
    # ProcureX instance must not make these unit tests depend on workstation state.
    monkeypatch.setattr(host, "port_is_listening", lambda _port: False)
    paths = host.data_paths()
    create_compatible_database(paths["database"])
    attachment = paths["attachments"] / "request.txt"
    attachment.write_text("original attachment", encoding="utf-8")
    return root, attachment


def test_backup_and_restore_database_with_matching_attachments(tmp_path, monkeypatch):
    root, attachment = prepare_data_root(tmp_path, monkeypatch)

    backup = host.backup_database("test")
    database_backup = Path(backup["backup"])
    manifest = Path(backup["manifest"])
    attachment_backup = Path(backup["attachments"])

    assert database_backup.is_file()
    assert attachment_backup.joinpath("request.txt").read_text(encoding="utf-8") == "original attachment"
    assert backup["attachment_count"] == 1
    assert json.loads(manifest.read_text(encoding="utf-8"))["app_version"] == "0.3.0"
    assert (root / "data" / "backups" / "last-successful-backup.json").is_file()

    with closing(sqlite3.connect(root / "data" / "procurement.db")) as connection:
        connection.execute("DELETE FROM purchases")
        connection.commit()
    attachment.write_text("changed attachment", encoding="utf-8")

    restored = host.restore_database(database_backup)
    assert restored["legacy_database_only_backup"] is False
    assert restored["attachment_count"] == 1
    assert attachment.read_text(encoding="utf-8") == "original attachment"
    with closing(sqlite3.connect(root / "data" / "procurement.db")) as connection:
        assert connection.execute("SELECT invoice_number FROM purchases").fetchone()[0] == "INV-001"


def test_restore_preserves_unverified_live_database_when_corrupt(tmp_path, monkeypatch):
    root, attachment = prepare_data_root(tmp_path, monkeypatch)
    backup = host.backup_database("known-good")

    live_database = root / "data" / "procurement.db"
    live_database.write_bytes(b"not a sqlite database")
    attachment.write_text("attachment beside corrupt database", encoding="utf-8")

    restored = host.restore_database(Path(backup["backup"]))
    preserved = Path(restored["safety_backup"])
    assert "unverified" in preserved.name
    assert preserved.read_bytes() == b"not a sqlite database"
    _, preserved_manifest = host.backup_companions(preserved)
    assert json.loads(preserved_manifest.read_text(encoding="utf-8"))["unverified"] is True
    assert host.verify_database(live_database)["integrity"] == "ok"


def test_incompatible_schema_is_rejected(tmp_path):
    database = tmp_path / "incompatible.db"
    with closing(sqlite3.connect(database)) as connection:
        connection.execute("CREATE TABLE purchases (id TEXT PRIMARY KEY)")
        connection.commit()
    with pytest.raises(RuntimeError, match="not compatible"):
        host.verify_database(database)
