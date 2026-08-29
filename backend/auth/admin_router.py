"""Admin-only account management: list/create/update users, reset passwords,
and manage Site Portal project assignments.

Every endpoint here requires an authenticated, active ERP user whose role is
admin (`require_erp_role("admin")` from auth/service.py) — non-admin ERP
users and site_portal users both receive 403. This is account/access
management only: no HR fields, no workflow-role enforcement (that is
Sprint 2.3), no project creation/editing (Projects stay owned by the
existing Projects page).

account_type is intentionally never accepted on update: converting a user
between erp and site_portal after creation would leave stale role/project
assumptions behind, so V1 requires deactivating the old account and
creating a new one instead.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Optional
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import select

try:
    from ..database import Project, SessionLocal
    from ..whatsapp.phone import normalize_e164
    from .models import ERP_ROLES, SITE_PORTAL_ROLE, User, UserProjectAccess
    from .security import MIN_PASSWORD_LENGTH, hash_password
    from .service import require_erp_role
except ImportError:  # pragma: no cover - direct backend execution
    from database import Project, SessionLocal
    from whatsapp.phone import normalize_e164
    from auth.models import ERP_ROLES, SITE_PORTAL_ROLE, User, UserProjectAccess
    from auth.security import MIN_PASSWORD_LENGTH, hash_password
    from auth.service import require_erp_role

router = APIRouter(prefix="/api/admin/users", tags=["admin-users"])


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


class ProjectRef(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: str
    code: str
    name: str


class UserAdminView(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: str
    username: str
    display_name: str
    account_type: str
    role: str
    active: bool
    phone: str = ""
    created_at: str
    updated_at: str
    assigned_projects: list[ProjectRef] = Field(default_factory=list)


class UserCreateRequest(BaseModel):
    username: str
    display_name: str = ""
    password: str
    account_type: str
    role: Optional[str] = None
    active: bool = True
    project_ids: list[str] = Field(default_factory=list)
    # WhatsApp intake phone number (site_portal accounts only). Optional —
    # an account with no phone simply can't use the WhatsApp channel.
    phone: str = ""


class UserUpdateRequest(BaseModel):
    display_name: Optional[str] = None
    username: Optional[str] = None
    role: Optional[str] = None
    active: Optional[bool] = None
    phone: Optional[str] = None


class PasswordResetRequest(BaseModel):
    new_password: str


class ProjectAssignRequest(BaseModel):
    project_id: str


def _normalize_and_check_phone(session, raw_phone: str, *, exclude_user_id: str = "") -> str:
    """Empty is always allowed (no WhatsApp number on file). A non-empty
    value must normalize to E.164 and not already belong to another user —
    enforced here rather than a DB constraint, see whatsapp/phone.py."""
    raw_phone = (raw_phone or "").strip()
    if not raw_phone:
        return ""
    normalized = normalize_e164(raw_phone)
    if not normalized:
        raise HTTPException(422, "رقم واتساب غير صالح")
    clash = session.scalar(
        select(User).where(User.phone_e164 == normalized, User.id != exclude_user_id)
    )
    if clash is not None:
        raise HTTPException(409, "رقم الواتساب مستخدم بالفعل لحساب آخر")
    return normalized


def _view(session, user: User) -> UserAdminView:
    projects: list[ProjectRef] = []
    if user.account_type == "site_portal":
        access_rows = session.scalars(
            select(UserProjectAccess).where(UserProjectAccess.user_id == user.id)
        ).all()
        project_ids = [row.project_id for row in access_rows]
        if project_ids:
            project_rows = session.scalars(
                select(Project).where(Project.id.in_(project_ids))
            ).all()
            projects = [ProjectRef.model_validate(p) for p in project_rows]
    return UserAdminView(
        id=user.id, username=user.username, display_name=user.display_name,
        account_type=user.account_type, role=user.role, active=user.active,
        phone=user.phone_e164,
        created_at=user.created_at, updated_at=user.updated_at,
        assigned_projects=projects,
    )


def _views_batch(session, users: list[User]) -> list[UserAdminView]:
    """Same shape as _view, without one project query per row."""
    portal_ids = [u.id for u in users if u.account_type == "site_portal"]
    access_by_user: dict[str, list[str]] = {}
    if portal_ids:
        access_rows = session.scalars(
            select(UserProjectAccess).where(UserProjectAccess.user_id.in_(portal_ids))
        ).all()
        for row in access_rows:
            access_by_user.setdefault(row.user_id, []).append(row.project_id)
    all_project_ids = {pid for ids in access_by_user.values() for pid in ids}
    projects_by_id: dict[str, Project] = {}
    if all_project_ids:
        project_rows = session.scalars(
            select(Project).where(Project.id.in_(all_project_ids))
        ).all()
        projects_by_id = {p.id: p for p in project_rows}

    views = []
    for user in users:
        assigned = [
            ProjectRef.model_validate(projects_by_id[pid])
            for pid in access_by_user.get(user.id, [])
            if pid in projects_by_id
        ]
        views.append(UserAdminView(
            id=user.id, username=user.username, display_name=user.display_name,
            account_type=user.account_type, role=user.role, active=user.active,
            phone=user.phone_e164,
            created_at=user.created_at, updated_at=user.updated_at,
            assigned_projects=assigned,
        ))
    return views


@router.get("", response_model=list[UserAdminView])
def list_users(_admin: User = Depends(require_erp_role("admin"))) -> list[UserAdminView]:
    with SessionLocal() as session:
        users = session.scalars(select(User).order_by(User.created_at)).all()
        return _views_batch(session, users)


@router.post("", response_model=UserAdminView)
def create_user(
    body: UserCreateRequest, _admin: User = Depends(require_erp_role("admin")),
) -> UserAdminView:
    username = body.username.strip()
    if not username:
        raise HTTPException(422, "اسم المستخدم مطلوب")
    if len(body.password) < MIN_PASSWORD_LENGTH:
        raise HTTPException(422, f"كلمة المرور يجب ألا تقل عن {MIN_PASSWORD_LENGTH} أحرف")
    if body.account_type not in ("erp", "site_portal"):
        raise HTTPException(422, "نوع الحساب غير صالح")

    if body.account_type == "erp":
        if body.role not in ERP_ROLES:
            raise HTTPException(422, "دور غير صالح لحساب النظام الداخلي")
        role = body.role
        project_ids: list[str] = []
    else:
        # A portal account's role is always site_engineer. An explicit,
        # different role in the request is rejected rather than silently
        # overridden, so a malformed account_type/role combination never
        # succeeds quietly.
        if body.role and body.role != SITE_PORTAL_ROLE:
            raise HTTPException(422, "دور غير صالح لحساب بوابة الطلبات")
        role = SITE_PORTAL_ROLE
        project_ids = sorted(set(body.project_ids or []))

    with SessionLocal() as session:
        if session.scalar(select(User).where(User.username == username)) is not None:
            raise HTTPException(409, "اسم المستخدم مستخدم بالفعل")
        phone_e164 = _normalize_and_check_phone(session, body.phone)

        projects_by_id: dict[str, Project] = {}
        if project_ids:
            rows = session.scalars(select(Project).where(Project.id.in_(project_ids))).all()
            projects_by_id = {p.id: p for p in rows}
            missing = [pid for pid in project_ids if pid not in projects_by_id]
            if missing:
                raise HTTPException(422, f"مشروع غير موجود: {missing[0]}")

        now = _now_iso()
        user = User(
            id=str(uuid4()), username=username, display_name=body.display_name.strip(),
            password_hash=hash_password(body.password), account_type=body.account_type,
            role=role, active=body.active, phone_e164=phone_e164,
            created_at=now, updated_at=now,
        )
        session.add(user)
        session.flush()

        for project_id in project_ids:
            session.add(UserProjectAccess(
                id=str(uuid4()), user_id=user.id, project_id=project_id, created_at=now,
            ))

        session.commit()
        return _view(session, user)


@router.put("/{user_id}", response_model=UserAdminView)
def update_user(
    user_id: str, body: UserUpdateRequest,
    _admin: User = Depends(require_erp_role("admin")),
) -> UserAdminView:
    with SessionLocal() as session:
        user = session.get(User, user_id)
        if user is None:
            raise HTTPException(404, "المستخدم غير موجود")

        if body.username is not None:
            new_username = body.username.strip()
            if not new_username:
                raise HTTPException(422, "اسم المستخدم مطلوب")
            if new_username != user.username:
                clash = session.scalar(select(User).where(User.username == new_username))
                if clash is not None:
                    raise HTTPException(409, "اسم المستخدم مستخدم بالفعل")
                user.username = new_username

        if body.display_name is not None:
            user.display_name = body.display_name.strip()

        if body.role is not None:
            if user.account_type != "erp":
                raise HTTPException(422, "لا يمكن تغيير الدور لحساب بوابة الطلبات")
            if body.role not in ERP_ROLES:
                raise HTTPException(422, "دور غير صالح")
            user.role = body.role

        if body.active is not None:
            user.active = body.active

        if body.phone is not None:
            user.phone_e164 = _normalize_and_check_phone(session, body.phone, exclude_user_id=user.id)

        user.updated_at = _now_iso()
        session.commit()
        return _view(session, user)


@router.post("/{user_id}/reset-password")
def reset_password(
    user_id: str, body: PasswordResetRequest,
    _admin: User = Depends(require_erp_role("admin")),
) -> dict:
    if len(body.new_password) < MIN_PASSWORD_LENGTH:
        raise HTTPException(422, f"كلمة المرور يجب ألا تقل عن {MIN_PASSWORD_LENGTH} أحرف")
    with SessionLocal() as session:
        user = session.get(User, user_id)
        if user is None:
            raise HTTPException(404, "المستخدم غير موجود")
        user.password_hash = hash_password(body.new_password)
        user.updated_at = _now_iso()
        session.commit()
    # Note: tokens are stateless JWTs (Sprint 2.1) — any token issued before
    # this reset remains valid until it expires (see AUTH_TOKEN_EXPIRES_MINUTES).
    # There is no server-side revocation list in this phase.
    return {"ok": True}


@router.post("/{user_id}/projects", response_model=UserAdminView)
def assign_project(
    user_id: str, body: ProjectAssignRequest,
    _admin: User = Depends(require_erp_role("admin")),
) -> UserAdminView:
    with SessionLocal() as session:
        user = session.get(User, user_id)
        if user is None:
            raise HTTPException(404, "المستخدم غير موجود")
        if user.account_type != "site_portal":
            raise HTTPException(422, "تخصيص المشروعات متاح فقط لمستخدمي بوابة الطلبات")
        project = session.get(Project, body.project_id)
        if project is None:
            raise HTTPException(422, "المشروع غير موجود")
        existing = session.scalar(
            select(UserProjectAccess).where(
                UserProjectAccess.user_id == user.id,
                UserProjectAccess.project_id == project.id,
            )
        )
        if existing is not None:
            raise HTTPException(409, "المشروع مُسند بالفعل لهذا المستخدم")
        session.add(UserProjectAccess(
            id=str(uuid4()), user_id=user.id, project_id=project.id, created_at=_now_iso(),
        ))
        session.commit()
        return _view(session, user)


@router.delete("/{user_id}/projects/{project_id}", response_model=UserAdminView)
def remove_project(
    user_id: str, project_id: str,
    _admin: User = Depends(require_erp_role("admin")),
) -> UserAdminView:
    with SessionLocal() as session:
        user = session.get(User, user_id)
        if user is None:
            raise HTTPException(404, "المستخدم غير موجود")
        access = session.scalar(
            select(UserProjectAccess).where(
                UserProjectAccess.user_id == user_id,
                UserProjectAccess.project_id == project_id,
            )
        )
        if access is not None:
            session.delete(access)
            session.commit()
        return _view(session, user)
