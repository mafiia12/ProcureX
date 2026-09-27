"""ProcureX PostgreSQL Alembic bookkeeping (no business-table changes)."""

from alembic.ddl.postgresql import PostgresqlImpl
from alembic.operations import Operations
from sqlalchemy import String, inspect

VERSION_NUM_CAPACITY = 128


class ProcureXPostgresqlImpl(PostgresqlImpl):
    __dialect__ = "postgresql"

    def version_table_impl(self, **kwargs):
        table = super().version_table_impl(**kwargs)
        table.c.version_num.type = String(VERSION_NUM_CAPACITY)
        return table


def widen_existing_version_table(migration_context):
    """Adopt older version tables in the enclosing migration transaction.

    Fresh databases use version_table_impl above. Existing VARCHAR columns
    are only widened, never shortened; version values and PKs are preserved.
    """
    connection = migration_context.bind
    if connection.dialect.name != "postgresql":
        return
    table = migration_context.version_table
    schema = migration_context.version_table_schema
    inspector = inspect(connection)
    if not inspector.has_table(table, schema=schema):
        return
    column = next(c for c in inspector.get_columns(table, schema=schema)
                  if c["name"] == "version_num")
    column_type = column["type"]
    if isinstance(column_type, String) and column_type.length is not None:
        if column_type.length < VERSION_NUM_CAPACITY:
            Operations(migration_context).alter_column(
                table, "version_num", schema=schema,
                existing_type=column_type, type_=String(VERSION_NUM_CAPACITY),
            )
