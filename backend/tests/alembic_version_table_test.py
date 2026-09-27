"""Guard PostgreSQL version-table DDL without needing a database server."""

import ast
import io
import sys
from pathlib import Path
from unittest.mock import Mock

import pytest
from alembic.migration import MigrationContext
from sqlalchemy import String, Text

BACKEND_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND_DIR))
import alembic_version_table as version_table  # noqa: E402


def test_current_revision_ids_fit_configured_capacity():
    # Importing revision modules would register optional models on the shared
    # Base.metadata and change the behavior of unrelated runtime-schema tests.
    revisions = []
    for path in (BACKEND_DIR / "alembic" / "versions").glob("*.py"):
        tree = ast.parse(path.read_text(encoding="utf-8"))
        for node in tree.body:
            if isinstance(node, ast.Assign) and any(
                isinstance(target, ast.Name) and target.id == "revision"
                for target in node.targets
            ):
                revisions.append(ast.literal_eval(node.value))
    assert revisions
    maximum = max(map(len, revisions))
    assert maximum <= version_table.VERSION_NUM_CAPACITY


def test_postgres_creates_wide_version_table_before_first_revision():
    output = io.StringIO()
    context = MigrationContext.configure(
        dialect_name="postgresql",
        opts={"as_sql": True, "output_buffer": output},
    )
    assert isinstance(context.impl, version_table.ProcureXPostgresqlImpl)
    # Exercise Alembic's actual table-creation path, not just our hook.
    context._ensure_version_table()
    ddl = output.getvalue()
    assert "version_num VARCHAR(128) NOT NULL" in ddl
    assert "PRIMARY KEY (version_num)" in ddl


@pytest.mark.parametrize("exists,column_type,widen", [
    (False, String(32), False),
    (True, String(32), True),
    (True, String(128), False),
    (True, String(256), False),
    (True, Text(), False),
])
def test_adoption_only_widens_short_existing_columns(monkeypatch, exists, column_type, widen):
    connection = Mock()
    connection.dialect.name = "postgresql"
    context = Mock(bind=connection, version_table="alembic_version", version_table_schema=None)
    inspector = Mock()
    inspector.has_table.return_value = exists
    inspector.get_columns.return_value = [{"name": "version_num", "type": column_type}]
    monkeypatch.setattr(version_table, "inspect", Mock(return_value=inspector))
    operations = Mock()
    monkeypatch.setattr(version_table, "Operations", Mock(return_value=operations))
    version_table.widen_existing_version_table(context)
    if widen:
        operations.alter_column.assert_called_once()
        args, kwargs = operations.alter_column.call_args
        assert args == ("alembic_version", "version_num")
        assert kwargs["type_"].length == version_table.VERSION_NUM_CAPACITY
        assert kwargs["existing_type"] is column_type
        assert kwargs["schema"] is None
    else:
        operations.alter_column.assert_not_called()
