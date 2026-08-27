import os
import uuid
import logging
import hashlib
import json
import math
import re
import shutil
import sqlite3
import unicodedata
from contextlib import closing
from decimal import Decimal, ROUND_HALF_UP
from pathlib import Path
from datetime import datetime, timedelta, timezone
from typing import List, Literal, Optional

from fastapi import Depends, FastAPI, APIRouter, HTTPException, UploadFile, File, Request
from fastapi.responses import JSONResponse, Response
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from starlette.middleware.httpsredirect import HTTPSRedirectMiddleware
from starlette.middleware.trustedhost import TrustedHostMiddleware
from pydantic import BaseModel, Field
from sqlalchemy import case, func, select

try:
    from .auth.admin_router import router as admin_users_router
    from .auth.router import router as auth_router
    from .auth.models import User
    from .auth.service import require_erp_role
    from .business_codes import BUSINESS_CODE_CONFIG, next_business_code, reserve_code
    from .database import (
        DATABASE_URL, IS_SQLITE, Item, Payment, Project, Purchase, PurchaseOrder, PurchaseOrderItem,
        PurchaseOrderPayment, PurchaseOrderReceipt, PurchaseOrderReceiptLine, SessionLocal, db, init_db,
    )
    from .incoming_requests import (
        IncomingPurchaseRequest, IncomingPurchaseRequestItem, internal_router, public_router,
    )
    from .document_capture.jobs import start_document_worker, stop_document_worker
    from .document_capture.router import internal_document_router, public_document_router
    from .price_comparisons import (
        PriceComparison, PriceComparisonSupplierOffer, router as price_comparison_router,
    )
    from .commercial_totals import calculate_supplier_total
    from .procurement_workflow import (
        ApprovalPayment, EngineerApproval, EngineerApprovalLine,
        EngineerApprovalSupplierOffer, _audit,
        APPROVAL_STAGE_COMPARISON_TECHNICAL, APPROVAL_STAGE_EXPENDITURE_APPROVAL,
        APPROVAL_STAGE_FUNDS_AVAILABILITY, APPROVAL_STAGE_PO_READY,
        advance_request_milestone, calculate_procurement_kpis,
        request_pipeline_summary, sync_request_completion,
        internal_workflow_router, public_approval_router,
    )
    from .rfq import (
        RequestForQuotation, RFQItem, RFQSupplier, SupplierQuotation,
        SupplierQuotationLine, router as rfq_router,
    )
    from .site_portal import router as portal_router
    from .daily_report import router as daily_report_router
    from .excel_io import (parse_workbook, import_data, build_export_workbook,
                           next_code, next_seq_id, next_record_no,
                           recompute_payment_status)
except ImportError:
    from auth.admin_router import router as admin_users_router
    from auth.router import router as auth_router
    from auth.models import User
    from auth.service import require_erp_role
    from business_codes import BUSINESS_CODE_CONFIG, next_business_code, reserve_code
    from database import (
        DATABASE_URL, IS_SQLITE, Item, Payment, Project, Purchase, PurchaseOrder, PurchaseOrderItem,
        PurchaseOrderPayment, PurchaseOrderReceipt, PurchaseOrderReceiptLine, SessionLocal, db, init_db,
    )
    from incoming_requests import (
        IncomingPurchaseRequest, IncomingPurchaseRequestItem, internal_router, public_router,
    )
    from document_capture.jobs import start_document_worker, stop_document_worker
    from document_capture.router import internal_document_router, public_document_router
    from price_comparisons import (
        PriceComparison, PriceComparisonSupplierOffer, router as price_comparison_router,
    )
    from commercial_totals import calculate_supplier_total
    from procurement_workflow import (
        ApprovalPayment, EngineerApproval, EngineerApprovalLine,
        EngineerApprovalSupplierOffer, _audit,
        APPROVAL_STAGE_COMPARISON_TECHNICAL, APPROVAL_STAGE_EXPENDITURE_APPROVAL,
        APPROVAL_STAGE_FUNDS_AVAILABILITY, APPROVAL_STAGE_PO_READY,
        advance_request_milestone, calculate_procurement_kpis,
        request_pipeline_summary, sync_request_completion,
        internal_workflow_router, public_approval_router,
    )
    from rfq import (
        RequestForQuotation, RFQItem, RFQSupplier, SupplierQuotation,
        SupplierQuotationLine, router as rfq_router,
    )
    from site_portal import router as portal_router
    from daily_report import router as daily_report_router
    from excel_io import (parse_workbook, import_data, build_export_workbook,
                          next_code, next_seq_id, next_record_no,
                          recompute_payment_status)

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

api = APIRouter(prefix="/api")

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)
APP_VERSION = "0.3.0"


def now_iso():
    return datetime.now(timezone.utc).isoformat()


def clean(doc):
    doc.pop("_id", None)
    return doc


MONEY = Decimal("0.01")
PERCENT = Decimal("100")
_INVOICE_DIGITS = str.maketrans("٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹", "01234567890123456789")
_INVOICE_DASHES = str.maketrans({"‐": "-", "‑": "-", "‒": "-", "–": "-", "—": "-", "−": "-"})


def money(value) -> Decimal:
    return Decimal(str(value)).quantize(MONEY, rounding=ROUND_HALF_UP)


def normalize_invoice_number(value: str) -> str:
    normalized = unicodedata.normalize("NFKC", value or "")
    normalized = normalized.translate(_INVOICE_DIGITS).translate(_INVOICE_DASHES)
    normalized = re.sub(r"\s+", " ", normalized).strip().casefold()
    return re.sub(r"\s*([\-/])\s*", r"\1", normalized)


def require_finite(value: float, message: str) -> Decimal:
    if not math.isfinite(value):
        raise HTTPException(422, message)
    return Decimal(str(value))


def _runtime_paths() -> dict[str, Path]:
    configured_root = os.getenv("PROCUREX_DATA_ROOT", "").strip()
    if configured_root:
        root = Path(os.path.expandvars(configured_root)).resolve()
        return {
            "data": root / "data",
            "database": root / "data" / "procurement.db",
            "attachments": root / "data" / "attachments" / "incoming_requests",
            "backups": root / "data" / "backups",
            "logs": root / "logs",
        }
    database = Path(DATABASE_URL.removeprefix("sqlite:///")).resolve() if IS_SQLITE else ROOT_DIR
    attachments = Path(
        os.path.expandvars(
            os.getenv(
                "INCOMING_REQUEST_UPLOAD_DIR",
                str(ROOT_DIR / "storage" / "incoming_requests"),
            )
        )
    ).resolve()
    return {
        "data": database.parent,
        "database": database,
        "attachments": attachments,
        "backups": Path(
            os.path.expandvars(os.getenv("PROCUREX_BACKUP_DIR", str(ROOT_DIR / "backups")))
        ).resolve(),
        "logs": Path(
            os.path.expandvars(os.getenv("PROCUREX_LOG_DIR", str(ROOT_DIR.parent / "logs")))
        ).resolve(),
    }


def _file_sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _database_health(path: Path, *, include_counts: bool = False) -> dict[str, object]:
    if not IS_SQLITE or not path.is_file():
        return {"status": "unavailable" if IS_SQLITE else "connected"}
    with closing(sqlite3.connect(f"file:{path.as_posix()}?mode=ro", uri=True)) as connection:
        integrity = connection.execute("PRAGMA quick_check").fetchone()[0]
        foreign_key_violations = len(
            connection.execute("PRAGMA foreign_key_check").fetchall()
        )
        tables = [
            row[0]
            for row in connection.execute(
                "SELECT name FROM sqlite_master "
                "WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
            )
        ]
        table_counts = {
            table: connection.execute(
                f'SELECT COUNT(*) FROM "{table}"'
            ).fetchone()[0]
            for table in tables
        }
    result = {
        "status": "healthy" if integrity == "ok" and not foreign_key_violations else "attention_required",
        "integrity": integrity,
        "foreign_key_violations": foreign_key_violations,
    }
    if include_counts:
        result["table_counts"] = table_counts
    return result


def _create_verified_runtime_backup() -> dict[str, object]:
    if not IS_SQLITE:
        raise HTTPException(409, "النسخ المحلي من الإعدادات متاح لنسخة سطح المكتب فقط")
    paths = _runtime_paths()
    source = paths["database"]
    if not source.is_file():
        raise HTTPException(409, "لا توجد قاعدة بيانات لنسخها حتى الآن")
    source_health = _database_health(source, include_counts=True)
    if source_health.get("status") != "healthy":
        raise HTTPException(409, "تعذر إنشاء نسخة لأن قاعدة البيانات تحتاج إلى فحص")

    paths["backups"].mkdir(parents=True, exist_ok=True)
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    destination = paths["backups"] / f"procurement.settings-{stamp}.db"
    attachments_destination = paths["backups"] / f"procurement.settings-{stamp}.attachments"
    manifest_path = paths["backups"] / f"procurement.settings-{stamp}.manifest.json"
    sequence = 1
    while destination.exists():
        destination = paths["backups"] / f"procurement.settings-{stamp}-{sequence}.db"
        attachments_destination = paths["backups"] / f"procurement.settings-{stamp}-{sequence}.attachments"
        manifest_path = paths["backups"] / f"procurement.settings-{stamp}-{sequence}.manifest.json"
        sequence += 1

    try:
        with closing(sqlite3.connect(source)) as source_connection:
            with closing(sqlite3.connect(destination)) as backup_connection:
                source_connection.backup(backup_connection)
        backup_health = _database_health(destination, include_counts=True)
        if backup_health.get("status") != "healthy":
            raise RuntimeError("backup verification failed")
        if backup_health.get("table_counts") != source_health.get("table_counts"):
            raise RuntimeError("backup row-count verification failed")
        if paths["attachments"].is_dir():
            shutil.copytree(paths["attachments"], attachments_destination)
        else:
            attachments_destination.mkdir(parents=True)
        attachments = [
            {
                "path": file.relative_to(attachments_destination).as_posix(),
                "size_bytes": file.stat().st_size,
                "sha256": _file_sha256(file),
            }
            for file in sorted(attachments_destination.rglob("*"))
            if file.is_file()
        ]
        manifest = {
            "format_version": 1,
            "app_version": APP_VERSION,
            "created_utc": datetime.now(timezone.utc).isoformat(),
            "database_file": destination.name,
            "database_sha256": _file_sha256(destination),
            "attachments_directory": attachments_destination.name,
            "attachments": attachments,
        }
        manifest_path.write_text(
            json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8"
        )
        (paths["backups"] / "last-successful-backup.json").write_text(
            json.dumps(
                {
                    "created_utc": manifest["created_utc"],
                    "database_file": destination.name,
                    "manifest_file": manifest_path.name,
                    "attachment_count": len(attachments),
                },
                ensure_ascii=False,
                indent=2,
            ),
            encoding="utf-8",
        )
    except Exception:
        destination.unlink(missing_ok=True)
        manifest_path.unlink(missing_ok=True)
        shutil.rmtree(attachments_destination, ignore_errors=True)
        raise
    return {
        "status": "ok",
        "created_utc": manifest["created_utc"],
        "database_file": destination.name,
        "attachment_count": len(attachments),
    }


# ---------------- Generic entity config ----------------
ENTITIES = BUSINESS_CODE_CONFIG


class EntityIn(BaseModel):
    model_config = {"extra": "allow"}
    name: str
    code: Optional[str] = None


class ItemIn(BaseModel):
    model_config = {"extra": "allow"}
    product_name: Optional[str] = None
    brand: Optional[str] = ""
    main_category: Optional[str] = ""
    subcategory: Optional[str] = ""
    specifications: Optional[str] = ""
    unit: Optional[str] = ""
    preferred_supplier: Optional[str] = ""
    notes: Optional[str] = ""
    name: Optional[str] = None
    category: Optional[str] = None
    specs: Optional[str] = None
    code: Optional[str] = None


async def entity_list(coll_name):
    return [clean(d) for d in await db[coll_name].find({}).sort("code", 1).to_list(10000)]


@api.get("/suppliers")
async def list_suppliers(include_procurement: bool = False, current_user: User = Depends(require_erp_role())):
    suppliers = await entity_list("suppliers")
    if not include_procurement:
        return suppliers
    with SessionLocal() as session:
        direct_rows = session.execute(
            select(
                Purchase.supplier_id,
                func.count(Purchase.id),
                func.coalesce(func.sum(Purchase.invoice_total), 0),
                func.max(Purchase.purchase_date),
            )
            .where(Purchase.supplier_id != "")
            .group_by(Purchase.supplier_id)
        ).all()
        formal_rows = session.execute(
            select(
                PurchaseOrder.supplier_id,
                func.sum(case((PurchaseOrder.status != "cancelled", 1), else_=0)),
                func.coalesce(func.sum(case(
                    (PurchaseOrder.status != "cancelled", PurchaseOrder.final_total),
                    else_=0.0,
                )), 0),
                func.sum(case((PurchaseOrder.status.in_({"in_delivery", "partial_received", "delivery_problem"}), 1), else_=0)),
                func.coalesce(func.sum(case(
                    (PurchaseOrder.status.in_({"in_delivery", "partial_received", "delivery_problem"}), PurchaseOrder.final_total),
                    else_=0.0,
                )), 0),
                func.sum(case((PurchaseOrder.status == "completed", 1), else_=0)),
                func.coalesce(func.sum(case(
                    (PurchaseOrder.status == "completed", PurchaseOrder.final_total),
                    else_=0.0,
                )), 0),
                func.max(case(
                    (PurchaseOrder.status != "cancelled", PurchaseOrder.po_date),
                    else_="",
                )),
            )
            .where(PurchaseOrder.supplier_id != "")
            .group_by(PurchaseOrder.supplier_id)
        ).all()

    direct_by_supplier = {
        row[0]: {
            "direct_purchase_count": int(row[1] or 0),
            "direct_purchase_total": round(float(row[2] or 0), 2),
            "last_direct_purchase_date": row[3] or "",
        }
        for row in direct_rows
    }
    formal_by_supplier = {
        row[0]: {
            "formal_po_count": int(row[1] or 0),
            "formal_po_total": round(float(row[2] or 0), 2),
            "formal_under_supply_count": int(row[3] or 0),
            "formal_under_supply_value": round(float(row[4] or 0), 2),
            "formal_completed_po_count": int(row[5] or 0),
            "formal_completed_po_value": round(float(row[6] or 0), 2),
            "last_formal_po_date": row[7] or "",
        }
        for row in formal_rows
    }
    direct_defaults = {
        "direct_purchase_count": 0, "direct_purchase_total": 0.0,
        "last_direct_purchase_date": "",
    }
    formal_defaults = {
        "formal_po_count": 0, "formal_po_total": 0.0,
        "formal_under_supply_count": 0, "formal_under_supply_value": 0.0,
        "formal_completed_po_count": 0, "formal_completed_po_value": 0.0,
        "last_formal_po_date": "",
    }
    for supplier in suppliers:
        direct = direct_by_supplier.get(supplier["id"], direct_defaults)
        formal = formal_by_supplier.get(supplier["id"], formal_defaults)
        supplier.update(direct)
        supplier.update(formal)
        supplier["last_procurement_date"] = max(
            direct["last_direct_purchase_date"], formal["last_formal_po_date"],
        )
    return suppliers


@api.get("/customers")
async def list_customers(current_user: User = Depends(require_erp_role())):
    return await entity_list("customers")


