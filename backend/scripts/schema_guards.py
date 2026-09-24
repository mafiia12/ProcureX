"""Pure schema-inspection helpers with no model imports.

Deliberately dependency-free (only sqlalchemy itself): migrate_sqlite_to_postgres.py
imports every model module to build a complete Base.metadata, and importing
that in the same process as the pytest suite permanently registers those
model classes on the shared SQLAlchemy Base for the rest of the process -
which is exactly what backend_test.py's construction_calculator tests
assert never happens on a normal startup. Keeping this logic here lets it
be unit-tested against synthetic metadata without ever importing a real
model.
"""

from __future__ import annotations

from sqlalchemy import Integer


def autoincrement_primary_keys(metadata) -> list[tuple[str, str]]:
    """Every single-column primary key SQLAlchemy would treat as a
    PostgreSQL SERIAL/IDENTITY column (an Integer-family type with
    autoincrement left at True/"auto").
    """
    found = []
    for table in metadata.sorted_tables:
        pk_columns = list(table.primary_key.columns)
        if len(pk_columns) != 1:
            continue
        column = pk_columns[0]
        if isinstance(column.type, Integer) and column.autoincrement in (True, "auto"):
            found.append((table.name, column.name))
    return found
