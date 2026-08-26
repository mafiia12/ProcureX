"""Transactional, persistent business-code allocation for master data."""

from __future__ import annotations

import re

from sqlalchemy import insert, select, update
from sqlalchemy.exc import IntegrityError

try:
    from .database import BusinessCodeSequence, IS_SQLITE, MODELS, engine
except ImportError:
    from database import BusinessCodeSequence, IS_SQLITE, MODELS, engine


BUSINESS_CODE_CONFIG = {
    "suppliers": {"prefix": "SUP-", "width": 6, "legacy_prefixes": ("SUP-",)},
    "customers": {"prefix": "CUS-", "width": 6, "legacy_prefixes": ("CUS-",)},
    "projects": {"prefix": "PRJ-", "width": 6, "legacy_prefixes": ("PRJ-", "prj-")},
    "items": {"prefix": "ITM-", "width": 6, "legacy_prefixes": ("ITM-", "ITM")},
}


def _numeric_suffix(code: str, prefixes: tuple[str, ...]) -> int | None:
    for prefix in prefixes:
        match = re.fullmatch(re.escape(prefix) + r"(\d+)", code)
        if match:
            return int(match.group(1))
    return None


def _highest_numeric_suffix(
    codes: list[str], prefixes: tuple[str, ...]
) -> int:
    """Return the highest numeric suffix across every recognized code width."""
    return max(
        (
            number
            for code in codes
            if (number := _numeric_suffix(str(code or ""), prefixes)) is not None
        ),
        default=0,
    )


def reserve_code(
    entity: str,
    prefix: str,
    width: int,
    legacy_prefixes: tuple[str, ...],
    model,
    code_column,
) -> str:
    """Reserve a durable code for any model using the shared sequence table."""
    for attempt in range(3):
        with engine.connect() as connection:
            if IS_SQLITE:
                connection.exec_driver_sql("BEGIN IMMEDIATE")
            else:
                connection.begin()
            try:
                statement = select(BusinessCodeSequence.next_value).where(
                    BusinessCodeSequence.entity == entity
                )
                if not IS_SQLITE:
                    statement = statement.with_for_update()
                stored_next = connection.scalar(statement)
                existing_codes = connection.scalars(select(code_column)).all()
                highest_existing = _highest_numeric_suffix(
                    existing_codes, legacy_prefixes
                )
                value = max(stored_next or 1, highest_existing + 1)
                if stored_next is None:
                    connection.execute(insert(BusinessCodeSequence).values(
                        entity=entity, next_value=value + 1,
                    ))
                else:
                    connection.execute(
                        update(BusinessCodeSequence)
                        .where(BusinessCodeSequence.entity == entity)
                        .values(next_value=value + 1)
                    )
                connection.commit()
                return f"{prefix}{value:0{width}d}"
            except IntegrityError:
                connection.rollback()
                if attempt == 2:
                    raise
            except Exception:
                connection.rollback()
                raise

    raise RuntimeError(f"Could not reserve a business code for {entity}")


def next_business_code(entity: str) -> str:
    """Reserve and return the next master-data code."""
    config = BUSINESS_CODE_CONFIG[entity]
    model = MODELS[entity]
    return reserve_code(
        entity, config["prefix"], config["width"],
        config["legacy_prefixes"], model, model.code,
    )