@api.get("/projects")
async def list_projects(include_procurement: bool = False, current_user: User = Depends(require_erp_role())):
    projects = await entity_list("projects")

    purchases = await db.purchases.find(
        {},
        {"_id": 0},
    ).to_list(100000)

    for project in projects:
        project_purchases = [
            purchase
            for purchase in purchases
            if purchase.get("project_id") == project.get("id")
        ]

        project["purchase_count"] = len(project_purchases)

        project["total_purchases"] = round(
            sum(
                purchase.get("invoice_total", 0)
                for purchase in project_purchases
            ),
            2,
        )

        if project_purchases:
            latest = max(
                project_purchases,
                key=lambda purchase: purchase.get("purchase_date", ""),
            )
            project["last_purchase_date"] = latest.get(
                "purchase_date",
                "",
            )
        else:
            project["last_purchase_date"] = ""

    if not include_procurement:
        return projects

    orders = [clean(row) for row in await db.purchase_orders.find({}, {"_id": 0}).to_list(100000)]
    active_orders = [row for row in orders if row.get("status") != "cancelled"]
    order_ids = [row["id"] for row in active_orders]
    paid_by_order: dict[str, Decimal] = {}
    active_requests_by_project: dict[str, int] = {}
    with SessionLocal() as session:
        if order_ids:
            for payment in session.scalars(
                select(PurchaseOrderPayment).where(
                    PurchaseOrderPayment.purchase_order_id.in_(order_ids),
                    PurchaseOrderPayment.status == "recorded",
                )
            ).all():
                paid_by_order[payment.purchase_order_id] = (
                    paid_by_order.get(payment.purchase_order_id, Decimal("0"))
                    + Decimal(str(payment.amount))
                )
        for request in session.scalars(select(IncomingPurchaseRequest)).all():
            if request.project_id and request.status not in {"rejected", "cancelled", "completed"}:
                active_requests_by_project[request.project_id] = (
                    active_requests_by_project.get(request.project_id, 0) + 1
                )

    orders_by_project: dict[str, list[dict]] = {}
    for order in active_orders:
        if order.get("project_id"):
            orders_by_project.setdefault(order["project_id"], []).append(order)
    for project in projects:
        project_orders = orders_by_project.get(project["id"], [])
        project["active_request_count"] = active_requests_by_project.get(project["id"], 0)
        project["active_po_count"] = sum(1 for row in project_orders if row.get("status") != "completed")
        project["formal_po_value"] = round(sum(float(row.get("final_total") or 0) for row in project_orders), 2)
        project["paid_amount"] = round(sum(float(paid_by_order.get(row["id"], Decimal("0"))) for row in project_orders), 2)
        project["outstanding_amount"] = round(max(0, project["formal_po_value"] - project["paid_amount"]), 2)
    return projects


@api.get("/items")
async def list_items(
    main_category: Optional[str] = None,
    subcategory: Optional[str] = None,
    brand: Optional[str] = None,
    search: Optional[str] = None,
    current_user: User = Depends(require_erp_role()),
):
    items = [clean(d) for d in await db.items.find({}).sort("code", 1).to_list(10000)]
    for item in items:
        item["product_name"] = item.get("product_name") or item.get("name", "")
        item["brand"] = item.get("brand") or ""
        item["main_category"] = item.get("main_category") or item.get("category", "")
        item["subcategory"] = item.get("subcategory") or ""
        item["specifications"] = item.get("specifications") or item.get("specs", "")
    if main_category is not None:
        items = [item for item in items if item["main_category"] == main_category]
    if subcategory is not None:
        items = [item for item in items if item["subcategory"] == subcategory]
    if brand is not None:
        items = [item for item in items if item["brand"] == brand]
    if search and search.strip():
        query = search.strip().casefold()
        searchable_fields = (
            "code", "product_name", "brand", "main_category", "subcategory",
            "specifications", "name", "specs",
        )
        items = [
            item for item in items
            if any(query in str(item.get(field, "")).casefold() for field in searchable_fields)
        ]
    hist = await db.price_history.find({}, {"_id": 0}).to_list(100000)
    for it in items:
        rows = [h for h in hist if h.get("item_code") == it.get("code")]
        it["purchase_count"] = len(rows)
        it["total_qty"] = round(sum(h.get("quantity", 0) for h in rows), 2)
        it["total_value"] = round(sum(h.get("final_price", 0) for h in rows), 2)
        rows.sort(key=lambda h: h.get("date", ""))
        it["last_price"] = rows[-1].get("unit_price") if rows else None
        it["last_date"] = rows[-1].get("date") if rows else None
        it["last_supplier"] = rows[-1].get("supplier", "") if rows else ""
    return items


def normalize_item_data(data: dict, *, creating: bool) -> dict:
    """Accept legacy Category input while keeping it intact for old integrations."""
    if "product_name" in data:
        data["product_name"] = str(data.get("product_name") or "").strip()
    elif "name" in data:
        data["product_name"] = str(data.get("name") or "").strip()
    if "brand" in data:
        data["brand"] = str(data.get("brand") or "").strip()
    if "main_category" in data:
        data["main_category"] = str(data.get("main_category") or "").strip()
    elif "category" in data:
        data["main_category"] = str(data.get("category") or "").strip()
    if "subcategory" in data:
        data["subcategory"] = str(data.get("subcategory") or "").strip()
    if "specifications" in data:
        data["specifications"] = str(data.get("specifications") or "").strip()
    elif "specs" in data:
        data["specifications"] = str(data.get("specs") or "").strip()
    if creating:
        data["product_name"] = data.get("product_name") or str(data.get("name") or "").strip()
        data["name"] = data.get("name") or data["product_name"]
        data["brand"] = data.get("brand") or ""
        data["main_category"] = data.get("main_category") or str(data.get("category") or "").strip()
        data["subcategory"] = data.get("subcategory") or ""
        data["category"] = data.get("category") or data["main_category"]
        data["specifications"] = data.get("specifications") or str(data.get("specs") or "").strip()
        data["specs"] = data.get("specs") or data["specifications"]
    return data


async def create_entity(coll_name, body: BaseModel):
    data = body.model_dump()
    data.pop("code", None)
    if coll_name == "items":
        data = normalize_item_data(data, creating=True)
    if not data.get("name") or not str(data["name"]).strip():
        raise HTTPException(422, "الاسم مطلوب")
    data["name"] = str(data["name"]).strip()
    if await db[coll_name].find_one({"name": data["name"]}):
        raise HTTPException(409, "الاسم مسجل بالفعل")
    data["code"] = next_business_code(coll_name)
    data["id"] = str(uuid.uuid4())
    await db[coll_name].insert_one(dict(data))
    return clean(data)


async def update_entity(coll_name, entity_id: str, body: BaseModel):
    data = body.model_dump(exclude_unset=True, exclude_none=True)
    data.pop("code", None)
    if coll_name == "items":
        data = normalize_item_data(data, creating=False)
        if "product_name" in data and not data["product_name"]:
            raise HTTPException(422, "اسم المنتج مطلوب")
    existing = await db[coll_name].find_one({"id": entity_id})
    if not existing:
        raise HTTPException(404, "السجل غير موجود")
    if "name" in data:
        dup = await db[coll_name].find_one({"name": data["name"], "id": {"$ne": entity_id}})
        if dup:
            raise HTTPException(409, "الاسم مسجل بالفعل")
    data.pop("id", None)
    await db[coll_name].update_one({"id": entity_id}, {"$set": data})
    return clean(await db[coll_name].find_one({"id": entity_id}))


async def delete_entity(coll_name, entity_id: str):
    res = await db[coll_name].delete_one({"id": entity_id})
    if res.deleted_count == 0:
        raise HTTPException(404, "السجل غير موجود")
    return {"ok": True}


@api.post("/items")
async def create_item(body: ItemIn, current_user: User = Depends(require_erp_role())):
    return await create_entity("items", body)


@api.put("/items/{entity_id}")
async def update_item(entity_id: str, body: ItemIn, current_user: User = Depends(require_erp_role())):
    return await update_entity("items", entity_id, body)

@api.get("/purchase-orders")
async def list_purchase_orders(current_user: User = Depends(require_erp_role())):
    orders = [
        clean(d)
        for d in await db.purchase_orders.find(
            {},
            {"_id": 0},
        ).sort("po_number", -1).to_list(100000)
    ]

    items = await db.purchase_order_items.find(
        {},
        {"_id": 0},
    ).to_list(100000)

    items_by_order = {}

    for item in items:
        items_by_order.setdefault(
            item.get("purchase_order_id"),
            [],
        ).append(clean(item))

    approval_ids = {order.get("approval_id") for order in orders if order.get("approval_id")}
    approvals_by_id = {}
    paid_by_order: dict[str, Decimal] = {}
    last_payment_date_by_order: dict[str, str] = {}
    if approval_ids or orders:
        with SessionLocal() as session:
            if approval_ids:
                approvals_by_id = {
                    approval.id: approval
                    for approval in session.scalars(
                        select(EngineerApproval).where(EngineerApproval.id.in_(approval_ids))
                    ).all()
                }
            # One batched query for every listed PO's active payments -
            # avoids an N+1 lookup per row.
            for payment in session.scalars(
                select(PurchaseOrderPayment).where(
                    PurchaseOrderPayment.purchase_order_id.in_([order["id"] for order in orders]),
                    PurchaseOrderPayment.status == "recorded",
                )
            ).all():
                paid_by_order[payment.purchase_order_id] = (
                    paid_by_order.get(payment.purchase_order_id, Decimal("0"))
                    + Decimal(str(payment.amount))
                )
                last_payment_date_by_order[payment.purchase_order_id] = max(
                    last_payment_date_by_order.get(payment.purchase_order_id, ""),
                    payment.payment_date or "",
                )

    for order in orders:
        order["items"] = items_by_order.get(
            order.get("id"),
            [],
        )
        order["item_count"] = len(order["items"])
        approval = approvals_by_id.get(order.get("approval_id"))
        order["workflow"] = {
            "expenditure_approved": bool(approval and approval.approval_stage in {
                APPROVAL_STAGE_FUNDS_AVAILABILITY, APPROVAL_STAGE_PO_READY,
            }),
            "funds_released": bool(
                approval and approval.status == "approved"
                and approval.approval_stage == APPROVAL_STAGE_PO_READY
            ),
        }
        order["payment_summary"] = _po_payment_summary_from_paid(
            order, money(paid_by_order.get(order["id"], Decimal("0"))),
        )
        order["payment_summary"]["last_payment_date"] = (
            last_payment_date_by_order.get(order["id"]) or None
        )

    return orders


async def _purchase_order_detail(purchase_order_id: str) -> dict:
    order = await db.purchase_orders.find_one({"id": purchase_order_id})
    if not order:
        raise HTTPException(404, "أمر الشراء غير موجود")
    detail = clean(order)
    detail["items"] = [clean(item) for item in await db.purchase_order_items.find(
        {"purchase_order_id": purchase_order_id}, {"_id": 0}
    ).to_list(10000)]
    detail["payment_terms"] = "، ".join(dict.fromkeys(
        str(item.get("payment_terms") or "").strip()
        for item in detail["items"] if str(item.get("payment_terms") or "").strip()
    ))
    delivery_days = [int(item.get("delivery_days") or 0) for item in detail["items"] if int(item.get("delivery_days") or 0) > 0]
    detail["delivery_days"] = max(delivery_days) if delivery_days else 0
    detail["source_trace"] = [
        {"type": "request", "id": detail.get("source_request_id", ""), "number": detail.get("source_request_number", "")},
        {"type": "comparison", "id": detail.get("comparison_id", ""), "number": detail.get("comparison_number", "")},
        {"type": "approval", "id": detail.get("approval_id", ""), "number": detail.get("approval_number", "")},
        {"type": "purchase_order", "id": detail.get("id", ""), "number": detail.get("po_number", "")},
    ]
    detail["workflow"] = {"expenditure_approved": False, "funds_released": False}
    with SessionLocal() as session:
        receipts = session.scalars(
            select(PurchaseOrderReceipt)
            .where(PurchaseOrderReceipt.purchase_order_id == purchase_order_id)
            .order_by(PurchaseOrderReceipt.received_at.desc())
        ).all()
        receipt_ids = [receipt.id for receipt in receipts]
        receipt_lines = session.scalars(
            select(PurchaseOrderReceiptLine).where(
                PurchaseOrderReceiptLine.receipt_id.in_(receipt_ids)
            )
        ).all() if receipt_ids else []
        successful_receipt_ids = {
            receipt.id for receipt in receipts if receipt.receipt_type in {"full", "partial"}
        }
        received_by_item = {}
        lines_by_receipt = {}
        for line in receipt_lines:
            lines_by_receipt.setdefault(line.receipt_id, []).append(line)
            if line.receipt_id in successful_receipt_ids:
                received_by_item[line.purchase_order_item_id] = (
                    received_by_item.get(line.purchase_order_item_id, 0.0)
                    + float(line.received_quantity or 0)
                )
        for item in detail["items"]:
            ordered = float(item.get("quantity") or 0)
            received = min(ordered, received_by_item.get(item.get("id"), 0.0))
            item["received_quantity"] = round(received, 6)
            item["remaining_quantity"] = round(max(0.0, ordered - received), 6)
        total_ordered = sum(float(item.get("quantity") or 0) for item in detail["items"])
        total_received = sum(float(item.get("received_quantity") or 0) for item in detail["items"])
        detail["receipt_summary"] = {
            "ordered_quantity": round(total_ordered, 6),
            "received_quantity": round(total_received, 6),
            "remaining_quantity": round(max(0.0, total_ordered - total_received), 6),
            # Derived from the receipts already fetched above - nothing
            # persisted twice. receipts is sorted by received_at desc, so
            # the first row (if any) is the latest.
            "receipt_count": len(receipts),
            "latest_receipt_date": receipts[0].received_at if receipts else None,
        }
        detail["receipt_history"] = [{
            "id": receipt.id,
            "receipt_type": receipt.receipt_type,
            "actor_role": receipt.actor_role,
            "actor_name": receipt.actor_name,
            "note": receipt.note,
            "problem_reason": receipt.problem_reason,
            "affected_item_id": receipt.affected_item_id,
            "affected_quantity": receipt.affected_quantity,
            "received_at": receipt.received_at,
            "lines": [{
                column.name: getattr(line, column.name)
                for column in PurchaseOrderReceiptLine.__table__.columns
            } for line in sorted(lines_by_receipt.get(receipt.id, []), key=lambda row: row.product_name)],
        } for receipt in receipts]
        if detail.get("approval_id"):
            approval = session.get(EngineerApproval, detail["approval_id"])
            if approval:
                detail["workflow"] = {
                    "approval_stage": approval.approval_stage,
                    "responsible_role": approval.responsible_role,
                    "expenditure_approved": approval.approval_stage in {
                        APPROVAL_STAGE_FUNDS_AVAILABILITY, APPROVAL_STAGE_PO_READY,
                    },
                    "funds_released": (
                        approval.status == "approved"
                        and approval.approval_stage == APPROVAL_STAGE_PO_READY
                    ),
                }
    return detail


@api.get("/purchase-orders/{purchase_order_id}")
async def get_purchase_order(
    purchase_order_id: str, current_user: User = Depends(require_erp_role()),
):
    return await _purchase_order_detail(purchase_order_id)

@api.delete("/items/{entity_id}")
async def delete_item(entity_id: str, current_user: User = Depends(require_erp_role())):
    return await delete_entity("items", entity_id)


for _name in (name for name in ENTITIES if name != "items"):
    def _make(coll_name):
        async def _create(body: EntityIn, current_user: User = Depends(require_erp_role())):
            return await create_entity(coll_name, body)

        async def _update(entity_id: str, body: EntityIn, current_user: User = Depends(require_erp_role())):
            return await update_entity(coll_name, entity_id, body)

        async def _delete(entity_id: str, current_user: User = Depends(require_erp_role())):
            return await delete_entity(coll_name, entity_id)
        return _create, _update, _delete

    _c, _u, _d = _make(_name)
    api.post(f"/{_name}")(_c)
    api.put(f"/{_name}/{{entity_id}}")(_u)
    api.delete(f"/{_name}/{{entity_id}}")(_d)


# ---------------- Purchases ----------------
class PurchaseItemIn(BaseModel):
    item_id: str
    quantity: float
    unit_price: float
    discount_pct: float = 0
    vat_pct: float = 0


class PurchaseCreate(BaseModel):
    purchase_date: str
    invoice_number: str
    invoice_date: Optional[str] = ""
    po_number: Optional[str] = ""
    supplier_id: str
    project_id: str
    customer_id: str
    created_by: Optional[str] = ""
    purchase_type: Optional[str] = "محلي"
    currency: Optional[str] = "EGP"
    payment_method: Optional[str] = ""
    notes: Optional[str] = ""
    shipping_cost: float = 0
    other_costs: float = 0
    items: List[PurchaseItemIn]

