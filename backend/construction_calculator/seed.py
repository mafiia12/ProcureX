"""Versioned, idempotent installation of the bundled authoritative workbook."""

from __future__ import annotations

import json
from pathlib import Path

from .repository import ConstructionRepository
from .workbook_import import parse_workbook


DATA_DIR = Path(__file__).resolve().parent / "data"
MANIFEST_PATH = DATA_DIR / "manifest.json"


def load_manifest() -> dict:
    return json.loads(MANIFEST_PATH.read_text(encoding="utf-8"))


def bundled_workbook_path() -> Path:
    return DATA_DIR / load_manifest()["workbook_filename"]


def import_reference_workbook(
    session, workbook_path: Path, import_version: str
) -> dict:
    bundle = parse_workbook(workbook_path, import_version=import_version)
    return ConstructionRepository(session).import_bundle(bundle)
