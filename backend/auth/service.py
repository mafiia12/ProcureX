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
    from .models import ERP_ROLES, User
    from .security import decode_access_token
except ImportError:  # pragma: no cover - direct backend execution
    from database import SessionLocal
    from auth.models import ERP_ROLES, User
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


def require_erp_role(*roles: str) -> Callable[[User], User]:
    """FastAPI dependency: current user must be an active ERP account.

    With no `roles` given, any ERP role is accepted. Admin always passes,
    regardless of `roles` (admin override, per the phase brief).
    """
    allowed = set(roles) or set(ERP_ROLES)

    def dependency(user: User = Depends(get_current_user)) -> User:
        if user.account_type != "erp":
            raise HTTPException(403, "هذا الإجراء متاح فقط لمستخدمي النظام الداخلي")
        if user.role == "admin":
            return user
        if user.role not in allowed:
            raise HTTPException(403, "صلاحياتك لا تسمح بتنفيذ هذا الإجراء")
        return user

    return dependency


def require_site_portal(user: User = Depends(get_current_user)) -> User:
    if user.account_type != "site_portal":
        raise HTTPException(403, "هذا الإجراء متاح فقط لمستخدمي بوابة الطلبات")
    return user
