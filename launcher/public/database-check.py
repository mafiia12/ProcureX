"""Read-only preflight: refuse missing/uninitialized SQLite databases."""
import sqlite3
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'backend'))
from database import DATABASE_URL, IS_SQLITE

if IS_SQLITE:
    database = Path(DATABASE_URL.removeprefix('sqlite:///')).resolve()
    with sqlite3.connect(database.as_uri() + '?mode=ro', uri=True) as connection:
        tables = {row[0] for row in connection.execute("SELECT name FROM sqlite_master WHERE type='table'")}
        if not {'users', 'purchases', 'suppliers'}.issubset(tables):
            raise SystemExit('Existing ProcureX database is not initialized. No changes were made.')
print('Existing database preflight passed; initialization will be skipped.')