class PurchaseOrderItemCreate(BaseModel):
    item_id: str = ""
    item_code: str = ""
    product_name: str
    brand: str = ""
    specifications: str = ""
    quantity: float
    unit: str = ""
    unit_price: float
    discount_pct: float = 0
    vat_pct: float = 0
    shipping_cost: float = 0
    other_cost: float = 0
    line_total: float = 0
    delivery_days: int = 0
    payment_terms: str = ""
    price_valid_until: str = ""


class PurchaseOrderSupplierGroup(BaseModel):
    supplier_id: str = ""
    supplier_name: str
    items: List[PurchaseOrderItemCreate]
    total: float = 0
    discount_pct: float = 0
    tax_pct: float = 0
    shipping_cost: float = 0
    other_cost: float = 0
    has_supplier_offer: bool = False


class PurchaseOrderFromComparison(BaseModel):
    comparison_id: str = ""
    comparison_number: str = ""
    project_id: str = ""
    project_name: str = ""
    customer_id: str = ""
    customer_name: str = ""
    po_date: str
    created_by: str = ""
    orders: List[PurchaseOrderSupplierGroup]


def _validate_formal_po_ancestry(
    session,
    comparison: PriceComparison,
    approval: EngineerApproval,
    project: Project,
) -> None:
    if approval.status != "approved" or approval.approval_stage != APPROVAL_STAGE_PO_READY:
        raise HTTPException(409, "الاعتماد الداخلي لم يصل إلى مرحلة إصدار أمر الشراء")
    if (
        approval.comparison_id != comparison.id
        or approval.comparison_number != comparison.comparison_number
    ):
        raise HTTPException(409, "مرجع المقارنة في الاعتماد غير متطابق")
    if not approval.source_request_id or approval.source_request_id != comparison.source_request_id:
        raise HTTPException(409, "مرجع طلب الشراء بين المقارنة والاعتماد غير متطابق")
    source_request = session.get(IncomingPurchaseRequest, approval.source_request_id)
    if not source_request:
        raise HTTPException(409, "طلب الشراء المصدر للاعتماد غير موجود")
    if (
        approval.source_request_number != source_request.request_number
        or comparison.source_request_number != source_request.request_number
    ):
        raise HTTPException(409, "رقم طلب الشراء في سلسلة الاعتماد غير متطابق")
    if (
        approval.project_id != project.id
        or comparison.project_id != project.id
        or source_request.project_id != project.id
    ):
        raise HTTPException(409, "مشروع طلب الشراء والمقارنة والاعتماد غير متطابق")


async def _next_po_number(_database=None) -> str:
    return reserve_code(
        "purchase_orders", "PO-", 6, ("PO-",),
        PurchaseOrder, PurchaseOrder.po_number,
    )


async def _next_purchase_id() -> str:
    return reserve_code(
        "purchases", "PUR-", 6, ("PUR-",),
        Purchase, Purchase.purchase_id,
    )


async def _next_payment_id() -> str:
    return reserve_code(
        "payments", "PAY-", 6, ("PAY-",),
        Payment, Payment.payment_id,
    )


@api.post("/purchase-orders/from-comparison")
async def create_purchase_orders_from_comparison(
    body: PurchaseOrderFromComparison,
    current_user: User = Depends(require_erp_role("procurement_responsible")),
):
    body.created_by = current_user.username
    if not body.comparison_id:
        raise HTTPException(
            422,
            "احفظ المقارنة أولاً قبل إنشاء أوامر الشراء",
        )

    with SessionLocal() as session:
        comparison = session.get(PriceComparison, body.comparison_id)
        if not comparison:
            raise HTTPException(404, "المقارنة غير موجودة")
        workflow_approval = session.scalar(
            select(EngineerApproval)
            .where(
                EngineerApproval.comparison_id == comparison.id,
                EngineerApproval.approval_type == "comparison_workflow",
            )
            .order_by(EngineerApproval.revision_number.desc())
        )
        legacy_approval = session.scalar(
            select(EngineerApproval)
            .where(
                EngineerApproval.comparison_id == comparison.id,
                EngineerApproval.approval_type == "external_engineer",
                EngineerApproval.status == "approved",
            )
            .order_by(EngineerApproval.revision_number.desc())
        )
        source_approval = None
        if workflow_approval:
            if (
                workflow_approval.status == "approved"
                and workflow_approval.approval_stage == APPROVAL_STAGE_PO_READY
            ):
                source_approval = workflow_approval
        else:
            source_approval = legacy_approval
        if not source_approval:
            raise HTTPException(
                409,
                "يجب اعتماد مقارنة الأسعار ثم اعتماد الصرف قبل إصدار أمر الشراء",
            )
        project = session.get(Project, source_approval.project_id) if source_approval.project_id else None
        if not project:
            raise HTTPException(409, "يجب ربط الاعتماد بمشروع صحيح قبل إصدار أمر الشراء")
        if source_approval.approval_type == "comparison_workflow":
            _validate_formal_po_ancestry(session, comparison, source_approval, project)
        approved_lines = session.scalars(
            select(EngineerApprovalLine)
            .where(EngineerApprovalLine.approval_id == source_approval.id)
            .order_by(EngineerApprovalLine.position)
        ).all()
        comparison_offers = session.scalars(
            select(PriceComparisonSupplierOffer).where(
                PriceComparisonSupplierOffer.comparison_id == comparison.id,
            )
        ).all()
        approval_offers = session.scalars(
            select(EngineerApprovalSupplierOffer).where(
                EngineerApprovalSupplierOffer.approval_id == source_approval.id,
            )
        ).all()

    if not approved_lines:
        raise HTTPException(422, "لا يحتوي الاعتماد على أصناف معتمدة لإنشاء أمر الشراء")
    if any(not (line.supplier_id or (line.supplier_name or "").strip()) for line in approved_lines):
        raise HTTPException(409, "يوجد مورد غير محدد داخل بنود الاعتماد")
    expired_lines = [
        line for line in approved_lines
        if line.price_valid_until and line.price_valid_until < body.po_date
    ]
    if expired_lines:
        names = "، ".join(line.product_name or "-" for line in expired_lines[:3])
        raise HTTPException(422, f"توجد عروض مختارة غير مكتملة أو غير صالحة: {names}")
    approved_products = [
        line.item_id or line.item_code or line.product_name
        for line in approved_lines
    ]
    if len(approved_products) != len(set(approved_products)):
        raise HTTPException(422, "يمكن إنشاء أمر شراء من عرض واحد فقط لكل منتج")

    offers_by_supplier = {}
    for offer in approval_offers or comparison_offers:
        for key in (
            offer.supplier_id, getattr(offer, "supplier_code", ""), offer.supplier_name,
        ):
            if key:
                offers_by_supplier[key] = offer
    grouped_orders = {}
    for line in approved_lines:
        supplier_key = line.supplier_id or line.supplier_name
        supplier_offer = offers_by_supplier.get(supplier_key)
        group = grouped_orders.setdefault(supplier_key, {
            "supplier_id": line.supplier_id,
            "supplier_name": line.supplier_name,
            "items": [],
            "discount_pct": float(supplier_offer.discount_pct or 0) if supplier_offer else 0,
            "tax_pct": float(supplier_offer.tax_pct or 0) if supplier_offer else 0,
            "shipping_cost": float(supplier_offer.shipping_cost or 0) if supplier_offer else 0,
            "other_cost": float(supplier_offer.other_cost or 0) if supplier_offer else 0,
            "has_supplier_offer": supplier_offer is not None,
        })
        group["items"].append(PurchaseOrderItemCreate(
            item_id=line.item_id,
            item_code=line.item_code,
            product_name=line.product_name,
            brand=line.brand,
            specifications=line.specifications,
            quantity=line.quantity,
            unit=line.unit,
            unit_price=line.unit_price,
            discount_pct=line.discount_pct,
            vat_pct=line.tax_pct,
            shipping_cost=line.shipping_cost,
            other_cost=line.other_cost,
            line_total=line.line_total,
            delivery_days=line.delivery_days,
            payment_terms=line.payment_terms,
            price_valid_until=line.price_valid_until,
        ))

    canonical_orders = [
        PurchaseOrderSupplierGroup(**group) for group in grouped_orders.values()
    ]
    existing_order = await db.purchase_orders.find_one(
        {"comparison_id": body.comparison_id}
    )

    if existing_order:
        raise HTTPException(
            409,
            "تم إنشاء أوامر شراء لهذه المقارنة من قبل",
        )

    for order in canonical_orders:
        if not order.supplier_name.strip():
            raise HTTPException(422, "اسم المورد مطلوب")
        if not order.items:
            raise HTTPException(422, f"لا توجد أصناف للمورد {order.supplier_name}")
    po_numbers = [await _next_po_number() for _order in canonical_orders]

    created_orders = []
    timestamp = datetime.now(timezone.utc).isoformat()

    with db.transaction() as tx:
        for order, po_number in zip(canonical_orders, po_numbers):
            purchase_order_id = str(uuid.uuid4())

            subtotal = 0.0
            discount_total = 0.0
            vat_total = 0.0
            shipping_total = 0.0
            other_total = 0.0
            final_total = 0.0

            prepared_items = []

            for item in order.items:
                quantity = float(item.quantity or 0)
                unit_price = float(item.unit_price or 0)
                discount_pct = float(item.discount_pct or 0)
                vat_pct = float(item.vat_pct or 0)
                shipping_cost = float(item.shipping_cost or 0)
                other_cost = float(item.other_cost or 0)

                if quantity <= 0:
                    raise HTTPException(
                        422,
                        f"الكمية غير صحيحة للصنف {item.product_name}",
                    )

                if unit_price <= 0:
                    raise HTTPException(
                        422,
                        f"سعر الصنف غير صحيح: {item.product_name}",
                    )

                line_subtotal = round(quantity * unit_price, 2)
                line_discount = round(line_subtotal * discount_pct / 100, 2)
                after_discount = line_subtotal - line_discount
                line_vat = round(after_discount * vat_pct / 100, 2)
                line_total = round(float(item.line_total or 0), 2)
                if line_total <= 0:
                    raise HTTPException(
                        409,
                        f"إجمالي الصنف المعتمد غير صحيح: {item.product_name}",
                    )

                subtotal += line_subtotal
                discount_total += line_discount
                vat_total += line_vat
                shipping_total += shipping_cost
                other_total += other_cost
                final_total += line_total

                prepared_items.append({
                    "id": str(uuid.uuid4()),
                    "purchase_order_id": purchase_order_id,
                    "item_id": item.item_id,
                    "item_code": item.item_code,
                    "product_name": item.product_name,
                    "brand": item.brand,
                    "specifications": item.specifications,
                    "quantity": quantity,
                    "unit": item.unit,
                    "unit_price": unit_price,
                    "discount_pct": discount_pct,
                    "vat_pct": vat_pct,
                    "shipping_cost": shipping_cost,
                    "other_cost": other_cost,
                    "line_total": round(line_total, 2),
                    "delivery_days": item.delivery_days,
                    "payment_terms": item.payment_terms,
                    "price_valid_until": item.price_valid_until,
                })

            if order.has_supplier_offer:
                offer_totals = calculate_supplier_total(
                    subtotal, order.discount_pct, order.tax_pct,
                    order.shipping_cost, order.other_cost,
                )
                discount_total = offer_totals["total_discounts"]
                vat_total = offer_totals["total_taxes"]
                shipping_total = offer_totals["total_shipping"]
                other_total = offer_totals["total_other_costs"]
                final_total = offer_totals["final_offer_total"]

            purchase_order = {
                "id": purchase_order_id,
                "po_number": po_number,

                "comparison_id": source_approval.comparison_id,
                "comparison_number": source_approval.comparison_number,
                "source_request_id": source_approval.source_request_id,
                "source_request_number": source_approval.source_request_number,

                "project_id": project.id,
                "project_name": source_approval.project_name or project.name,

                "supplier_id": order.supplier_id,
                "supplier_name": order.supplier_name,

                "customer_id": source_approval.customer_id,
                "customer_name": source_approval.customer_name,

                "approval_id": "",
                "approval_number": "",

                "po_date": body.po_date,
                "status": "draft",

                "subtotal": round(subtotal, 2),
                "discount_total": round(discount_total, 2),
                "vat_total": round(vat_total, 2),
                "shipping_total": round(shipping_total, 2),
                "other_total": round(other_total, 2),
                "final_total": round(final_total, 2),

                "notes": "",
                "created_by": body.created_by,
                "created_at": timestamp,
                "updated_at": timestamp,
            }

            purchase_order["approval_id"] = source_approval.id
            purchase_order["approval_number"] = source_approval.approval_number

            await tx.purchase_orders.insert_one(purchase_order)

            for item in prepared_items:
                await tx.purchase_order_items.insert_one(item)

            created_orders.append({
                **purchase_order,
                "items": prepared_items,
            })

    with SessionLocal.begin() as audit_session:
        for created_order in created_orders:
            _audit(
                audit_session,
                entity_type="purchase_order",
                entity_id=created_order["id"],
                event_type="purchase_order_generated",
                project_id=created_order.get("project_id") or "",
                actor_name=body.created_by,
                message=f"تم إنشاء أمر الشراء {created_order['po_number']}",
                metadata={
                    "comparison_id": comparison.id,
                    "approval_id": created_order.get("approval_id") or "",
                },
            )
        advance_request_milestone(
            audit_session,
            source_approval.source_request_id,
            "converted_to_purchase",
            actor=body.created_by,
            note=f"Formal purchase orders created from {source_approval.approval_number}",
        )

    return {
        "ok": True,
        "count": len(created_orders),
        "purchase_orders": created_orders,
    }


class PurchaseOrderStatusUpdate(BaseModel):
    status: Literal["approved", "sent", "supplier_confirmed", "cancelled"]


@api.patch("/purchase-orders/{purchase_order_id}/status")
async def update_purchase_order_status(
    purchase_order_id: str,
    body: PurchaseOrderStatusUpdate,
    current_user: User = Depends(require_erp_role("procurement_responsible")),
):
    order = await db.purchase_orders.find_one({"id": purchase_order_id})
    if not order:
        raise HTTPException(404, "أمر الشراء غير موجود")

    current = str(order.get("status") or "draft").lower()
    transitions = {
        "draft": {"approved", "cancelled"},
        "approved": {"sent", "cancelled"},
        "sent": {"supplier_confirmed", "cancelled"},
        "supplier_confirmed": {"cancelled"},
        "cancelled": set(),
    }
    if body.status not in transitions.get(current, set()):
        raise HTTPException(
            409,
            f"لا يمكن تغيير حالة أمر الشراء من {current} إلى {body.status}",
        )

    await db.purchase_orders.update_one(
        {"id": purchase_order_id},
        {"$set": {"status": body.status, "updated_at": now_iso()}},
    )
    with SessionLocal.begin() as audit_session:
        _audit(
            audit_session,
            entity_type="purchase_order",
            entity_id=purchase_order_id,
            event_type=f"purchase_order_{body.status}",
            project_id=str(order.get("project_id") or ""),
            message=f"تم تغيير حالة أمر الشراء إلى {body.status}",
        )
        if body.status == "cancelled":
            sync_request_completion(
                audit_session,
                str(order.get("source_request_id") or ""),
            )
    return clean(await db.purchase_orders.find_one({"id": purchase_order_id}))


class PurchaseOrderFinalizeIn(BaseModel):
    actor: str = ""
    note: str = ""


