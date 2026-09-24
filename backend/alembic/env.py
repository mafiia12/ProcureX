from __future__ import annotations

import os
from logging.config import fileConfig

from alembic import context
from sqlalchemy import engine_from_config, pool
from alembic_version_table import widen_existing_version_table

config = context.config

from database import Base
import incoming_requests  # noqa: F401 - registers incoming-request tables

# Loading models from later revisions before an upgrade causes the dynamic 0001
# baseline to create those tables prematurely.  Autogenerate still needs the
# complete metadata, while an upgrade must let each revision register its own
# models in sequence.
if getattr(config.cmd_opts, "autogenerate", False):
    import price_comparisons  # noqa: F401
    import document_capture.models  # noqa: F401
    import construction_calculator.models  # noqa: F401
    import auth.models  # noqa: F401

if config.config_file_name is not None:
    fileConfig(config.config_file_name)

database_url = os.environ.get("DATABASE_URL", "")
if not database_url:
    raise RuntimeError("DATABASE_URL is required for Alembic migrations")
if database_url.startswith("postgres://"):
    database_url = database_url.replace("postgres://", "postgresql+psycopg://", 1)
elif database_url.startswith("postgresql://"):
    database_url = database_url.replace("postgresql://", "postgresql+psycopg://", 1)
config.set_main_option("sqlalchemy.url", database_url.replace("%", "%%"))

target_metadata = Base.metadata


def run_migrations_offline() -> None:
    context.configure(
        url=database_url,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
        compare_type=True,
    )
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    connectable = engine_from_config(
        config.get_section(config.config_ini_section, {}),
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )
    with connectable.connect() as connection:
        if connection.dialect.name == "sqlite":
            # Reconciliation revisions use transactional table recreation.
            # This is set before Alembic begins its migration transaction and
            # is scoped to this disposable migration connection.
            connection.exec_driver_sql("PRAGMA foreign_keys=OFF")
            connection.commit()
        context.configure(connection=connection, target_metadata=target_metadata, compare_type=True)
        with context.begin_transaction():
            widen_existing_version_table(context.get_context())
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
