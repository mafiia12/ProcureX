import asyncio
from pathlib import Path

try:
    from .database import db, init_db
    from .excel_io import parse_workbook, import_data
except ImportError:
    from database import db, init_db
    from excel_io import parse_workbook, import_data

ROOT = Path(__file__).parent


async def main():
    init_db()
    content = (ROOT / "workbook.xlsm").read_bytes()
    parsed = parse_workbook(content)
    counts = await import_data(db, parsed)
    print("Imported:", counts)


if __name__ == "__main__":
    asyncio.run(main())
