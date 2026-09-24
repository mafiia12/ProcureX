"""Authentication endpoints: login, logout, current user.

Mounted at /api/auth on both the internal ERP surface and the public
surface, so the same credential check serves both account families;
authorization (which role may do what) happens in downstream dependencies,
not by having separate login endpoints per surface.
"""

from __future__ import annotations

import os

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, ConfigDict

try:
    from ..database import SessionLocal
    from ..incoming_requests import _client_ip, _hash_private
    from ..rate_limit import RateLimiter
    from .models import User
    from .security import create_access_token
    from .service import authenticate_user, get_current_user
except ImportError:  # pragma: no cover - direct backend execution
    from database import SessionLocal
    from incoming_requests import _client_ip, _hash_private
    from rate_limit import RateLimiter
    from auth.models import User
    from auth.security import create_access_token
    from auth.service import authenticate_user, get_current_user

router = APIRouter(prefix="/api/auth", tags=["auth"])

AUTH_LOGIN_RATE_LIMIT = int(os.getenv("AUTH_LOGIN_RATE_LIMIT", "10"))
AUTH_LOGIN_RATE_WINDOW_SECONDS = int(os.getenv("AUTH_LOGIN_RATE_WINDOW_SECONDS", "900"))
LOGIN_THROTTLE_MESSAGE = "تم تجاوز الحد المسموح لمحاولات الدخول. يرجى المحاولة لاحقاً"

# Two independent limiters, shared across workers via the database (see rate_limit.py).
# Username-keyed always runs. IP-keyed only runs when TRUST_PROXY_HEADERS is
# exactly "true" - see _ip_throttle_is_trustworthy for why.
_ip_limiter = RateLimiter("login_ip", AUTH_LOGIN_RATE_LIMIT, AUTH_LOGIN_RATE_WINDOW_SECONDS)
_username_limiter = RateLimiter("login_username", AUTH_LOGIN_RATE_LIMIT, AUTH_LOGIN_RATE_WINDOW_SECONDS)


def _ip_throttle_is_trustworthy() -> bool:
    """The IP-keyed limiter assumes TRUST_PROXY_HEADERS accurately reflects
    the deployment's proxy topology - i.e. that _client_ip(request) (see
    incoming_requests.py) returns a real, distinct value per visitor rather
    than one shared proxy address.

    When TRUST_PROXY_HEADERS is not exactly "true", _client_ip falls back to
    request.client.host. Behind a reverse proxy that is Render's edge or
    similar, that can be the SAME address (the proxy's) for every request,
    which would collapse the IP-keyed limiter into one shared bucket - N
    failed logins from anyone would then lock out every user. So when the
    operator has not attested that client-IP resolution is trustworthy, this
    limiter disables itself entirely rather than degrade into that global
    bucket. The username-keyed limiter is unaffected and always runs.

    Note this is independent of uvicorn's own --proxy-headers flag (used in
    render.yaml's startCommand): uvicorn's ProxyHeadersMiddleware only
    rewrites request.client itself, and only when the immediate TCP peer is
    in its own trusted_hosts list (default 127.0.0.1, unless
    --forwarded-allow-ips is also passed - it is not, here). Whether that
    condition holds on Render's network has not been verified. Where it does
    hold, uvicorn's rewrite already happens before this code runs and wins
    (request.client.host is already the real client); where it does not,
    this application's own TRUST_PROXY_HEADERS flag is the only thing
    standing between "real client IP" and "the proxy's IP for everyone", so
    it must not be assumed true by default.
    """
    return os.getenv("TRUST_PROXY_HEADERS", "").strip().lower() == "true"


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
def login(body: LoginRequest, request: Request) -> LoginResponse:
    username_key = body.username.strip().lower()
    # Whichever of these trips first raises 429 first - both use the exact
    # same message/headers, so the response never reveals which counter
    # tripped or whether the username exists.
    if _ip_throttle_is_trustworthy():
        _ip_limiter.hit(_hash_private(_client_ip(request)), LOGIN_THROTTLE_MESSAGE)
    _username_limiter.hit(username_key, LOGIN_THROTTLE_MESSAGE)

    with SessionLocal() as session:
        user = authenticate_user(session, body.username, body.password)
        if user is None:
            raise HTTPException(401, "اسم المستخدم أو كلمة المرور غير صحيحة")
        _username_limiter.reset(username_key)
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
