"""Explicit administrator command for importing a versioned workbook update."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from construction_calculator.seed import import_reference_workbook
from database import SessionLocal, init_db


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("workbook", type=Path)
    parser.add_argument("--import-version", required=True)
    args = parser.parse_args()
    init_db()
    with SessionLocal() as session:
        report = import_reference_workbook(
            session,
            args.workbook.resolve(),
            args.import_version.strip(),
        )
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
