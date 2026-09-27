"""Authentication and access-control persistence models.

Two account families share one table, distinguished by ``account_type``:

- ``erp``: internal ProcureX users, ``role`` is one of the four ERP roles.
- ``site_portal``: Site Engineer portal users, ``role`` is always
  ``site_engineer``. Their project access is scoped through
  ``UserProjectAccess`` (populated starting in Sprint 2.2).

The CHECK constraint is defense-in-depth: the API layer never accepts an
arbitrary role string from a request body (see auth/service.py), but a
direct database write is also constrained to a valid account_type/role pair.
"""

from __future__ import annotations

from sqlalchemy import Boolean, CheckConstraint, ForeignKey, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

try:
    from ..database import Base
except ImportError:  # pragma: no cover - direct backend execution
    from database import Base


ERP_ROLES = (
    "admin",
    "procurement_responsible",
    "procurement_engineer",
    "commercial_manager",
)
SITE_PORTAL_ROLE = "site_engineer"
ACCOUNT_TYPES = ("erp", "site_portal")

# Hierarchical ERP role inheritance: a higher role automatically carries
# every permission of the roles below it (see auth/service.py:role_at_least).
# Deliberately NOT keyed by site_engineer/site_portal - that surface stays
# fully outside this ladder regardless of any role string it presents.
ERP_ROLE_LEVELS = {
    "procurement_engineer": 10,
    "procurement_responsible": 20,
    "commercial_manager": 30,
    "admin": 100,
}


class User(Base):
    __tablename__ = "users"
    __table_args__ = (
        CheckConstraint(
            "account_type IN ('erp', 'site_portal')",
            name="ck_users_account_type",
        ),
        CheckConstraint(
            "(account_type = 'erp' AND role IN "
            "('admin', 'procurement_responsible', 'procurement_engineer', 'commercial_manager')) "
            "OR (account_type = 'site_portal' AND role = 'site_engineer')",
            name="ck_users_role_matches_account_type",
        ),
    )

    id: Mapped[str] = mapped_column(String, primary_key=True)
    username: Mapped[str] = mapped_column(String, unique=True, index=True)
    display_name: Mapped[str] = mapped_column(String, default="")
    password_hash: Mapped[str] = mapped_column(String)
    account_type: Mapped[str] = mapped_column(String, index=True)
    role: Mapped[str] = mapped_column(String, index=True)
    active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    # E.164 (e.g. "+201012345678"). Used to map an inbound WhatsApp sender to
    # a site_portal user (see whatsapp/). Empty for accounts with no WhatsApp
    # number on file. Uniqueness among non-empty values is enforced in
    # auth/admin_router.py, not a DB constraint (see whatsapp/phone.py).
    phone_e164: Mapped[str] = mapped_column(String, default="", server_default="")
    created_at: Mapped[str] = mapped_column(String)
    updated_at: Mapped[str] = mapped_column(String)


class UserProjectAccess(Base):
    """Projects a site_portal user may submit requests against.

    Unused until Sprint 2.2 (admin assignment) and Sprint 2.4 (portal
    enforcement); created now so the schema only changes once for this
    phase.
    """

    __tablename__ = "user_project_access"
    __table_args__ = (
        UniqueConstraint("user_id", "project_id", name="uq_user_project_access"),
    )

    id: Mapped[str] = mapped_column(String, primary_key=True)
    user_id: Mapped[str] = mapped_column(
        String, ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    project_id: Mapped[str] = mapped_column(
        String, ForeignKey("projects.id", ondelete="CASCADE"), index=True
    )
    created_at: Mapped[str] = mapped_column(String)