@api.post("/purchase-orders/{purchase_order_id}/finalize")
async def finalize_purchase_order(
    purchase_order_id: str, body: PurchaseOrderFinalizeIn,
    current_user: User = Depends(require_erp_role("procurement_responsible")),
):
    order = await db.purchase_orders.find_one({"id": purchase_order_id})
    if not order:
        raise HTTPException(404, "أمر الشراء غير موجود")
    if order.get("status") == "in_delivery":
        return {"ok": True, "already_recorded": True, "purchase_order": await _purchase_order_detail(purchase_order_id)}
    if order.get("status") not in {"draft", "approved", "sent", "supplier_confirmed"}:
        raise HTTPException(409, "لا يمكن تنفيذ أمر الشراء من حالته الحالية")
    with SessionLocal() as session:
        approval = session.get(EngineerApproval, order.get("approval_id")) if order.get("approval_id") else None
        if not approval or approval.status != "approved":
            raise HTTPException(409, "يجب اكتمال الاعتمادات وإتاحة المبلغ قبل التنفيذ")
        if (
            approval.approval_type == "comparison_workflow"
            and approval.approval_stage != APPROVAL_STAGE_PO_READY
        ):
            raise HTTPException(409, "يجب تأكيد إتاحة المبلغ قبل التنفيذ")
    timestamp = now_iso()
    values = {
        "status": "in_delivery", "updated_at": timestamp,
        "executed_at": timestamp, "executed_by": current_user.username,
    }
    if body.note.strip():
        values["execution_note"] = body.note.strip()
    await db.purchase_orders.update_one({"id": purchase_order_id}, {"$set": values})
    with SessionLocal.begin() as audit_session:
        _audit(audit_session, entity_type="purchase_order", entity_id=purchase_order_id,
               event_type="purchase_order_executed", project_id=str(order.get("project_id") or ""),
               actor_name=current_user.username, message=f"تم تنفيذ {order.get('po_number')} وأصبح قيد التوريد",
               metadata={"actor_role": current_user.role})
    return {"ok": True, "already_recorded": False, "purchase_order": await _purchase_order_detail(purchase_order_id)}


class PurchaseOrderReceiptLineIn(BaseModel):
    purchase_order_item_id: str
    quantity: float = Field(ge=0)


class PurchaseOrderReceiptIn(BaseModel):
    receipt_type: Literal["full", "partial", "problem"]
    idempotency_key: str = Field(min_length=8, max_length=120)
    actor: str = Field(default="", max_length=200)
    note: str = Field(default="", max_length=2000)
    lines: List[PurchaseOrderReceiptLineIn] = Field(default_factory=list)
    problem_reason: Literal["", "كمية ناقصة", "مواصفة غير مطابقة", "صنف مختلف", "تالف", "مشكلة أخرى"] = ""
    affected_item_id: str = ""
    affected_quantity: float = Field(default=0, ge=0)


@api.post("/purchase-orders/{purchase_order_id}/receipts")
async def record_purchase_order_receipt(
    purchase_order_id: str, body: PurchaseOrderReceiptIn,
    current_user: User = Depends(require_erp_role("procurement_responsible")),
):
    session = SessionLocal()
    try:
        if IS_SQLITE:
            session.connection().exec_driver_sql("BEGIN IMMEDIATE")
        existing = session.scalar(select(PurchaseOrderReceipt).where(
            PurchaseOrderReceipt.purchase_order_id == purchase_order_id,
            PurchaseOrderReceipt.idempotency_key == body.idempotency_key,
        ))
        if existing:
            session.rollback()
            return {
                "ok": True,
                "already_recorded": True,
                "purchase_order": await _purchase_order_detail(purchase_order_id),
            }
        order = session.get(PurchaseOrder, purchase_order_id)
        if not order:
            raise HTTPException(404, "أمر الشراء غير موجود")
        if order.status not in {"in_delivery", "partial_received", "delivery_problem"}:
            raise HTTPException(409, "لا يمكن تسجيل الاستلام قبل وصول أمر الشراء إلى قيد التوريد")
        items = session.scalars(select(PurchaseOrderItem).where(
            PurchaseOrderItem.purchase_order_id == purchase_order_id
        )).all()
        if not items:
            raise HTTPException(409, "لا يحتوي أمر الشراء على بنود قابلة للاستلام")
        item_map = {item.id: item for item in items}
        receipts = session.scalars(select(PurchaseOrderReceipt).where(
            PurchaseOrderReceipt.purchase_order_id == purchase_order_id,
            PurchaseOrderReceipt.receipt_type.in_(["full", "partial"]),
        )).all()
        successful_ids = [receipt.id for receipt in receipts]
        prior_lines = session.scalars(select(PurchaseOrderReceiptLine).where(
            PurchaseOrderReceiptLine.receipt_id.in_(successful_ids)
        )).all() if successful_ids else []
        received_by_item = {}
        for line in prior_lines:
            received_by_item[line.purchase_order_item_id] = (
                received_by_item.get(line.purchase_order_item_id, 0.0)
                + float(line.received_quantity or 0)
            )

        requested = {}
        if body.receipt_type == "partial":
            for line in body.lines:
                if line.purchase_order_item_id in requested:
                    raise HTTPException(422, "لا يمكن تكرار الصنف داخل نفس الاستلام")
                if line.purchase_order_item_id not in item_map:
                    raise HTTPException(422, "أحد بنود الاستلام لا يتبع أمر الشراء")
                if line.quantity <= 0:
                    raise HTTPException(422, "الكمية المستلمة الآن يجب أن تكون أكبر من صفر")
                requested[line.purchase_order_item_id] = float(line.quantity)
            if not requested:
                raise HTTPException(422, "أدخل كمية مستلمة لصنف واحد على الأقل")
        elif body.receipt_type == "full":
            requested = {
                item.id: max(0.0, float(item.quantity or 0) - received_by_item.get(item.id, 0.0))
                for item in items
            }
            requested = {item_id: quantity for item_id, quantity in requested.items() if quantity > 1e-9}
            if not requested:
                raise HTTPException(409, "تم استلام جميع بنود أمر الشراء بالفعل")
        else:
            if not body.problem_reason:
                raise HTTPException(422, "اختر سبب مشكلة التوريد")
            if body.affected_item_id and body.affected_item_id not in item_map:
                raise HTTPException(422, "الصنف المتأثر لا يتبع أمر الشراء")
            if body.affected_quantity and not body.affected_item_id:
                raise HTTPException(422, "حدد الصنف المتأثر عند إدخال كمية")
            if body.affected_item_id:
                affected = item_map[body.affected_item_id]
                remaining = max(0.0, float(affected.quantity or 0) - received_by_item.get(affected.id, 0.0))
                if body.affected_quantity > remaining + 1e-9:
                    raise HTTPException(422, "الكمية المتأثرة أكبر من الكمية المتبقية")

        timestamp = now_iso()
        receipt = PurchaseOrderReceipt(
            id=str(uuid.uuid4()), purchase_order_id=purchase_order_id,
            idempotency_key=body.idempotency_key, receipt_type=body.receipt_type,
            actor_role=current_user.role, actor_name=current_user.username, note=body.note.strip(),
            problem_reason=body.problem_reason, affected_item_id=body.affected_item_id,
            affected_quantity=float(body.affected_quantity or 0), po_number=order.po_number,
            project_name=order.project_name, supplier_name=order.supplier_name,
            received_at=timestamp,
        )
        session.add(receipt)
        session.flush()
        receipt_lines = []
        if body.receipt_type in {"full", "partial"}:
            for item_id, quantity in requested.items():
                item = item_map[item_id]
                ordered = float(item.quantity or 0)
                previously_received = received_by_item.get(item_id, 0.0)
                remaining = max(0.0, ordered - previously_received)
                if quantity > remaining + 1e-9:
                    raise HTTPException(422, f"الكمية المستلمة للصنف {item.product_name} أكبر من المتبقي")
                line = PurchaseOrderReceiptLine(
                    id=str(uuid.uuid4()), receipt_id=receipt.id,
                    purchase_order_item_id=item.id, item_code=item.item_code,
                    product_name=item.product_name, unit=item.unit,
                    ordered_quantity=ordered,
                    previously_received_quantity=previously_received,
                    received_quantity=quantity,
                    remaining_quantity=max(0.0, remaining - quantity),
                )
                session.add(line)
                receipt_lines.append(line)
                received_by_item[item_id] = previously_received + quantity
        elif body.affected_item_id:
            item = item_map[body.affected_item_id]
            previously_received = received_by_item.get(item.id, 0.0)
            session.add(PurchaseOrderReceiptLine(
                id=str(uuid.uuid4()), receipt_id=receipt.id,
                purchase_order_item_id=item.id, item_code=item.item_code,
                product_name=item.product_name, unit=item.unit,
                ordered_quantity=float(item.quantity or 0),
                previously_received_quantity=previously_received,
                received_quantity=0,
                remaining_quantity=max(0.0, float(item.quantity or 0) - previously_received),
            ))

        completed = body.receipt_type in {"full", "partial"} and all(
            received_by_item.get(item.id, 0.0) >= float(item.quantity or 0) - 1e-9
            for item in items
        )
        order.status = "completed" if completed else (
            "delivery_problem" if body.receipt_type == "problem" else "partial_received"
        )
        order.updated_at = timestamp
        if body.receipt_type == "problem":
            _audit(
                session, entity_type="purchase_order", entity_id=order.id,
                event_type="purchase_order_delivery_problem", project_id=order.project_id,
                actor_name=current_user.username, message=f"تم تسجيل مشكلة توريد: {body.problem_reason}",
                metadata={"receipt_id": receipt.id, "reason": body.problem_reason},
            )
        else:
            total_now = sum(line.received_quantity for line in receipt_lines)
            total_ordered = sum(float(item.quantity or 0) for item in items)
            total_received = sum(min(float(item.quantity or 0), received_by_item.get(item.id, 0.0)) for item in items)
            _audit(
                session, entity_type="purchase_order", entity_id=order.id,
                event_type="purchase_order_received_full" if completed else "purchase_order_received_partial",
                project_id=order.project_id, actor_name=current_user.username,
                message=("تم الاستلام بالكامل" if completed else f"تم استلام {total_now:g} الآن؛ الإجمالي {total_received:g} من {total_ordered:g}"),
                metadata={"receipt_id": receipt.id, "received_now": total_now, "received_total": total_received},
            )
            if completed:
                _audit(
                    session, entity_type="purchase_order", entity_id=order.id,
                    event_type="purchase_order_completed", project_id=order.project_id,
                    actor_name=current_user.username, message="تم إغلاق أمر الشراء بعد استلام جميع الكميات",
                    metadata={"receipt_id": receipt.id},
                )
        sync_request_completion(
            session,
            order.source_request_id,
            actor=current_user.username,
        )
        session.commit()
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()
    return {
        "ok": True,
        "already_recorded": False,
        "purchase_order": await _purchase_order_detail(purchase_order_id),
    }


def _admin_delivery_report(detail: dict) -> dict:
    return {
        "report_type": "admin", "company": "RE DECOR & MORE",
        "title": "تقرير تنفيذ أمر الشراء", "status": "قيد التوريد",
        "project_name": detail.get("project_name", ""), "customer_name": detail.get("customer_name", ""),
        "po_number": detail.get("po_number", ""), "request_number": detail.get("source_request_number", ""),
        "comparison_number": detail.get("comparison_number", ""), "approval_number": detail.get("approval_number", ""),
        "supplier_name": detail.get("supplier_name", ""), "execution_date": detail.get("executed_at") or detail.get("updated_at", ""),
        "prepared_by": detail.get("executed_by") or detail.get("created_by", ""),
        "payment_terms": detail.get("payment_terms", ""), "delivery_days": detail.get("delivery_days", 0),
        "notes": detail.get("execution_note") or detail.get("notes", ""), "generated_at": now_iso(),
        "items": [{
            "position": index, "item_code": item.get("item_code", ""), "product_name": item.get("product_name", ""),
            "brand": item.get("brand", ""), "specifications": item.get("specifications", ""),
            "quantity": item.get("quantity", 0), "unit": item.get("unit", ""),
            "unit_price": item.get("unit_price", 0), "discount_pct": item.get("discount_pct", 0),
            "vat_pct": item.get("vat_pct", 0), "shipping_cost": item.get("shipping_cost", 0),
            "other_cost": item.get("other_cost", 0), "line_total": item.get("line_total", 0),
        } for index, item in enumerate(detail.get("items", []), 1)],
        "totals": {key: detail.get(key, 0) for key in (
            "subtotal", "discount_total", "vat_total", "shipping_total", "other_total", "final_total"
        )},
    }


def _site_delivery_report(detail: dict) -> dict:
    return {
        "report_type": "site", "company": "RE DECOR & MORE",
        "title": "إشعار توريد للموقع", "status": "قيد التوريد",
        "project_name": detail.get("project_name", ""), "po_number": detail.get("po_number", ""),
        "delivery_reference": detail.get("source_request_number") or detail.get("po_number", ""),
        "supplier_name": detail.get("supplier_name", ""), "delivery_days": detail.get("delivery_days", 0),
        "expected_delivery_date": detail.get("expected_delivery_date", ""),
        "notes": detail.get("execution_note") or detail.get("notes", ""), "generated_at": now_iso(),
        "receiving_instruction": "يرجى مطابقة الصنف والكمية والمواصفات قبل تأكيد الاستلام.",
        "items": [{
            "position": index, "item_code": item.get("item_code", ""), "product_name": item.get("product_name", ""),
            "brand": item.get("brand", ""), "specifications": item.get("specifications", ""),
            "quantity": item.get("quantity", 0), "unit": item.get("unit", ""),
        } for index, item in enumerate(detail.get("items", []), 1)],
    }


@api.get("/purchase-orders/{purchase_order_id}/reports/{audience}")
async def purchase_order_report(
    purchase_order_id: str, audience: Literal["admin", "site"],
    current_user: User = Depends(require_erp_role()),
):
    detail = await _purchase_order_detail(purchase_order_id)
    if detail.get("status") not in {"in_delivery", "partial_received", "delivery_problem", "completed"}:
        raise HTTPException(409, "تتاح تقارير التوريد بعد تنفيذ أمر الشراء")
    return _admin_delivery_report(detail) if audience == "admin" else _site_delivery_report(detail)


@api.delete("/purchase-orders/{purchase_order_id}")
async def delete_purchase_order(
    purchase_order_id: str,
    current_user: User = Depends(require_erp_role("procurement_responsible")),
):
    order = await db.purchase_orders.find_one({"id": purchase_order_id})

    if not order:
        raise HTTPException(404, "أمر الشراء غير موجود")

    if str(order.get("status") or "").lower() not in {"draft", "cancelled"}:
        raise HTTPException(
            409,
            "لا يمكن حذف أمر شراء معتمد أو مرسل",
        )

    with db.transaction() as tx:
        await tx.purchase_order_items.delete_many(
            {"purchase_order_id": purchase_order_id}
        )

        await tx.purchase_orders.delete_one(
            {"id": purchase_order_id}
        )

    return {
        "ok": True,
        "deleted_id": purchase_order_id,
    }


# ---------------- Purchase Order payment ledger ----------------
# Actual money paid to the supplier against a formal PO. Deliberately
# separate from:
#  - Payment/`/payments` above: legacy Direct Purchase payments, keyed by
#    purchase_id, no relationship to purchase_order_id whatsoever.
#  - ApprovalPayment (procurement_workflow.py): the commercial/funds-release
#    approval event - funds being approved/released is not the same fact as
#    money having actually left the business. Approval-level amounts are
#    never counted here.
PO_PAYMENT_METHODS = ("bank_transfer", "cash", "cheque", "card", "other")
# "Once a PO has reached a commercially valid issued state" - i.e. everything
# except draft (not yet issued) and cancelled.
PO_PAYABLE_STATUSES = {
    "approved", "sent", "supplier_confirmed", "in_delivery",
    "partial_received", "delivery_problem", "completed",
}
PAYMENT_TOLERANCE = Decimal("0.01")


class POPaymentIn(BaseModel):
    payment_date: str = Field(min_length=10, max_length=10)
    amount: float
    payment_method: Literal["bank_transfer", "cash", "cheque", "card", "other"]
    payment_reference: str = Field(default="", max_length=200)
    notes: str = Field(default="", max_length=2000)
    idempotency_key: str = Field(min_length=8, max_length=120)


class POPaymentVoidIn(BaseModel):
    reason: str = Field(min_length=1, max_length=2000)


