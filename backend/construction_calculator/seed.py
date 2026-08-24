"""Versioned, idempotent installation of the bundled authoritative workbook."""

from __future__ import annotations

import hashlib
import json
from pathlib import Path

from .repository import ConstructionRepository
from .models import ConstructionImportRun
from .workbook_import import parse_workbook
from sqlalchemy import select


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


def install_bundled_reference_data(session) -> dict:
    manifest = load_manifest()
    installed = session.scalar(
        select(ConstructionImportRun).where(
            ConstructionImportRun.import_version == manifest["import_version"],
            ConstructionImportRun.status == "completed",
        )
    )
    if installed:
        report = dict(installed.report_json or {})
        report["already_installed"] = True
        return report
    workbook_path = bundled_workbook_path()
    digest = hashlib.sha256(workbook_path.read_bytes()).hexdigest().upper()
    if digest != manifest["sha256"].upper():
        raise RuntimeError(
            "Bundled construction workbook checksum does not match its manifest"
        )
    return import_reference_workbook(
        session,
        workbook_path,
        manifest["import_version"],
    )
