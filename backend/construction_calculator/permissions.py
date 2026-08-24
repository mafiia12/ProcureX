"""Server-side capability gates used until ProcureX gains user accounts."""

from __future__ import annotations

import hmac
import os
from collections.abc import Callable

from fastapi import Header, HTTPException


DEFAULT_PERMISSIONS = {
    "view_construction_rates",
    "use_calculator",
    "save_calculations",
    "create_purchase_requests",
    "view_source_audit",
}
ADMIN_PERMISSIONS = {
    "manage_packaging",
    "manage_market_aliases",
    "import_workbook_updates",
    "edit_approved_reference_rates",
}


def enabled_permissions() -> set[str]:
    configured = os.getenv("CONSTRUCTION_ENABLED_PERMISSIONS", "").strip()
    if not configured:
        return set(DEFAULT_PERMISSIONS)
    return {part.strip() for part in configured.split(",") if part.strip()}


def require_permission(permission: str, administrator: bool = False) -> Callable:
    def dependency(
        x_construction_admin_token: str | None = Header(
            default=None, alias="X-Construction-Admin-Token"
        ),
    ) -> None:
        if permission not in enabled_permissions():
            raise HTTPException(
                403, f"Construction permission is disabled: {permission}"
            )
        if not administrator:
            return
        configured = os.getenv("CONSTRUCTION_ADMIN_TOKEN", "").strip()
        if not configured:
            raise HTTPException(503, "Construction administration is not configured")
        if not x_construction_admin_token or not hmac.compare_digest(
            x_construction_admin_token, configured
        ):
            raise HTTPException(401, "Construction administrator token is required")

    return dependency
