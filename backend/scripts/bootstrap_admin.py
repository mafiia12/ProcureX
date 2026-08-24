"""One-time CLI to create the first ProcureX Admin account.

Usage (run from the backend/ directory, with the same environment/.env the
application uses):

    python scripts/bootstrap_admin.py

The password is never hardcoded and never passed on the command line. Set
BOOTSTRAP_ADMIN_USERNAME / BOOTSTRAP_ADMIN_DISPLAY_NAME / BOOTSTRAP_ADMIN_PASSWORD
as environment variables for a scripted/CI bootstrap, or omit them and the
script will prompt interactively (password input is not echoed and is not
written to shell history).

Refuses to run if an ERP admin account already exists — use the Admin user
management screen (Sprint 2.2) to create additional accounts after the
first one exists.
"""

from __future__ import annotations

import getpass
import os
import sys
import uuid
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from sqlalchemy import select

from auth.models import User
from auth.security import MIN_PASSWORD_LENGTH, hash_password
from database import SessionLocal, init_db


def _read_username() -> str:
    username = os.getenv("BOOTSTRAP_ADMIN_USERNAME", "").strip()
    if username:
        return username
    username = input("Admin username: ").strip()
    if not username:
        print("Username is required.", file=sys.stderr)
        raise SystemExit(1)
    return username


def _read_password() -> str:
    password = os.getenv("BOOTSTRAP_ADMIN_PASSWORD", "")
    if not password:
        password = getpass.getpass("Admin password: ")
        confirm = getpass.getpass("Confirm password: ")
        if password != confirm:
            print("Passwords do not match.", file=sys.stderr)
            raise SystemExit(1)
    if len(password) < MIN_PASSWORD_LENGTH:
        print(f"Password must be at least {MIN_PASSWORD_LENGTH} characters.", file=sys.stderr)
        raise SystemExit(1)
    return password


def main() -> None:
    init_db()
    username = _read_username()
    display_name = os.getenv("BOOTSTRAP_ADMIN_DISPLAY_NAME", "").strip() or username
    password = _read_password()

    with SessionLocal() as session:
        existing_admin = session.scalar(
            select(User).where(User.account_type == "erp", User.role == "admin")
        )
        if existing_admin is not None:
            print(f"An admin account already exists: {existing_admin.username}")
            print("Refusing to create a second bootstrap admin. Use Admin user management instead.")
            raise SystemExit(1)

        if session.scalar(select(User).where(User.username == username)) is not None:
            print(f"Username already taken: {username}", file=sys.stderr)
            raise SystemExit(1)

        now = datetime.now(timezone.utc).isoformat()
        session.add(User(
            id=str(uuid.uuid4()),
            username=username,
            display_name=display_name,
            password_hash=hash_password(password),
            account_type="erp",
            role="admin",
            active=True,
            created_at=now,
            updated_at=now,
        ))
        session.commit()

    print(f"Admin account created: {username}")


if __name__ == "__main__":
    main()
