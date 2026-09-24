"""Authentication dependencies and user lookups shared across routers.

`get_current_user` re-reads the user row from the database on every request
(rather than trusting the JWT payload's role/account_type) so a role change
or deactivation performed by an Admin takes effect immediately, without
waiting for the token to expire.
"""

from __future__ import annotations

from collections.abc import Callable

import jwt as pyjwt
from fastapi import Depends, HTTPException
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import select

try:
    from ..database import SessionLocal
    from .models import ERP_ROLE_LEVELS, User
    from .security import decode_access_token
except ImportError:  # pragma: no cover - direct backend execution
    from database import SessionLocal
    from auth.models import ERP_ROLE_LEVELS, User
    from auth.security import decode_access_token

_bearer_scheme = HTTPBearer(auto_error=False)


def authenticate_user(session, username: str, password: str) -> User | None:
    from .security import verify_password  # local import avoids cycle at module load

    username = (username or "").strip()
    if not username:
        return None
    user = session.scalar(select(User).where(User.username == username))
    if user is None or not user.active:
        return None
    if not verify_password(password, user.password_hash):
        return None
    return user


def get_current_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer_scheme),
) -> User:
    if credentials is None:
        raise HTTPException(401, "تسجيل الدخول مطلوب")
    try:
        payload = decode_access_token(credentials.credentials)
    except pyjwt.PyJWTError:
        raise HTTPException(401, "جلسة الدخول غير صالحة أو منتهية")

    with SessionLocal() as session:
        user = session.get(User, payload.get("sub"))
        if user is None or not user.active:
            raise HTTPException(401, "الحساب غير نشط أو غير موجود")
        session.expunge(user)
        return user


def role_at_least(actual_role: str, required_role: str) -> bool:
    """True if `actual_role` sits at or above `required_role` in the ERP
    role hierarchy (admin > commercial_manager > procurement_responsible >
    procurement_engineer), so a higher role automatically carries every
    permission of the roles beneath it.

    Admin is an absolute override and always passes, matching the pre-
    hierarchy behavior where admin bypassed every role gate outright -
    this also covers a `required_role` that predates the hierarchy (e.g. a
    workflow-stage value like "procurement_officer"/"external_engineer"
    that is not one of the four ERP roles).

    Fails closed otherwise: an `actual_role` or `required_role` that is not
    a recognized ERP_ROLE_LEVELS key never grants access, so a malformed or
    unknown role (including site_engineer/site_portal, which is
    intentionally not in ERP_ROLE_LEVELS) participates in no inheritance.
    """
    if actual_role == "admin":
        return True
    actual_level = ERP_ROLE_LEVELS.get(actual_role)
    required_level = ERP_ROLE_LEVELS.get(required_role)
    if actual_level is None or required_level is None:
        return False
    return actual_level >= required_level


def has_role_or_higher(user: User, required_role: str) -> bool:
    """Like `role_at_least`, scoped to a `User` - also enforces the
    account_type boundary so a site_portal user never inherits ERP access
    no matter what role string it carries."""
    return user.account_type == "erp" and role_at_least(user.role, required_role)


def require_erp_role(*roles: str) -> Callable[[User], User]:
    """FastAPI dependency: current user must be an active ERP account whose
    role is at or above the lowest of `roles` in the ERP hierarchy (see
    `role_at_least`). With no `roles` given, any ERP role is accepted -
    procurement_engineer is the floor of the hierarchy, so this is
    equivalent to requiring procurement_engineer-or-higher.
    """
    required_roles = set(roles) or {"procurement_engineer"}
    unknown = required_roles - set(ERP_ROLE_LEVELS)
    if unknown:
        raise ValueError(f"require_erp_role: unknown role(s) {sorted(unknown)}")
    # Multiple roles aren't used anywhere today, but if ever combined, a
    # higher role already inherits every lower one - so requiring "at least
    # A or at least B" collapses to "at least the lower of A and B".
    threshold_role = min(required_roles, key=lambda role: ERP_ROLE_LEVELS[role])

    def dependency(user: User = Depends(get_current_user)) -> User:
        if user.account_type != "erp":
            raise HTTPException(403, "هذا الإجراء متاح فقط لمستخدمي النظام الداخلي")
        if not role_at_least(user.role, threshold_role):
            raise HTTPException(403, "صلاحياتك لا تسمح بتنفيذ هذا الإجراء")
        return user

    return dependency


def require_site_portal(user: User = Depends(get_current_user)) -> User:
    if user.account_type != "site_portal":
        raise HTTPException(403, "هذا الإجراء متاح فقط لمستخدمي بوابة الطلبات")
    return user