def _po_payment_document(payment) -> dict:
    return {
        "id": payment.id, "payment_number": payment.payment_number,
        "purchase_order_id": payment.purchase_order_id,
        "payment_date": payment.payment_date, "amount": payment.amount,
        "payment_method": payment.payment_method, "payment_reference": payment.payment_reference,
        "notes": payment.notes, "status": payment.status, "void_reason": payment.void_reason,
        "created_by": payment.created_by, "created_at": payment.created_at, "updated_at": payment.updated_at,
    }


def _po_due_date(order: dict) -> str:
    """payment_due_date wins if explicitly set; otherwise credit_days from
    the PO date - the only reliably-known base date. Never guesses an
    "after delivery"/"after invoice" rule from free-text payment terms."""
    explicit = str(order.get("payment_due_date") or "").strip()
    if explicit:
        return explicit
    credit_days = order.get("credit_days")
    po_date = str(order.get("po_date") or "").strip()
    if credit_days and po_date:
        try:
            base = datetime.strptime(po_date, "%Y-%m-%d")
            return (base + timedelta(days=int(credit_days))).date().isoformat()
        except (ValueError, TypeError):
            return ""
    return ""


def _po_payment_status(po_total: Decimal, paid_amount: Decimal, due_date: str) -> dict:
    outstanding = po_total - paid_amount
    if outstanding < 0:
        outstanding = Decimal("0")
    today = datetime.now(timezone.utc).date().isoformat()
    if outstanding <= PAYMENT_TOLERANCE:
        return {
            "payment_status": "paid", "is_overdue": False,
            "outstanding_amount": float(money(outstanding)),
        }
    is_overdue = bool(due_date) and due_date < today
    if paid_amount > PAYMENT_TOLERANCE:
        status = "partially_paid"
    else:
        # Due-date intelligence remains available through due_date/is_overdue,
        # but the V1 payment register has one zero-paid state: unpaid.
        status = "unpaid"
    return {"payment_status": status, "is_overdue": is_overdue, "outstanding_amount": float(money(outstanding))}


def _active_po_payments(session, purchase_order_id: str):
    return session.scalars(
        select(PurchaseOrderPayment).where(
            PurchaseOrderPayment.purchase_order_id == purchase_order_id,
            PurchaseOrderPayment.status == "recorded",
        )
    ).all()


def _po_payment_summary_from_paid(order: dict, paid_amount: Decimal) -> dict:
    po_total = money(order.get("final_total") or 0)
    due_date = _po_due_date(order)
    status_info = _po_payment_status(po_total, paid_amount, due_date)
    return {
        "po_total": float(po_total), "paid_amount": float(paid_amount),
        "credit_days": order.get("credit_days"), "due_date": due_date or None,
        "payment_terms": order.get("payment_terms", ""),
        **status_info,
    }


def _po_payment_summary(session, order: dict) -> dict:
    paid_amount = money(sum(
        Decimal(str(payment.amount)) for payment in _active_po_payments(session, order["id"])
    ))
    return _po_payment_summary_from_paid(order, paid_amount)


@api.get("/purchase-orders/{purchase_order_id}/payments")
async def list_po_payments(
    purchase_order_id: str, current_user: User = Depends(require_erp_role()),
):
    order = await db.purchase_orders.find_one({"id": purchase_order_id})
    if not order:
        raise HTTPException(404, "أمر الشراء غير موجود")
    detail = await _purchase_order_detail(purchase_order_id)
    with SessionLocal() as session:
        summary = _po_payment_summary(session, {**order, "payment_terms": detail.get("payment_terms", "")})
        payments = session.scalars(
            select(PurchaseOrderPayment)
            .where(PurchaseOrderPayment.purchase_order_id == purchase_order_id)
            .order_by(PurchaseOrderPayment.created_at.desc())
        ).all()
    return {
        "payment_summary": summary,
        "payments": [_po_payment_document(payment) for payment in payments],
    }


@api.post("/purchase-orders/{purchase_order_id}/payments")
async def record_po_payment(
    purchase_order_id: str, body: POPaymentIn,
    current_user: User = Depends(require_erp_role("commercial_manager")),
):
    order = await db.purchase_orders.find_one({"id": purchase_order_id})
    if not order:
        raise HTTPException(404, "أمر الشراء غير موجود")
    status = str(order.get("status") or "").lower()
    if status not in PO_PAYABLE_STATUSES:
        raise HTTPException(409, "لا يمكن تسجيل دفعة لأمر شراء بهذه الحالة")
    if not body.payment_date.strip():
        raise HTTPException(422, "من فضلك أدخل تاريخ الدفعة")
    amount = require_finite(body.amount, "قيمة الدفعة غير صحيحة")
    if amount <= 0:
        raise HTTPException(422, "قيمة الدفعة يجب أن تكون أكبر من صفر")
    amount = money(amount)

    with SessionLocal() as session:
        existing = session.scalar(
            select(PurchaseOrderPayment).where(
                PurchaseOrderPayment.purchase_order_id == purchase_order_id,
                PurchaseOrderPayment.idempotency_key == body.idempotency_key,
            )
        )
        if existing:
            return {
                "ok": True, "already_recorded": True,
                "payment": _po_payment_document(existing),
                "payment_summary": _po_payment_summary(session, order),
            }

        po_total = money(order.get("final_total") or 0)
        already_paid = money(sum(
            Decimal(str(payment.amount)) for payment in _active_po_payments(session, purchase_order_id)
        ))
        if already_paid + amount > po_total + PAYMENT_TOLERANCE:
            outstanding = money(max(po_total - already_paid, Decimal("0")))
            raise HTTPException(422, f"قيمة الدفعة تتجاوز المتبقي على أمر الشراء (المتبقي: {outstanding})")

        payment_number = await _next_payment_id()
        timestamp = now_iso()
        payment = PurchaseOrderPayment(
            id=str(uuid.uuid4()), payment_number=payment_number,
            purchase_order_id=purchase_order_id, idempotency_key=body.idempotency_key,
            payment_date=body.payment_date.strip(), amount=float(amount),
            payment_method=body.payment_method, payment_reference=body.payment_reference.strip(),
            notes=body.notes.strip(), status="recorded",
            created_by=current_user.username, created_at=timestamp, updated_at=timestamp,
        )
        session.add(payment)
        _audit(
            session, entity_type="purchase_order", entity_id=purchase_order_id,
            event_type="po_payment_recorded", project_id=str(order.get("project_id") or ""),
            actor_name=current_user.username,
            message=f"تم تسجيل دفعة {payment_number} بقيمة {amount} لأمر الشراء {order.get('po_number')}",
            metadata={"amount": float(amount), "actor_role": current_user.role},
        )
        session.commit()
        return {
            "ok": True, "already_recorded": False,
            "payment": _po_payment_document(payment),
            "payment_summary": _po_payment_summary(session, order),
        }


@api.post("/purchase-orders/{purchase_order_id}/payments/{payment_id}/void")
async def void_po_payment(
    purchase_order_id: str, payment_id: str, body: POPaymentVoidIn,
    current_user: User = Depends(require_erp_role("commercial_manager")),
):
    order = await db.purchase_orders.find_one({"id": purchase_order_id})
    if not order:
        raise HTTPException(404, "أمر الشراء غير موجود")
    if not body.reason.strip():
        raise HTTPException(422, "سبب إلغاء الدفعة مطلوب")
    with SessionLocal() as session:
        payment = session.get(PurchaseOrderPayment, payment_id)
        if not payment or payment.purchase_order_id != purchase_order_id:
            raise HTTPException(404, "الدفعة غير موجودة")
        if payment.status == "voided":
            return {
                "ok": True, "already_recorded": True,
                "payment": _po_payment_document(payment),
                "payment_summary": _po_payment_summary(session, order),
            }
        payment.status = "voided"
        payment.void_reason = body.reason.strip()
        payment.updated_at = now_iso()
        _audit(
            session, entity_type="purchase_order", entity_id=purchase_order_id,
            event_type="po_payment_voided", project_id=str(order.get("project_id") or ""),
            actor_name=current_user.username,
            message=f"تم إلغاء الدفعة {payment.payment_number}: {body.reason.strip()}",
            metadata={"amount": payment.amount, "actor_role": current_user.role},
        )
        session.commit()
        return {
            "ok": True, "already_recorded": False,
            "payment": _po_payment_document(payment),
            "payment_summary": _po_payment_summary(session, order),
        }


async def paid_amounts():
    pays = await db.payments.find({}, {"_id": 0}).to_list(100000)
    m = {}
    for p in pays:
        m[p["purchase_id"]] = m.get(p["purchase_id"], 0) + p.get("amount_paid", 0)
    return m


@api.get("/purchases")
async def list_purchases(current_user: User = Depends(require_erp_role())):
    purchases = [clean(d) for d in await db.purchases.find({}).sort("purchase_id", -1).to_list(100000)]
    lines = await db.purchase_items.find({}, {"_id": 0}).to_list(100000)
    item_search = {}
    for line in lines:
        item_search.setdefault(line["purchase_id"], []).extend([
            line.get("item_code", ""), line.get("item_name", ""),
            line.get("product_name", ""), line.get("brand", ""),
            line.get("main_category", ""), line.get("subcategory", ""),
            line.get("specifications", ""),
        ])
    paid = await paid_amounts()
    for p in purchases:
        p["item_search"] = " ".join(item_search.get(p["purchase_id"], []))
        p["paid_amount"] = round(paid.get(p["purchase_id"], 0), 2)
        p["remaining"] = round(max(0, p.get("invoice_total", 0) - p["paid_amount"]), 2)
    return purchases


@api.get("/purchases/{purchase_id}")
async def get_purchase(purchase_id: str, current_user: User = Depends(require_erp_role())):
    pur = await db.purchases.find_one({"purchase_id": purchase_id})
    if not pur:
        raise HTTPException(404, "عملية الشراء غير موجودة")
    pur = clean(pur)
    pur["items"] = [clean(d) for d in await db.purchase_items.find({"purchase_id": purchase_id}).to_list(10000)]
    paid = await paid_amounts()
    pur["paid_amount"] = round(paid.get(purchase_id, 0), 2)
    pur["remaining"] = round(max(0, pur.get("invoice_total", 0) - pur["paid_amount"]), 2)
    related = {
        "purchase_order_id": "", "purchase_order_number": pur.get("po_number", ""),
        "purchase_order_status": "", "comparison_id": "", "comparison_number": "",
        "source_request_id": "", "source_request_number": "",
        "approval_id": "", "approval_number": "", "project_id": pur.get("project_id", ""),
    }
    if pur.get("po_number"):
        order = await db.purchase_orders.find_one({"po_number": pur["po_number"]})
        if order:
            related.update({
                "purchase_order_id": order.get("id", ""),
                "purchase_order_number": order.get("po_number", ""),
                "purchase_order_status": order.get("status", ""),
                "comparison_id": order.get("comparison_id", ""),
                "comparison_number": order.get("comparison_number", ""),
                "source_request_id": order.get("source_request_id", ""),
                "source_request_number": order.get("source_request_number", ""),
                "approval_id": order.get("approval_id", ""),
                "approval_number": order.get("approval_number", ""),
                "project_id": order.get("project_id", "") or pur.get("project_id", ""),
            })
    pur["related"] = related
    return pur


@api.post("/purchases")
async def create_purchase(body: PurchaseCreate, current_user: User = Depends(require_erp_role())):
    if not body.purchase_date.strip():
        raise HTTPException(422, "من فضلك أدخل تاريخ شراء صحيح")
    invoice_number = body.invoice_number.strip()
    normalized_invoice = normalize_invoice_number(invoice_number)
    if not normalized_invoice:
        raise HTTPException(422, "من فضلك أدخل رقم الفاتورة")
    if not body.items:
        raise HTTPException(422, "من فضلك أضف صنفاً واحداً على الأقل")
    shipping_cost = require_finite(body.shipping_cost, "تكلفة الشحن غير صحيحة")
    other_costs = require_finite(body.other_costs, "التكاليف الأخرى غير صحيحة")
    if shipping_cost < 0 or other_costs < 0:
        raise HTTPException(422, "تكلفة الشحن والتكاليف الأخرى لا يمكن أن تكون سالبة")
    shipping_cost = money(shipping_cost)
    other_costs = money(other_costs)

    with db.transaction() as tx:
        supplier = await tx.suppliers.find_one({"id": body.supplier_id})
        if not supplier:
            raise HTTPException(422, "من فضلك اختر المورد")
        project = await tx.projects.find_one({"id": body.project_id})
        if not project:
            raise HTTPException(422, "من فضلك اختر المشروع")
        customer = await tx.customers.find_one({"id": body.customer_id})
        if not customer:
            raise HTTPException(422, "من فضلك اختر العميل")

        supplier_purchases = await tx.purchases.find(
            {"supplier_id": body.supplier_id}
        ).to_list(100000)
        duplicate = next(
            (
                purchase
                for purchase in supplier_purchases
                if normalize_invoice_number(purchase.get("invoice_number", ""))
                == normalized_invoice
            ),
            None,
        )
        if duplicate:
            raise HTTPException(
                409,
                detail={
                    "code": "duplicate_supplier_invoice",
                    "message": "رقم الفاتورة مسجل بالفعل لنفس المورد",
                    "existing_purchase_id": duplicate.get("purchase_id", ""),
                    "invoice_number": duplicate.get("invoice_number", invoice_number),
                    "supplier": supplier["name"],
                },
            )

        lines = []
        for index, line in enumerate(body.items, 1):
            item = await tx.items.find_one({"id": line.item_id})
            if not item:
                raise HTTPException(422, f"الصنف في السطر {index} غير موجود")
            quantity = require_finite(line.quantity, f"الكمية غير صحيحة للصنف: {item['name']}")
            unit_price = require_finite(line.unit_price, f"سعر الوحدة غير صحيح للصنف: {item['name']}")
            discount_pct = require_finite(line.discount_pct, f"نسبة الخصم غير صحيحة للصنف: {item['name']}")
            vat_pct = require_finite(line.vat_pct, f"نسبة الضريبة غير صحيحة للصنف: {item['name']}")
            if quantity <= 0:
                raise HTTPException(422, f"الكمية غير صحيحة للصنف: {item['name']}")
            if unit_price <= 0:
                raise HTTPException(422, f"سعر الوحدة غير صحيح للصنف: {item['name']}")
            if not 0 <= discount_pct <= PERCENT:
                raise HTTPException(422, f"نسبة الخصم يجب أن تكون بين 0 و100 للصنف: {item['name']}")
            if not 0 <= vat_pct <= PERCENT:
                raise HTTPException(422, f"نسبة الضريبة يجب أن تكون بين 0 و100 للصنف: {item['name']}")
            unit = str(item.get("unit", "")).strip()
            if not unit:
                raise HTTPException(422, f"وحدة الصنف مطلوبة: {item['name']}")

            base = money(quantity * unit_price)
            discount = money(base * discount_pct / PERCENT)
            after_discount_line = base - discount
            vat = money(after_discount_line * vat_pct / PERCENT)
            line_total = money(after_discount_line + vat)
            lines.append(
                {
                    "item": item,
                    "input": line,
                    "unit": unit,
                    "base": base,
                    "discount": discount,
                    "after_discount": after_discount_line,
                    "vat": vat,
                    "line_total": line_total,
                }
            )

        subtotal = sum((line["base"] for line in lines), Decimal("0"))
        discount_total = sum((line["discount"] for line in lines), Decimal("0"))
        after_discount = sum((line["after_discount"] for line in lines), Decimal("0"))
        vat_total = sum((line["vat"] for line in lines), Decimal("0"))
        invoice_total = sum((line["line_total"] for line in lines), Decimal("0")) + shipping_cost + other_costs
        if invoice_total <= 0:
            raise HTTPException(422, "الإجمالي النهائي يجب أن يكون أكبر من صفر")

        purchase_id = await _next_purchase_id()
        po_number = body.po_number.strip() if body.po_number else await next_seq_id(tx.purchases, "po_number", "po-", 4)
        doc = {
            "id": str(uuid.uuid4()), "purchase_id": purchase_id, "po_number": po_number,
            "purchase_date": body.purchase_date.strip(), "invoice_number": invoice_number,
            "invoice_date": body.invoice_date or body.purchase_date,
            "supplier_id": supplier["id"], "supplier_name": supplier["name"],
            "project_id": project["id"], "project_name": project["name"],
            "customer_id": customer["id"], "customer_name": customer["name"],
            "purchase_type": body.purchase_type, "currency": body.currency,
            "created_by": body.created_by, "payment_method": body.payment_method,
            "notes": body.notes, "shipping_cost": float(shipping_cost), "other_costs": float(other_costs),
            "subtotal": float(money(subtotal)), "discount_total": float(money(discount_total)),
            "after_discount": float(money(after_discount)), "vat_total": float(money(vat_total)),
            "invoice_total": float(money(invoice_total)), "payment_status": "غير مدفوع",
            "created_at": now_iso(),
        }
        await tx.purchases.insert_one(dict(doc))

        record_no = await next_record_no(tx.price_history)
        for calculated in lines:
            item = calculated["item"]
            line = calculated["input"]
            line_total = float(calculated["line_total"])
            await tx.purchase_items.insert_one({
                "id": str(uuid.uuid4()), "purchase_id": purchase_id,
                "item_id": item["id"], "item_code": item.get("code", ""), "item_name": item["name"],
                "product_name": item.get("product_name") or item["name"],
                "brand": item.get("brand", ""), "main_category": item.get("main_category", ""),
                "subcategory": item.get("subcategory", ""),
                "specifications": item.get("specifications") or item.get("specs", ""),
                "unit": calculated["unit"], "quantity": line.quantity, "unit_price": line.unit_price,
                "discount_pct": line.discount_pct, "vat_pct": line.vat_pct, "line_total": line_total,
            })
            await tx.price_history.insert_one({
                "id": str(uuid.uuid4()), "record_no": record_no, "date": body.purchase_date.strip(),
                "po_number": po_number, "invoice_number": invoice_number,
                "purchase_id": purchase_id,
                "item_code": item.get("code", ""), "item_name": item["name"],
                "product_name": item.get("product_name") or item["name"],
                "brand": item.get("brand", ""), "main_category": item.get("main_category", ""),
                "subcategory": item.get("subcategory", ""),
                "specifications": item.get("specifications") or item.get("specs", ""),
                "supplier": supplier["name"], "project": project["name"],
                "quantity": line.quantity, "unit": calculated["unit"], "unit_price": line.unit_price,
                "discount_pct": line.discount_pct, "vat_pct": line.vat_pct,
                "final_price": line_total, "employee": body.created_by or "",
            })
            record_no += 1
    return clean(doc)


