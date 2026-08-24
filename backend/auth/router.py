"""Authentication endpoints: login, logout, current user.

Mounted at /api/auth on both the internal ERP surface and the public
surface, so the same credential check serves both account families;
authorization (which role may do what) happens in downstream dependencies,
not by having separate login endpoints per surface.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict

try:
    from ..database import SessionLocal
    from .models import User
    from .security import create_access_token
    from .service import authenticate_user, get_current_user
except ImportError:  # pragma: no cover - direct backend execution
    from database import SessionLocal
    from auth.models import User
    from auth.security import create_access_token
    from auth.service import authenticate_user, get_current_user

router = APIRouter(prefix="/api/auth", tags=["auth"])


class LoginRequest(BaseModel):
    username: str
    password: str


class UserPublic(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    username: str
    display_name: str
    account_type: str
    role: str
    active: bool


class LoginResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserPublic


@router.post("/login", response_model=LoginResponse)
def login(body: LoginRequest) -> LoginResponse:
    with SessionLocal() as session:
        user = authenticate_user(session, body.username, body.password)
        if user is None:
            raise HTTPException(401, "اسم المستخدم أو كلمة المرور غير صحيحة")
        token = create_access_token(
            user_id=user.id, username=user.username,
            account_type=user.account_type, role=user.role,
        )
        return LoginResponse(access_token=token, user=UserPublic.model_validate(user))


@router.post("/logout")
def logout(user: User = Depends(get_current_user)) -> dict:
    # Stateless JWT: there is no server-side session to invalidate. The
    # client is responsible for discarding the token. This endpoint exists
    # for a consistent client contract and so a future revocation list (if
    # ever needed) has a single place to plug into.
    return {"ok": True}


@router.get("/me", response_model=UserPublic)
def me(user: User = Depends(get_current_user)) -> UserPublic:
    return UserPublic.model_validate(user)