@api.delete("/purchases/{purchase_id}")
async def delete_purchase(purchase_id: str, current_user: User = Depends(require_erp_role())):
    with db.transaction() as tx:
        pur = await tx.purchases.find_one({"purchase_id": purchase_id})
        if not pur:
            raise HTTPException(404, "عملية الشراء غير موجودة")
        history = await tx.price_history.find({}).to_list(100000)
        history_ids = [
            row["id"]
            for row in history
            if row.get("purchase_id") == purchase_id
            or (
                not row.get("purchase_id")
                and row.get("invoice_number") == pur["invoice_number"]
                and row.get("supplier") == pur["supplier_name"]
                and row.get("po_number") == pur.get("po_number")
            )
        ]
        await tx.purchase_items.delete_many({"purchase_id": purchase_id})
        await tx.payments.delete_many({"purchase_id": purchase_id})
        for history_id in history_ids:
            await tx.price_history.delete_one({"id": history_id})
        await tx.purchases.delete_one({"purchase_id": purchase_id})
    return {"ok": True}


# ---------------- Payments ----------------
class PaymentCreate(BaseModel):
    purchase_id: str
    payment_date: str
    amount_paid: float
    payment_method: Optional[str] = ""
    notes: Optional[str] = ""
    submission_token: Optional[str] = ""


@api.get("/payments")
async def list_payments(current_user: User = Depends(require_erp_role())):
    pays = [clean(d) for d in await db.payments.find({}).sort("payment_id", -1).to_list(100000)]
    purchases = {p["purchase_id"]: p for p in await db.purchases.find({}, {"_id": 0}).to_list(100000)}
    paid = await paid_amounts()
    for p in pays:
        p.pop("payment_request_key", None)
        pur = purchases.get(p["purchase_id"], {})
        p["invoice_number"] = pur.get("invoice_number", "")
        p["supplier_name"] = pur.get("supplier_name", "")
        p["invoice_total"] = pur.get("invoice_total", 0)
        p["remaining"] = round(max(0, pur.get("invoice_total", 0) - paid.get(p["purchase_id"], 0)), 2)
        p["payment_status"] = pur.get("payment_status", "")
    return pays


@api.post("/payments")
async def create_payment(body: PaymentCreate, current_user: User = Depends(require_erp_role())):
    if not body.payment_date.strip():
        raise HTTPException(422, "من فضلك أدخل تاريخ الدفع")
    amount_paid = require_finite(body.amount_paid, "المبلغ المدفوع غير صحيح")
    if amount_paid <= 0:
        raise HTTPException(422, "المبلغ المدفوع يجب أن يكون أكبر من صفر")
    amount_paid = money(amount_paid)
    token = (body.submission_token or "").strip()
    if token and not 8 <= len(token) <= 128:
        raise HTTPException(422, "رمز تأكيد الدفعة غير صحيح")
    request_key = hashlib.sha256(token.encode("utf-8")).hexdigest() if token else ""

    with db.transaction() as tx:
        pur = await tx.purchases.find_one({"purchase_id": body.purchase_id})
        if not pur:
            raise HTTPException(422, "من فضلك اختر عملية شراء صحيحة")
        purchase_payments = await tx.payments.find(
            {"purchase_id": body.purchase_id}
        ).to_list(100000)
        if request_key:
            existing = next(
                (
                    payment
                    for payment in purchase_payments
                    if payment.get("payment_request_key") == request_key
                ),
                None,
            )
            if existing:
                existing.pop("payment_request_key", None)
                existing["idempotent_replay"] = True
                return clean(existing)

        already = money(sum(Decimal(str(payment.get("amount_paid", 0))) for payment in purchase_payments))
        remaining = money(Decimal(str(pur["invoice_total"])) - already)
        if amount_paid > remaining:
            raise HTTPException(422, f"المبلغ المدفوع يتجاوز المتبقي على الفاتورة (المتبقي: {remaining})")
        payment_id = await _next_payment_id()
        doc = {
            "id": str(uuid.uuid4()), "payment_id": payment_id,
            "payment_date": body.payment_date.strip(), "purchase_id": body.purchase_id,
            "amount_paid": float(amount_paid), "payment_method": body.payment_method,
            "notes": body.notes, "created_at": now_iso(),
            "payment_request_key": request_key,
        }
        await tx.payments.insert_one(dict(doc))
        await recompute_payment_status(tx, body.purchase_id)
    doc.pop("payment_request_key", None)
    return clean(doc)


@api.delete("/payments/{payment_id}")
async def delete_payment(payment_id: str, current_user: User = Depends(require_erp_role())):
    with db.transaction() as tx:
        pay = await tx.payments.find_one({"id": payment_id})
        if not pay:
            raise HTTPException(404, "الدفعة غير موجودة")
        await tx.payments.delete_one({"id": payment_id})
        await recompute_payment_status(tx, pay["purchase_id"])
    return {"ok": True}


# ---------------- Price History ----------------
@api.get("/price-history")
async def list_price_history(current_user: User = Depends(require_erp_role())):
    return [clean(d) for d in await db.price_history.find({}).sort("record_no", -1).to_list(100000)]


@api.get("/supplier-price-history")
async def list_supplier_price_history(
    item: str = "",
    supplier: str = "",
    project: str = "",
    date_from: str = "",
    date_to: str = "",
    current_user: User = Depends(require_erp_role()),
):
    """Formal price intelligence sourced only from received supplier quotations."""
    del current_user  # Authentication/RBAC dependency is intentional.
    with SessionLocal() as session:
        statement = (
            select(
                SupplierQuotationLine,
                SupplierQuotation,
                RequestForQuotation,
                RFQItem,
                Item,
                IncomingPurchaseRequestItem,
            )
            .join(
                SupplierQuotation,
                SupplierQuotation.id == SupplierQuotationLine.quotation_id,
            )
            .join(RequestForQuotation, RequestForQuotation.id == SupplierQuotation.rfq_id)
            .outerjoin(RFQItem, RFQItem.id == SupplierQuotationLine.rfq_item_id)
            .outerjoin(Item, Item.id == RFQItem.item_id)
            .outerjoin(
                IncomingPurchaseRequestItem,
                IncomingPurchaseRequestItem.id == SupplierQuotationLine.source_request_item_id,
            )
            .where(SupplierQuotation.status == "received")
            .order_by(
                SupplierQuotation.quotation_date.desc(),
                SupplierQuotation.updated_at.desc(),
                SupplierQuotationLine.position,
            )
        )
        records = session.execute(statement).all()
        source_request_ids = {rfq.source_request_id for _, _, rfq, _, _, _ in records}
        comparisons = session.scalars(
            select(PriceComparison)
            .where(PriceComparison.source_request_id.in_(source_request_ids))
            .order_by(PriceComparison.created_at.desc())
        ).all() if source_request_ids else []
        comparison_by_request = {}
        for comparison in comparisons:
            comparison_by_request.setdefault(comparison.source_request_id, comparison)

        normalized_item = item.strip().casefold()
        normalized_supplier = supplier.strip().casefold()
        normalized_project = project.strip().casefold()
        result = []
        for line, quotation, rfq, rfq_item, master_item, request_item in records:
            item_code = master_item.code if master_item else ""
            product_name = line.product_name or (rfq_item.product_name if rfq_item else "")
            if normalized_item and normalized_item not in f"{item_code} {product_name}".casefold():
                continue
            if normalized_supplier and normalized_supplier not in quotation.supplier_name.casefold():
                continue
            if normalized_project and normalized_project not in rfq.project_name.casefold():
                continue
            quotation_date = quotation.quotation_date or quotation.created_at[:10]
            if date_from and quotation_date < date_from:
                continue
            if date_to and quotation_date > date_to:
                continue

            unit_price = float(line.unit_price or 0)
            adjusted_unit_price = round(
                unit_price
                * (1 - float(line.discount_pct or 0) / 100)
                * (1 + float(line.tax_pct or 0) / 100),
                2,
            )
            comparison = comparison_by_request.get(rfq.source_request_id)
            result.append({
                "id": line.id,
                "date": quotation_date,
                "item_id": master_item.id if master_item else (rfq_item.item_id if rfq_item else ""),
                "item_code": item_code,
                "item_name": product_name,
                "main_category": request_item.main_category if request_item else "",
                "subcategory": request_item.subcategory if request_item else "",
                "supplier_id": quotation.supplier_id or "",
                "supplier": quotation.supplier_name,
                "project_id": rfq.project_id or "",
                "project": rfq.project_name,
                "quantity": line.quantity,
                "unit": line.unit,
                "unit_price": unit_price,
                "discount_pct": line.discount_pct,
                "tax_pct": line.tax_pct,
                "adjusted_unit_price": adjusted_unit_price,
                "line_total": round(adjusted_unit_price * float(line.quantity or 0), 2),
                "availability": line.availability,
                "quotation_id": quotation.id,
                "quotation_ref": quotation.quotation_ref,
                "currency": quotation.currency,
                "rfq_id": rfq.id,
                "rfq_number": rfq.rfq_number,
                "comparison_id": comparison.id if comparison else "",
                "comparison_number": comparison.comparison_number if comparison else "",
            })
        return result


# ---------------- Settings ----------------
class SettingsUpdate(BaseModel):
    values: List


@api.get("/settings")
async def get_settings(current_user: User = Depends(require_erp_role("admin"))):
    return [clean(d) for d in await db.settings.find({}).to_list(1000)]


@api.put("/settings/{key}")
async def update_settings(key: str, body: SettingsUpdate, current_user: User = Depends(require_erp_role("admin"))):
    res = await db.settings.update_one({"key": key}, {"$set": {"values": body.values}})
    if res.matched_count == 0:
        raise HTTPException(404, "القائمة غير موجودة")
    return clean(await db.settings.find_one({"key": key}))


@api.get("/system/diagnostics")
async def system_diagnostics(current_user: User = Depends(require_erp_role("admin"))):
    paths = _runtime_paths()
    last_backup = None
    last_backup_file = paths["backups"] / "last-successful-backup.json"
    if last_backup_file.is_file():
        try:
            stored = json.loads(last_backup_file.read_text(encoding="utf-8-sig"))
            last_backup = {
                "created_utc": stored.get("created_utc"),
                "attachment_count": stored.get("attachment_count", 0),
            }
        except (OSError, ValueError, TypeError):
            last_backup = {"status": "unreadable"}
    return {
        "version": APP_VERSION,
        "mode": "installed" if os.getenv("PROCUREX_DATA_ROOT", "").strip() else "development",
        "database": _database_health(paths["database"]),
        "paths": {key: str(value) for key, value in paths.items()},
        "last_backup": last_backup,
    }


@api.post("/system/backup")
async def create_system_backup(current_user: User = Depends(require_erp_role("admin"))):
    try:
        return _create_verified_runtime_backup()
    except HTTPException:
        raise
    except Exception:
        logger.exception("Verified settings backup failed")
        raise HTTPException(500, "تعذر إنشاء النسخة الاحتياطية. راجع السجلات المحلية.")


@api.post("/system/open-folder/{kind}")
async def open_system_folder(
    kind: str, request: Request, current_user: User = Depends(require_erp_role("admin")),
):
    if request.client and request.client.host not in {"127.0.0.1", "::1", "testclient"}:
        raise HTTPException(403, "هذا الإجراء متاح محلياً فقط")
    paths = _runtime_paths()
    if kind not in {"data", "backups", "logs"}:
        raise HTTPException(404, "المجلد المطلوب غير معروف")
    path = paths[kind]
    path.mkdir(parents=True, exist_ok=True)
    if os.name != "nt":
        raise HTTPException(409, "فتح المجلد متاح في نسخة Windows فقط")
    os.startfile(path)  # type: ignore[attr-defined]
    return {"ok": True}


# ---------------- Dashboard ----------------
# Sprint 3.6: formal procurement workflow data is the primary dashboard
# source. Legacy Direct Purchase figures (total_purchases/total_paid/
# total_outstanding/by_supplier/by_project/monthly/payment_status below)
# stay for backward compatibility but must never feed the formal KPIs -
# see PO_STATUS_LABELS/_dashboard_procurement_intelligence for the formal
# side, which reuses the exact PO Payment Ledger helpers (Sprint 3.4) and
# receiving lifecycle data (Sprint 3.5) so figures always agree with the
# PO detail page.
PO_STATUS_LABELS = {
    "draft": "مسودة", "approved": "معتمد", "sent": "تم الإرسال للمورد",
    "supplier_confirmed": "تأكيد المورد", "in_delivery": "قيد التوريد",
    "partial_received": "استلام جزئي", "delivery_problem": "مشكلة في التوريد",
    "completed": "مكتمل", "cancelled": "ملغي",
}
PO_STATUS_GROUPS = (
    ("awaiting_issue", "بانتظار الإصدار", {"draft", "approved"}),
    ("awaiting_supplier", "بانتظار تأكيد المورد", {"sent", "supplier_confirmed"}),
    ("under_delivery", "قيد التوريد", {"in_delivery"}),
    ("partial_receipt", "استلام جزئي", {"partial_received"}),
    ("delivery_problem", "مشكلة توريد", {"delivery_problem"}),
    ("completed", "مكتمل", {"completed"}),
)
PO_PAYMENT_STATUS_LABELS = {
    "unpaid": "غير مدفوع",
    "not_due": "لم يحن السداد", "due": "مستحق السداد",
    "partially_paid": "مدفوع جزئيًا", "paid": "مدفوع بالكامل",
}


def _dashboard_days_overdue(due_date: str, today: str) -> Optional[int]:
    if not due_date:
        return None
    try:
        delta = (datetime.strptime(today, "%Y-%m-%d") - datetime.strptime(due_date, "%Y-%m-%d")).days
    except ValueError:
        return None
    return max(delta, 0)


ATTENTION_TYPE_ROLE_OWNERS = {
    # Technical review of incoming requests is the engineer's job - matches
    # require_erp_role("procurement_engineer") on /items/{id}/review.
    "needs_clarification": "procurement_engineer",
    "request_review": "procurement_engineer",
    # Sourcing/RFQ/PO/receiving is procurement_responsible's domain - matches
    # require_erp_role("procurement_responsible") on RFQ creation, PO
    # creation, and item-master conversion.
    "sourcing_required": "procurement_responsible",
    "rfq_past_deadline": "procurement_responsible",
    "quotation_missing": "procurement_responsible",
    "awaiting_supplier_confirmation": "procurement_responsible",
    "partial_received": "procurement_responsible",
    "delivery_problem": "procurement_responsible",
    # Payments are the commercial manager's domain - matches
    # require_erp_role("commercial_manager") on PO payment recording/void.
    "overdue_payment": "commercial_manager",
    # pending_approval has no single fixed owner - it is set per item below
    # from that specific approval's own responsible_role column.
}


async def _dashboard_procurement_intelligence(
    session, requests, comparisons, approvals, procurement_kpis: dict,
    viewer_role: str = "",
) -> dict:
    today = datetime.now(timezone.utc).date().isoformat()

    orders = [clean(o) for o in await db.purchase_orders.find({}, {"_id": 0}).to_list(100000)]
    order_items = [clean(i) for i in await db.purchase_order_items.find({}, {"_id": 0}).to_list(200000)]
    items_by_order: dict = {}
    for item in order_items:
        items_by_order.setdefault(item.get("purchase_order_id"), []).append(item)
    active_orders = [o for o in orders if o.get("status") != "cancelled"]
    order_ids = [o["id"] for o in orders]

    paid_by_order: dict = {}
    if order_ids:
        for payment in session.scalars(
            select(PurchaseOrderPayment).where(
                PurchaseOrderPayment.purchase_order_id.in_(order_ids),
                PurchaseOrderPayment.status == "recorded",
            )
        ).all():
            paid_by_order[payment.purchase_order_id] = (
                paid_by_order.get(payment.purchase_order_id, Decimal("0"))
                + Decimal(str(payment.amount))
            )
    payment_summaries = {
        order["id"]: _po_payment_summary_from_paid(order, money(paid_by_order.get(order["id"], Decimal("0"))))
        for order in active_orders
    }

    receipts = session.scalars(select(PurchaseOrderReceipt)).all() if order_ids else []
    receipts_by_order: dict = {}
    for receipt in receipts:
        receipts_by_order.setdefault(receipt.purchase_order_id, []).append(receipt)
    receipt_ids = [r.id for r in receipts]
    receipt_lines = session.scalars(
        select(PurchaseOrderReceiptLine).where(PurchaseOrderReceiptLine.receipt_id.in_(receipt_ids))
    ).all() if receipt_ids else []
    lines_by_receipt: dict = {}
    for line in receipt_lines:
        lines_by_receipt.setdefault(line.receipt_id, []).append(line)

    # ---- 7. Purchase Order status distribution ----
    by_status: dict = {}
    for order in orders:
        bucket = by_status.setdefault(order.get("status", ""), {"count": 0, "value": 0.0})
        bucket["count"] += 1
        bucket["value"] += float(order.get("final_total") or 0)
    po_by_status = [
        {"status": key, "label": PO_STATUS_LABELS.get(key, key), "count": val["count"], "value": round(val["value"], 2)}
        for key, val in by_status.items()
    ]
    po_grouped = [
        {
            "key": key, "label": label,
            "count": sum(v["count"] for k, v in by_status.items() if k in statuses),
            "value": round(sum(v["value"] for k, v in by_status.items() if k in statuses), 2),
        }
        for key, label, statuses in PO_STATUS_GROUPS
    ]

    # ---- 8/9. Payment intelligence (active orders only, same helper as the
    # PO Payment Ledger - see server.py's /purchase-orders/{id}/payments) ----
    actual_paid = sum((Decimal(str(s["paid_amount"])) for s in payment_summaries.values()), Decimal("0"))
    outstanding = sum((Decimal(str(s["outstanding_amount"])) for s in payment_summaries.values()), Decimal("0"))
    overdue_outstanding = sum(
        (Decimal(str(s["outstanding_amount"])) for s in payment_summaries.values() if s["is_overdue"]), Decimal("0"),
    )
    payment_status_dist: dict = {}
    for summary in payment_summaries.values():
        bucket = payment_status_dist.setdefault(summary["payment_status"], {"count": 0, "value": 0.0})
        bucket["count"] += 1
        bucket["value"] += summary["po_total"]
    payment_status_distribution = [
        {"status": key, "label": PO_PAYMENT_STATUS_LABELS.get(key, key), "count": val["count"], "value": round(val["value"], 2)}
        for key, val in payment_status_dist.items()
    ]

    orders_by_id = {o["id"]: o for o in active_orders}
    payment_attention = []
    for order_id, summary in payment_summaries.items():
        if summary["payment_status"] not in {"due", "partially_paid"} and not summary["is_overdue"]:
            continue
        order = orders_by_id[order_id]
        days_overdue = _dashboard_days_overdue(summary["due_date"], today) if summary["is_overdue"] else None
        payment_attention.append({
            "purchase_order_id": order_id, "po_number": order.get("po_number", ""),
            "project_name": order.get("project_name", ""), "supplier_name": order.get("supplier_name", ""),
            "po_total": summary["po_total"], "paid_amount": summary["paid_amount"],
            "outstanding_amount": summary["outstanding_amount"], "due_date": summary["due_date"],
            "payment_status": summary["payment_status"], "is_overdue": summary["is_overdue"],
            "days_overdue": days_overdue,
        })
    payment_attention.sort(key=lambda row: (
        0 if row["is_overdue"] else 1, -(row["days_overdue"] or 0), row["due_date"] or "9999-99-99",
    ))
    payment_attention = payment_attention[:15]

    # ---- 10/11. Receiving intelligence - "N of M item lines received"
    # rather than a cross-unit quantity total (units may differ per line) ----
    receiving_counts = {
        "in_delivery_count": sum(1 for o in active_orders if o.get("status") == "in_delivery"),
        "partial_received_count": sum(1 for o in active_orders if o.get("status") == "partial_received"),
        "delivery_problem_count": sum(1 for o in active_orders if o.get("status") == "delivery_problem"),
        "completed_count": sum(1 for o in active_orders if o.get("status") == "completed"),
    }
    delivery_attention = []
    for order in active_orders:
        if order.get("status") not in {"delivery_problem", "partial_received", "in_delivery"}:
            continue
        order_receipts = sorted(receipts_by_order.get(order["id"], []), key=lambda r: r.received_at, reverse=True)
        successful_ids = {r.id for r in order_receipts if r.receipt_type in {"full", "partial"}}
        received_by_item: dict = {}
        for receipt in order_receipts:
            if receipt.id not in successful_ids:
                continue
            for line in lines_by_receipt.get(receipt.id, []):
                received_by_item[line.purchase_order_item_id] = (
                    received_by_item.get(line.purchase_order_item_id, 0.0) + float(line.received_quantity or 0)
                )
        order_lines = items_by_order.get(order["id"], [])
        fully_received_lines = sum(
            1 for line in order_lines
            if received_by_item.get(line.get("id"), 0.0) >= float(line.get("quantity") or 0) - 1e-6
        )
        delivery_attention.append({
            "purchase_order_id": order["id"], "po_number": order.get("po_number", ""),
            "project_name": order.get("project_name", ""), "supplier_name": order.get("supplier_name", ""),
            "status": order.get("status", ""),
            "received_lines": fully_received_lines, "total_lines": len(order_lines),
            "last_receipt_date": order_receipts[0].received_at if order_receipts else None,
        })
    delivery_priority = {"delivery_problem": 0, "partial_received": 1, "in_delivery": 2}
    delivery_attention.sort(key=lambda row: delivery_priority.get(row["status"], 9))
    delivery_attention = delivery_attention[:15]

    # ---- 12/13. Project procurement summary - formal PO totals only,
    # legacy Direct Purchase totals are never merged in here ----
    projects: dict = {}

    def _project_bucket(project_id: str, project_name: str) -> dict:
        return projects.setdefault(project_id, {
            "project_id": project_id, "project_name": project_name,
            "active_requests": 0, "formal_po_value": 0.0, "actual_paid": 0.0,
            "outstanding": 0.0, "active_po_count": 0, "completed_po_count": 0,
            "delivery_problem_count": 0,
        })

    for row in requests:
        if not row.project_id:
            continue
        bucket = _project_bucket(row.project_id, row.project_name)
        if row.status not in {"rejected", "cancelled", "completed"}:
            bucket["active_requests"] += 1
    for order in active_orders:
        project_id = order.get("project_id") or ""
        if not project_id:
            continue
        bucket = _project_bucket(project_id, order.get("project_name", ""))
        bucket["formal_po_value"] += float(order.get("final_total") or 0)
        summary = payment_summaries.get(order["id"])
        if summary:
            bucket["actual_paid"] += summary["paid_amount"]
            bucket["outstanding"] += summary["outstanding_amount"]
        if order.get("status") == "completed":
            bucket["completed_po_count"] += 1
        else:
            bucket["active_po_count"] += 1
        if order.get("status") == "delivery_problem":
            bucket["delivery_problem_count"] += 1
    project_summary = sorted((
        {**bucket, "formal_po_value": round(bucket["formal_po_value"], 2),
         "actual_paid": round(bucket["actual_paid"], 2), "outstanding": round(bucket["outstanding"], 2)}
        for bucket in projects.values()
    ), key=lambda row: -row["formal_po_value"])[:15]

    # ---- 5. RFQ / sourcing attention ----
    requests_by_id = {row.id: row for row in requests}
    rfqs = session.scalars(select(RequestForQuotation)).all()
    rfq_ids = [rfq.id for rfq in rfqs]
    supplier_counts, quotation_received = {}, {}
    if rfq_ids:
        for rfq_id, count in session.execute(
            select(RFQSupplier.rfq_id, func.count()).where(RFQSupplier.rfq_id.in_(rfq_ids)).group_by(RFQSupplier.rfq_id)
        ).all():
            supplier_counts[rfq_id] = count
        for rfq_id, status, count in session.execute(
            select(SupplierQuotation.rfq_id, SupplierQuotation.status, func.count())
            .where(SupplierQuotation.rfq_id.in_(rfq_ids)).group_by(SupplierQuotation.rfq_id, SupplierQuotation.status)
        ).all():
            if status == "received":
                quotation_received[rfq_id] = quotation_received.get(rfq_id, 0) + count

    open_count = zero_response = partial_response = all_received = past_deadline = 0
    sourcing_attention = []
    for rfq in rfqs:
        supplier_count = supplier_counts.get(rfq.id, 0)
        received = quotation_received.get(rfq.id, 0)
        source_request = requests_by_id.get(rfq.source_request_id)
        is_open = bool(source_request and source_request.status == "pricing")
        open_count += int(is_open)
        zero_response += int(supplier_count > 0 and received == 0)
        partial_response += int(0 < received < supplier_count)
        all_received += int(supplier_count > 0 and received == supplier_count)
        is_past_deadline = bool(rfq.deadline and rfq.deadline < today and received < supplier_count)
        past_deadline += int(is_past_deadline)
        if is_open and (supplier_count == 0 or received < supplier_count or is_past_deadline):
            reason = (
                "لم يتم اختيار موردين" if supplier_count == 0 else
                "تجاوز الموعد النهائي" if is_past_deadline else
                "لم يصل أي عرض سعر" if received == 0 else
                "ردود جزئية من الموردين"
            )
            sourcing_attention.append({
                "rfq_id": rfq.id, "rfq_number": rfq.rfq_number, "project_name": rfq.project_name,
                "supplier_count": supplier_count, "received_count": received,
                "deadline": rfq.deadline or None, "reason": reason,
            })
    # Most urgent first (past-deadline, then no response, then partial),
    # then soonest/oldest deadline - insertion order alone would let an
    # arbitrary older entry starve a genuinely urgent one out of the cap.
    sourcing_reason_priority = {
        "تجاوز الموعد النهائي": 0, "لم يتم اختيار موردين": 1,
        "لم يصل أي عرض سعر": 2, "ردود جزئية من الموردين": 3,
    }
    sourcing_attention.sort(
        key=lambda row: (sourcing_reason_priority.get(row["reason"], 9), row["deadline"] or "9999-99-99"),
    )
    sourcing_attention = sourcing_attention[:10]
    requests_with_rfq = {rfq.source_request_id for rfq in rfqs}
    requests_ready_for_sourcing = [
        row for row in requests
        if row.status == "pricing" and row.id not in requests_with_rfq
    ]

    # ---- 6. Approval attention (same filters as _workflow_action_counts,
    # value totals added; no bucket double-counts an approval) ----
    ordered_approval_ids = {o.get("approval_id") for o in orders if o.get("approval_id")}
    stage_definitions = (
        ("comparison_approval", "اعتماد المقارنة (فني)", APPROVAL_STAGE_COMPARISON_TECHNICAL, "pending_approval"),
        ("fund_approval", "اعتماد الصرف التجاري", APPROVAL_STAGE_EXPENDITURE_APPROVAL, "pending_approval"),
        ("funds_release", "تأكيد إتاحة المبلغ", APPROVAL_STAGE_FUNDS_AVAILABILITY, "pending_approval"),
    )
    approval_stage_summary = []
    for key, label, stage, status in stage_definitions:
        rows = [a for a in approvals if a.approval_type == "comparison_workflow" and a.status == status and a.approval_stage == stage]
        approval_stage_summary.append({
            "key": key, "label": label, "count": len(rows),
            "value": round(sum(float(a.final_total or 0) for a in rows), 2),
        })
    ready_for_po_rows = [
        a for a in approvals
        if a.approval_type == "comparison_workflow" and a.status == "approved"
        and a.approval_stage == APPROVAL_STAGE_PO_READY and a.id not in ordered_approval_ids
    ]
    approval_stage_summary.append({
        "key": "ready_for_po", "label": "جاهز لإصدار أمر شراء", "count": len(ready_for_po_rows),
        "value": round(sum(float(a.final_total or 0) for a in ready_for_po_rows), 2),
    })

    # ---- 14. Consolidated follow-up/attention center, priority ordered ----
    attention_items = []
    for row in delivery_attention:
        if row["status"] == "delivery_problem":
            attention_items.append({
                "type": "delivery_problem", "reference": row["po_number"], "project_name": row["project_name"],
                "reason": "مشكلة في التوريد", "due_or_age": row["last_receipt_date"],
                "path": f"/purchase-orders/{row['purchase_order_id']}",
            })
    for row in payment_attention:
        if row["is_overdue"]:
            reason = f"متأخر السداد {row['days_overdue']} يوم" if row["days_overdue"] else "متأخر السداد"
            attention_items.append({
                "type": "overdue_payment", "reference": row["po_number"], "project_name": row["project_name"],
                "reason": reason, "due_or_age": row["due_date"], "path": f"/purchase-orders/{row['purchase_order_id']}",
            })
    for row in sourcing_attention:
        attention_items.append({
            "type": "rfq_past_deadline" if row["reason"] == "تجاوز الموعد النهائي" else "quotation_missing",
            "reference": row["rfq_number"], "project_name": row["project_name"],
            "reason": row["reason"], "due_or_age": row["deadline"],
            "path": f"/rfq/{row['rfq_id']}",
        })
    for request_row in sorted(requests_ready_for_sourcing, key=lambda row: row.updated_at):
        attention_items.append({
            "type": "sourcing_required", "reference": request_row.request_number,
            "project_name": request_row.project_name,
            "reason": "أصناف معتمدة جاهزة لإنشاء طلب تسعير ومقارنة",
            "due_or_age": request_row.updated_at, "path": "/incoming-requests",
            "responsible_role": "procurement_responsible",
        })
    pending_approvals = [
        approval for approval in approvals
        if approval.approval_type == "comparison_workflow"
        and approval.status == "pending_approval"
    ]
    for approval in sorted(pending_approvals, key=lambda row: row.created_at)[:8]:
        attention_items.append({
            "type": "pending_approval", "reference": approval.approval_number,
            "project_name": approval.project_name,
            "reason": "اعتماد معلق يحتاج قرارًا",
            "due_or_age": approval.created_at, "path": "/approvals",
            "responsible_role": approval.responsible_role,
        })
    for order in active_orders:
        if order.get("status") == "sent":
            attention_items.append({
                "type": "awaiting_supplier_confirmation", "reference": order.get("po_number", ""),
                "project_name": order.get("project_name", ""), "reason": "بانتظار تأكيد المورد",
                "due_or_age": order.get("po_date"), "path": f"/purchase-orders/{order['id']}",
            })
    for row in delivery_attention:
        if row["status"] == "partial_received":
            attention_items.append({
                "type": "partial_received", "reference": row["po_number"], "project_name": row["project_name"],
                "reason": f"{row['received_lines']} من {row['total_lines']} بنود مستلمة",
                "due_or_age": row["last_receipt_date"], "path": f"/purchase-orders/{row['purchase_order_id']}",
            })
    for request_row in requests:
        if request_row.status == "need_clarification":
            attention_items.append({
                "type": "needs_clarification",
                "reference": request_row.request_number,
                "project_name": request_row.project_name,
                "reason": "بانتظار استكمال التوضيح المطلوب",
                "due_or_age": request_row.updated_at,
                "path": "/incoming-requests",
            })
        elif request_row.status in {"new", "under_review"}:
            attention_items.append({
                "type": "request_review",
                "reference": request_row.request_number,
                "project_name": request_row.project_name,
                "reason": "طلب شراء يحتاج مراجعة فنية" if request_row.status == "new" else "مراجعة فنية قيد الإجراء",
                "due_or_age": request_row.updated_at,
                "path": "/incoming-requests",
            })
    for item in attention_items:
        item.setdefault("responsible_role", ATTENTION_TYPE_ROLE_OWNERS.get(item["type"], ""))

    # Admin sees the full action center; every other role sees only the
    # items owned by their own workflow responsibility (existing RBAC roles
    # above), not a generic shared list. Summary KPIs elsewhere are never
    # filtered - only this action-center list is role-scoped.
    if viewer_role and viewer_role != "admin":
        attention_items = [item for item in attention_items if item["responsible_role"] == viewer_role]

    attention_items = attention_items[:20]

    active_po_count = sum(1 for o in active_orders if o.get("status") != "completed")
    active_requests_count = sum(1 for row in requests if row.status not in {"rejected", "cancelled", "completed"})
    summary = {
        "active_requests": active_requests_count,
        "requests_requiring_action": sum(
            1 for row in requests
            if row.status in {"new", "under_review", "need_clarification", "hold"}
        ) + len(requests_ready_for_sourcing),
        "active_purchase_orders": active_po_count,
        "formal_po_value": procurement_kpis["formal_po_total"],
        "actual_paid": round(float(actual_paid), 2),
        "outstanding": round(float(outstanding), 2),
        "overdue_amount": round(float(overdue_outstanding), 2),
    }

    return {
        "summary": summary,
        "request_pipeline": request_pipeline_summary(requests),
        "procurement_funnel": {
            "request_count": len(requests), "rfq_count": len(rfqs),
            "comparison_count": len(comparisons), "approval_count": len(approvals),
            "formal_po_count": procurement_kpis["formal_po_count"],
            "formal_completed_po_count": procurement_kpis["formal_completed_po_count"],
        },
        "sourcing": {
            "rfq_count": len(rfqs), "open_rfq_count": open_count,
            "zero_response_count": zero_response, "partial_response_count": partial_response,
            "all_received_count": all_received, "past_deadline_count": past_deadline,
            "attention": sourcing_attention,
        },
        "approval_attention": {"stages": approval_stage_summary},
        "purchase_order_status": {"by_status": po_by_status, "grouped": po_grouped},
        "payment_intelligence": {
            "total_formal_po_value": summary["formal_po_value"], "actual_paid": summary["actual_paid"],
            "outstanding": summary["outstanding"], "overdue_outstanding": summary["overdue_amount"],
            "status_distribution": payment_status_distribution, "attention": payment_attention,
        },
        "receiving": {**receiving_counts, "attention": delivery_attention},
        "project_procurement_summary": project_summary,
        "attention_items": attention_items,
    }


@api.get("/dashboard")
async def dashboard(current_user: User = Depends(require_erp_role())):
    purchases = await db.purchases.find({}, {"_id": 0}).to_list(100000)
    paid = await paid_amounts()
    total_purchases = sum(p.get("invoice_total", 0) for p in purchases)
    total_paid = sum(paid.values())
    total_outstanding = sum(max(0, p.get("invoice_total", 0) - paid.get(p["purchase_id"], 0)) for p in purchases)

    by_supplier, by_project, monthly, status_dist = {}, {}, {}, {}
    for p in purchases:
        t = p.get("invoice_total", 0)
        by_supplier[p.get("supplier_name", "")] = by_supplier.get(p.get("supplier_name", ""), 0) + t
        by_project[p.get("project_name", "")] = by_project.get(p.get("project_name", ""), 0) + t
        month = (p.get("purchase_date") or "")[:7]
        if month:
            monthly[month] = monthly.get(month, 0) + t
        st = p.get("payment_status", "غير مدفوع")
        status_dist.setdefault(st, {"count": 0, "total": 0})
        status_dist[st]["count"] += 1
        status_dist[st]["total"] += t

    with SessionLocal() as session:
        requests = session.scalars(select(IncomingPurchaseRequest)).all()
        comparisons = session.scalars(select(PriceComparison)).all()
        approvals = session.scalars(select(EngineerApproval)).all()
        procurement_kpis = calculate_procurement_kpis(
            requests=requests,
            comparisons=comparisons,
            approvals=approvals,
            purchase_orders=session.scalars(select(PurchaseOrder)).all(),
            purchases=session.scalars(select(Purchase)).all(),
            direct_payments=session.scalars(select(Payment)).all(),
            approval_payments=session.scalars(select(ApprovalPayment)).all(),
        )
        formal_intelligence = await _dashboard_procurement_intelligence(
            session, requests, comparisons, approvals, procurement_kpis,
            viewer_role=current_user.role,
        )

    return {
        **procurement_kpis,
        **formal_intelligence,
        "total_purchases": round(total_purchases, 2),
        "purchase_count": len(purchases),
        "supplier_count": await db.suppliers.count_documents({}),
        "item_count": await db.items.count_documents({}),
        "total_paid": round(total_paid, 2),
        "total_outstanding": round(total_outstanding, 2),
        "project_count": await db.projects.count_documents({}),
        "customer_count": await db.customers.count_documents({}),
        "by_supplier": sorted([{"name": k, "total": round(v, 2)} for k, v in by_supplier.items()],
                              key=lambda x: -x["total"])[:10],
        "by_project": sorted([{"name": k, "total": round(v, 2)} for k, v in by_project.items()],
                             key=lambda x: -x["total"])[:10],
        "monthly": sorted([{"month": k, "total": round(v, 2)} for k, v in monthly.items()],
                          key=lambda x: x["month"]),
        "payment_status": [{"status": k, "count": v["count"], "total": round(v["total"], 2)}
                           for k, v in status_dist.items()],
    }


# ---------------- Excel import / export ----------------
@api.get("/export/excel")
async def export_excel(current_user: User = Depends(require_erp_role())):
    data = await build_export_workbook(db)
    filename = f"RE_DECOR_Procurement_ERP_{datetime.now().strftime('%Y%m%d_%H%M')}.xlsx"
    return Response(content=data,
                    media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                    headers={"Content-Disposition": f"attachment; filename={filename}"})


@api.post("/import/excel")
async def import_excel(file: UploadFile = File(...), current_user: User = Depends(require_erp_role())):
    if not file.filename.lower().endswith((".xlsx", ".xlsm")):
        raise HTTPException(422, "من فضلك ارفع ملف Excel بصيغة xlsx أو xlsm")
    content = await file.read()
    try:
        parsed = parse_workbook(content)
    except Exception:
        raise HTTPException(422, "تعذر قراءة الملف، تأكد من أنه ملف Excel صحيح")
    counts = await import_data(db, parsed)
    return {"imported": counts}


@api.get("/")
async def root():
    return {"message": "RE DECOR & MORE Procurement ERP API"}


def _csv_environment(name: str, default: str = "") -> list[str]:
    return [value.strip() for value in os.getenv(name, default).split(",") if value.strip()]


def _validate_hosted_configuration(surface: str) -> None:
    """Fail fast at startup rather than serving a misconfigured staging/
    production instance. Both hosted surfaces share the baseline hardening
    checks below; APP_SURFACE=full additionally requires the internal-access
    fallback to never substitute for real ERP authentication, and
    APP_SURFACE=public additionally requires PostgreSQL and private S3-
    compatible attachment storage.

    What this function cannot verify from inside the running process: that
    the backend is actually bound to a private/loopback interface (e.g.
    127.0.0.1) with only a reverse proxy exposed publicly, and that HTTPS is
    actually terminated in front of it. Those are operational requirements
    enforced by the deployment itself (systemd unit / proxy config /
    firewall), not by application code.
    """
    environment = os.getenv("APP_ENV", "development").strip().lower()
    if environment not in {"staging", "production"}:
        return
    label = "Production" if environment == "production" else "Staging"
    if surface not in {"full", "public"}:
        raise RuntimeError(f"{label} startup requires APP_SURFACE to be 'full' or 'public'")

    origins = _csv_environment("CORS_ORIGINS")
    hosts = _csv_environment("TRUSTED_HOSTS")
    if not origins or "*" in origins or any(not origin.startswith("https://") for origin in origins):
        raise RuntimeError(f"{label} CORS_ORIGINS must be an explicit HTTPS allowlist")
    if not hosts or any("*" in host or "://" in host or "/" in host for host in hosts):
        raise RuntimeError(f"{label} TRUSTED_HOSTS must be an explicit hostname allowlist")
    if os.getenv("FORCE_HTTPS", "").strip().lower() != "true":
        raise RuntimeError(f"{label} FORCE_HTTPS must be true")
    if len(os.getenv("AUTH_SECRET_KEY", "")) < 32:
        raise RuntimeError(f"{label} AUTH_SECRET_KEY must contain at least 32 characters")

    if surface == "full":
        # Formal ERP routes are protected by per-user JWT + role checks
        # (require_erp_role); require_internal_access's shared-token-or-
        # localhost gate is defense-in-depth only and must never be the sole
        # gate. Behind a reverse proxy, blindly trusting forwarded headers
        # for that gate's "is this localhost" fallback would make it
        # spoofable from the internet, so trusting proxy headers in
        # production requires an explicit shared token instead of relying
        # on the IP fallback.
        if (
            os.getenv("TRUST_PROXY_HEADERS", "").strip().lower() == "true"
            and not os.getenv("INTERNAL_REQUEST_TOKEN", "").strip()
        ):
            raise RuntimeError(
                f"{label} full-surface deployments that trust proxy headers must set "
                "INTERNAL_REQUEST_TOKEN instead of relying on the spoofable localhost fallback"
            )
        return

    # surface == "public"
    if len(os.getenv("REQUEST_PRIVACY_SALT", "")) < 32:
        raise RuntimeError(f"{label} REQUEST_PRIVACY_SALT must contain at least 32 characters")
    if not os.getenv("DATABASE_URL", "").startswith(
        ("postgres://", "postgresql://", "postgresql+psycopg://")
    ):
        raise RuntimeError(f"{label} DATABASE_URL must use PostgreSQL")
    if os.getenv("ATTACHMENT_STORAGE_BACKEND", "").lower() != "s3":
        raise RuntimeError(f"{label} attachments must use private S3-compatible storage")
    missing_r2 = [name for name in (
        "R2_ENDPOINT_URL", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_BUCKET_NAME",
    ) if not os.getenv(name, "").strip()]
    if missing_r2:
        raise RuntimeError(f"Missing {environment} R2 settings: {', '.join(missing_r2)}")
    if not os.getenv("R2_ENDPOINT_URL", "").strip().startswith("https://"):
        raise RuntimeError(f"{label} R2_ENDPOINT_URL must use HTTPS")


def create_app(surface: Optional[str] = None, initialize_database: bool = True) -> FastAPI:
    environment = os.getenv("APP_ENV", "development").strip().lower()
    if environment not in {"development", "test", "testing", "staging", "production"}:
        raise RuntimeError(
            "APP_ENV must be development, test, testing, staging, or production"
        )
    selected_surface = (surface or os.getenv("APP_SURFACE", "full")).strip().lower()
    if selected_surface not in {"full", "public"}:
        raise RuntimeError("APP_SURFACE must be 'full' or 'public'")
    _validate_hosted_configuration(selected_surface)
    if initialize_database:
        init_db()

    is_public = selected_surface == "public"
    application = FastAPI(
        title="RE DECOR & MORE Purchase Request API" if is_public else "RE DECOR & MORE Procurement ERP",
        docs_url=None if is_public else "/docs",
        redoc_url=None if is_public else "/redoc",
        openapi_url=None if is_public else "/openapi.json",
    )
    application.include_router(auth_router)
    if is_public:
        application.include_router(public_router)
        application.include_router(public_document_router)
        application.include_router(public_approval_router)
    else:
        application.include_router(admin_users_router)
        application.include_router(portal_router)
        application.include_router(api)
        application.include_router(price_comparison_router, prefix="/api")
        application.include_router(public_router)
        application.include_router(internal_router)
        application.include_router(public_document_router)
        application.include_router(internal_document_router)
        application.include_router(public_approval_router)
        application.include_router(internal_workflow_router)
        application.include_router(rfq_router)
        application.include_router(daily_report_router, prefix="/api")

    application.add_event_handler("startup", start_document_worker)
    application.add_event_handler("shutdown", stop_document_worker)

    origins = _csv_environment(
        "CORS_ORIGINS",
        "http://localhost:3000,http://127.0.0.1:3000",
    )
    application.add_middleware(
        CORSMiddleware,
        allow_credentials=not is_public,
        allow_origins=origins,
        allow_methods=["GET", "POST", "OPTIONS"] if is_public else ["*"],
        allow_headers=["Accept", "Content-Type"] if is_public else ["*"],
    )
    trusted_hosts = _csv_environment("TRUSTED_HOSTS", "localhost,127.0.0.1,testserver")
    application.add_middleware(TrustedHostMiddleware, allowed_hosts=trusted_hosts)
    if os.getenv("FORCE_HTTPS", "false").lower() == "true":
        application.add_middleware(HTTPSRedirectMiddleware)

    @application.exception_handler(Exception)
    async def safe_unhandled_error(request: Request, error: Exception):
        logger.exception(
            "Unhandled request failure: method=%s path=%s",
            request.method,
            request.url.path,
        )
        return JSONResponse(
            status_code=500,
            content={
                "detail": {
                    "code": "internal_error",
                    "message": "تعذر إكمال العملية. راجع السجلات المحلية ثم أعد المحاولة.",
                }
            },
            headers={"Cache-Control": "no-store"},
        )

    @application.middleware("http")
    async def security_headers(request, call_next):
        if is_public and request.method == "POST":
            content_length = request.headers.get("content-length", "")
            maximum = int(os.getenv("PUBLIC_MAX_HTTP_BODY_BYTES", str(27 * 1024 * 1024)))
            if request.url.path.endswith("/documents"):
                maximum = max(
                    maximum,
                    int(os.getenv("DOCUMENT_MAX_TOTAL_BYTES", str(30 * 1024 * 1024)))
                    + 2 * 1024 * 1024,
                )
            if content_length.isdigit() and int(content_length) > maximum:
                return JSONResponse(
                    status_code=413,
                    content={"detail": "حجم الطلب أكبر من الحد المسموح"},
                    headers={"Cache-Control": "no-store"},
                )
        response = await call_next(request)
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
        response.headers["Permissions-Policy"] = "camera=(self), microphone=(), geolocation=()"
        if os.getenv("APP_ENV", "development").strip().lower() in {"staging", "production"}:
            response.headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains"
        return response

    return application


app = create_app()
