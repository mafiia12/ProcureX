import os
from contextlib import contextmanager
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, Optional

from dotenv import load_dotenv
from sqlalchemy import (
    CheckConstraint,
    Float,
    Index,
    Integer,
    JSON,
    String,
    Text,
    ForeignKey,
    UniqueConstraint,
    create_engine,
    event,
    inspect,
    select,
)
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, sessionmaker

try:
    from .db_migrations import (
        migrate_authentication, migrate_site_portal_requests, migrate_site_portal_attachments,
        migrate_business_code_sequences, migrate_incoming_requests,
        migrate_document_capture, migrate_item_classification, migrate_item_identity,
        migrate_supplier_price_comparisons, migrate_guided_procurement_workflow,
        migrate_site_receiving,
        migrate_purchase_request_item_review,
        migrate_rfq_supplier_quotations,
        migrate_po_payment_ledger,
        migrate_supplier_offer_adjustments,
        migrate_daily_reports,
        migrate_whatsapp_intake,
    )
except ImportError:
    from db_migrations import (
        migrate_authentication, migrate_site_portal_requests, migrate_site_portal_attachments,
        migrate_business_code_sequences, migrate_incoming_requests,
        migrate_document_capture, migrate_item_classification, migrate_item_identity,
        migrate_supplier_price_comparisons, migrate_guided_procurement_workflow,
        migrate_site_receiving,
        migrate_purchase_request_item_review,
        migrate_rfq_supplier_quotations,
        migrate_po_payment_ledger,
        migrate_supplier_offer_adjustments,
        migrate_daily_reports,
        migrate_whatsapp_intake,
    )


ROOT_DIR = Path(__file__).resolve().parent
load_dotenv(ROOT_DIR / ".env")


def _database_url() -> str:
    configured = os.getenv("DATABASE_URL", "sqlite:///./procurement.db").strip()
    prefix = "sqlite:///./"
    if configured.startswith(prefix):
        target = (ROOT_DIR / configured[len(prefix):]).resolve()
        return f"sqlite:///{target.as_posix()}"
    if configured.startswith("postgres://"):
        return configured.replace("postgres://", "postgresql+psycopg://", 1)
    if configured.startswith("postgresql://"):
        return configured.replace("postgresql://", "postgresql+psycopg://", 1)
    return configured


class Base(DeclarativeBase):
    pass


class ExtraFieldsMixin:
    extra_data: Mapped[dict] = mapped_column(JSON, default=dict, nullable=False)


class Supplier(ExtraFieldsMixin, Base):
    __tablename__ = "suppliers"
    id: Mapped[str] = mapped_column(String, primary_key=True)
    code: Mapped[str] = mapped_column(String, unique=True, index=True, default="")
    name: Mapped[str] = mapped_column(String, unique=True, index=True)
    specialty: Mapped[str] = mapped_column(String, default="")
    group_name: Mapped[str] = mapped_column(String, default="")
    governorate: Mapped[str] = mapped_column(String, default="")
    city: Mapped[str] = mapped_column(String, default="")
    address: Mapped[str] = mapped_column(Text, default="")
    contact_person: Mapped[str] = mapped_column(String, default="")
    phone: Mapped[str] = mapped_column(String, default="")
    whatsapp: Mapped[str] = mapped_column(String, default="")
    email: Mapped[str] = mapped_column(String, default="")
    payment_terms: Mapped[str] = mapped_column(String, default="")
    lead_time_days: Mapped[str] = mapped_column(String, default="")
    rating: Mapped[str] = mapped_column(String, default="")
    status: Mapped[str] = mapped_column(String, default="")
    notes: Mapped[str] = mapped_column(Text, default="")


class Customer(ExtraFieldsMixin, Base):
    __tablename__ = "customers"
    id: Mapped[str] = mapped_column(String, primary_key=True)
    code: Mapped[str] = mapped_column(String, unique=True, index=True, default="")
    name: Mapped[str] = mapped_column(String, unique=True, index=True)
    contact_person: Mapped[str] = mapped_column(String, default="")
    phone: Mapped[str] = mapped_column(String, default="")
    whatsapp: Mapped[str] = mapped_column(String, default="")
    email: Mapped[str] = mapped_column(String, default="")
    governorate: Mapped[str] = mapped_column(String, default="")
    city: Mapped[str] = mapped_column(String, default="")
    address: Mapped[str] = mapped_column(Text, default="")
    status: Mapped[str] = mapped_column(String, default="")
    notes: Mapped[str] = mapped_column(Text, default="")


class Project(ExtraFieldsMixin, Base):
    __tablename__ = "projects"
    id: Mapped[str] = mapped_column(String, primary_key=True)
    code: Mapped[str] = mapped_column(String, unique=True, index=True, default="")
    name: Mapped[str] = mapped_column(String, unique=True, index=True)
    customer_name: Mapped[str] = mapped_column(String, default="")
    governorate: Mapped[str] = mapped_column(String, default="")
    city: Mapped[str] = mapped_column(String, default="")
    address: Mapped[str] = mapped_column(Text, default="")
    engineer: Mapped[str] = mapped_column(String, default="")
    start_date: Mapped[str] = mapped_column(String, default="")
    end_date: Mapped[str] = mapped_column(String, default="")
    budget: Mapped[str] = mapped_column(String, default="")
    status: Mapped[str] = mapped_column(String, default="")
    notes: Mapped[str] = mapped_column(Text, default="")


class Item(ExtraFieldsMixin, Base):
    __tablename__ = "items"
    __table_args__ = (
        Index(
            "ix_items_classification_product",
            "main_category", "subcategory", "brand", "product_name",
        ),
    )
    id: Mapped[str] = mapped_column(String, primary_key=True)
    code: Mapped[str] = mapped_column(String, unique=True, index=True, default="")
    name: Mapped[str] = mapped_column(String, unique=True, index=True)
    product_name: Mapped[str] = mapped_column(
        String, index=True, default="", server_default=""
    )
    brand: Mapped[str] = mapped_column(String, index=True, default="", server_default="")
    category: Mapped[str] = mapped_column(String, default="")
    main_category: Mapped[str] = mapped_column(String, default="", server_default="")
    subcategory: Mapped[str] = mapped_column(String, default="", server_default="")
    unit: Mapped[str] = mapped_column(String, default="")
    specs: Mapped[str] = mapped_column(Text, default="")
    specifications: Mapped[str] = mapped_column(Text, default="", server_default="")
    name_ar: Mapped[str] = mapped_column(
        String, index=True, default="", server_default=""
    )
    name_en: Mapped[str] = mapped_column(
        String, index=True, default="", server_default=""
    )
    alternative_names: Mapped[list] = mapped_column(
        JSON, default=list, nullable=False, server_default="[]"
    )
    search_aliases: Mapped[list] = mapped_column(
        JSON, default=list, nullable=False, server_default="[]"
    )
    preferred_supplier: Mapped[str] = mapped_column(String, default="")
    notes: Mapped[str] = mapped_column(Text, default="")

class PurchaseOrder(ExtraFieldsMixin, Base):
    __tablename__ = "purchase_orders"

    id: Mapped[str] = mapped_column(String, primary_key=True)
    po_number: Mapped[str] = mapped_column(String, unique=True, index=True)

    comparison_id: Mapped[str] = mapped_column(String, index=True, default="")
    comparison_number: Mapped[str] = mapped_column(String, default="")
    source_request_id: Mapped[str] = mapped_column(String, index=True, default="", server_default="")
    source_request_number: Mapped[str] = mapped_column(String, default="", server_default="")
    approval_id: Mapped[str] = mapped_column(String, index=True, default="", server_default="")
    approval_number: Mapped[str] = mapped_column(String, default="", server_default="")

    project_id: Mapped[str] = mapped_column(String, index=True, default="")
    project_name: Mapped[str] = mapped_column(String, default="")

    supplier_id: Mapped[str] = mapped_column(String, index=True, default="")
    supplier_name: Mapped[str] = mapped_column(String, default="")

    customer_id: Mapped[str] = mapped_column(String, index=True, default="")
    customer_name: Mapped[str] = mapped_column(String, default="")

    po_date: Mapped[str] = mapped_column(String, index=True, default="")
    status: Mapped[str] = mapped_column(String, index=True, default="draft")

    subtotal: Mapped[float] = mapped_column(Float, default=0)
    discount_total: Mapped[float] = mapped_column(Float, default=0)
    vat_total: Mapped[float] = mapped_column(Float, default=0)
    shipping_total: Mapped[float] = mapped_column(Float, default=0)
    other_total: Mapped[float] = mapped_column(Float, default=0)
    final_total: Mapped[float] = mapped_column(Float, default=0)

    notes: Mapped[str] = mapped_column(Text, default="")
    created_by: Mapped[str] = mapped_column(String, default="")
    created_at: Mapped[str] = mapped_column(String, default="")
    updated_at: Mapped[str] = mapped_column(String, default="")


class PurchaseOrderItem(ExtraFieldsMixin, Base):
    __tablename__ = "purchase_order_items"

    id: Mapped[str] = mapped_column(String, primary_key=True)
    purchase_order_id: Mapped[str] = mapped_column(String, index=True)

    item_id: Mapped[str] = mapped_column(String, index=True, default="")
    item_code: Mapped[str] = mapped_column(String, index=True, default="")
    product_name: Mapped[str] = mapped_column(String, default="")
    brand: Mapped[str] = mapped_column(String, default="")
    specifications: Mapped[str] = mapped_column(Text, default="")

    quantity: Mapped[float] = mapped_column(Float, default=0)
    unit: Mapped[str] = mapped_column(String, default="")
    unit_price: Mapped[float] = mapped_column(Float, default=0)

    discount_pct: Mapped[float] = mapped_column(Float, default=0)
    vat_pct: Mapped[float] = mapped_column(Float, default=0)
    shipping_cost: Mapped[float] = mapped_column(Float, default=0)
    other_cost: Mapped[float] = mapped_column(Float, default=0)

    line_total: Mapped[float] = mapped_column(Float, default=0)


class PurchaseOrderReceipt(Base):
    __tablename__ = "purchase_order_receipts"
    __table_args__ = (
        UniqueConstraint("purchase_order_id", "idempotency_key", name="uq_po_receipt_idempotency"),
        Index("ix_po_receipts_order", "purchase_order_id"),
        Index("ix_po_receipts_received_at", "received_at"),
    )

    id: Mapped[str] = mapped_column(String, primary_key=True)
    purchase_order_id: Mapped[str] = mapped_column(
        String, ForeignKey("purchase_orders.id", ondelete="CASCADE"), nullable=False,
    )
    idempotency_key: Mapped[str] = mapped_column(String, nullable=False)
    receipt_type: Mapped[str] = mapped_column(String, nullable=False)
    actor_role: Mapped[str] = mapped_column(String, default="procurement_officer", server_default="procurement_officer")
    actor_name: Mapped[str] = mapped_column(String, default="", server_default="")
    note: Mapped[str] = mapped_column(Text, default="", server_default="")
    problem_reason: Mapped[str] = mapped_column(String, default="", server_default="")
    affected_item_id: Mapped[str] = mapped_column(String, default="", server_default="")
    affected_quantity: Mapped[float] = mapped_column(Float, default=0, server_default="0")
    po_number: Mapped[str] = mapped_column(String, default="", server_default="")
    project_name: Mapped[str] = mapped_column(String, default="", server_default="")
    supplier_name: Mapped[str] = mapped_column(String, default="", server_default="")
    received_at: Mapped[str] = mapped_column(String, nullable=False)


class PurchaseOrderReceiptLine(Base):
    __tablename__ = "purchase_order_receipt_lines"
    __table_args__ = (
        UniqueConstraint("receipt_id", "purchase_order_item_id", name="uq_po_receipt_line_item"),
        Index("ix_po_receipt_lines_receipt", "receipt_id"),
    )

    id: Mapped[str] = mapped_column(String, primary_key=True)
    receipt_id: Mapped[str] = mapped_column(
        String, ForeignKey("purchase_order_receipts.id", ondelete="CASCADE"), nullable=False,
    )
    purchase_order_item_id: Mapped[str] = mapped_column(
        String, ForeignKey("purchase_order_items.id", ondelete="RESTRICT"), nullable=False,
    )
    item_code: Mapped[str] = mapped_column(String, default="", server_default="")
    product_name: Mapped[str] = mapped_column(String, default="", server_default="")
    unit: Mapped[str] = mapped_column(String, default="", server_default="")
    ordered_quantity: Mapped[float] = mapped_column(Float, nullable=False)
    previously_received_quantity: Mapped[float] = mapped_column(Float, default=0, server_default="0")
    received_quantity: Mapped[float] = mapped_column(Float, default=0, server_default="0")
    remaining_quantity: Mapped[float] = mapped_column(Float, default=0, server_default="0")


class PurchaseOrderPayment(Base):
    """Actual supplier payments recorded against a formal Purchase Order.

    Deliberately not the legacy Payment/purchases model (that is
    Direct-Purchase-only, keyed by purchase_id) and not ApprovalPayment
    (that is the commercial/funds-release approval event, not money that
    has actually left the business). A recorded payment counts toward
    paid_amount; a voided one never does and is never deleted."""

    __tablename__ = "purchase_order_payments"
    __table_args__ = (
        UniqueConstraint("purchase_order_id", "idempotency_key", name="uq_po_payment_idempotency"),
        Index("ix_po_payments_order", "purchase_order_id"),
        Index("ix_po_payments_status", "status"),
    )

    id: Mapped[str] = mapped_column(String, primary_key=True)
    payment_number: Mapped[str] = mapped_column(String, unique=True)
    purchase_order_id: Mapped[str] = mapped_column(
        String, ForeignKey("purchase_orders.id", ondelete="RESTRICT"), nullable=False,
    )
    idempotency_key: Mapped[str] = mapped_column(String, nullable=False)
    payment_date: Mapped[str] = mapped_column(String, nullable=False)
    amount: Mapped[float] = mapped_column(Float, nullable=False)
    payment_method: Mapped[str] = mapped_column(String, default="", server_default="")
    payment_reference: Mapped[str] = mapped_column(String, default="", server_default="")
    notes: Mapped[str] = mapped_column(Text, default="", server_default="")
    status: Mapped[str] = mapped_column(String, default="recorded", server_default="recorded")
    void_reason: Mapped[str] = mapped_column(Text, default="", server_default="")
    created_by: Mapped[str] = mapped_column(String, default="", server_default="")
    created_at: Mapped[str] = mapped_column(String, nullable=False)
    updated_at: Mapped[str] = mapped_column(String, nullable=False)


class Purchase(ExtraFieldsMixin, Base):
    __tablename__ = "purchases"
    id: Mapped[str] = mapped_column(String, primary_key=True)
    purchase_id: Mapped[str] = mapped_column(String, unique=True, index=True)
    po_number: Mapped[str] = mapped_column(String, index=True, default="")
    purchase_date: Mapped[str] = mapped_column(String, index=True, default="")
    invoice_number: Mapped[str] = mapped_column(String, index=True, default="")
    invoice_date: Mapped[str] = mapped_column(String, default="")
    supplier_id: Mapped[str] = mapped_column(String, index=True, default="")
    supplier_name: Mapped[str] = mapped_column(String, index=True, default="")
    project_id: Mapped[str] = mapped_column(String, index=True, default="")
    project_name: Mapped[str] = mapped_column(String, default="")
    customer_id: Mapped[str] = mapped_column(String, index=True, default="")
    customer_name: Mapped[str] = mapped_column(String, default="")
    purchase_type: Mapped[str] = mapped_column(String, default="")
    currency: Mapped[str] = mapped_column(String, default="EGP")
    created_by: Mapped[str] = mapped_column(String, default="")
    payment_method: Mapped[str] = mapped_column(String, default="")
    notes: Mapped[str] = mapped_column(Text, default="")
    shipping_cost: Mapped[float] = mapped_column(Float, default=0)
    other_costs: Mapped[float] = mapped_column(Float, default=0)
    subtotal: Mapped[float] = mapped_column(Float, default=0)
    discount_total: Mapped[float] = mapped_column(Float, default=0)
    after_discount: Mapped[float] = mapped_column(Float, default=0)
    vat_total: Mapped[float] = mapped_column(Float, default=0)
    invoice_total: Mapped[float] = mapped_column(Float, default=0)
    payment_status: Mapped[str] = mapped_column(String, default="")
    created_at: Mapped[str] = mapped_column(String, default="")


class PurchaseItem(ExtraFieldsMixin, Base):
    __tablename__ = "purchase_items"
    id: Mapped[str] = mapped_column(String, primary_key=True)
    purchase_id: Mapped[str] = mapped_column(String, index=True)
    item_id: Mapped[str] = mapped_column(String, index=True, default="")
    item_code: Mapped[str] = mapped_column(String, index=True, default="")
    item_name: Mapped[str] = mapped_column(String, default="")
    product_name: Mapped[str] = mapped_column(String, default="", server_default="")
    brand: Mapped[str] = mapped_column(String, default="", server_default="")
    main_category: Mapped[str] = mapped_column(String, default="", server_default="")
    subcategory: Mapped[str] = mapped_column(String, default="", server_default="")
    specifications: Mapped[str] = mapped_column(Text, default="", server_default="")
    unit: Mapped[str] = mapped_column(String, default="")
    quantity: Mapped[float] = mapped_column(Float, default=0)
    unit_price: Mapped[float] = mapped_column(Float, default=0)
    discount_pct: Mapped[float] = mapped_column(Float, default=0)
    vat_pct: Mapped[float] = mapped_column(Float, default=0)
    line_total: Mapped[float] = mapped_column(Float, default=0)


class Payment(ExtraFieldsMixin, Base):
    __tablename__ = "payments"
    id: Mapped[str] = mapped_column(String, primary_key=True)
    payment_id: Mapped[str] = mapped_column(String, unique=True, index=True)
    payment_date: Mapped[str] = mapped_column(String, index=True, default="")
    purchase_id: Mapped[str] = mapped_column(String, index=True)
    amount_paid: Mapped[float] = mapped_column(Float, default=0)
    payment_method: Mapped[str] = mapped_column(String, default="")
    notes: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[str] = mapped_column(String, default="")


class PriceHistory(ExtraFieldsMixin, Base):
    __tablename__ = "price_history"
    id: Mapped[str] = mapped_column(String, primary_key=True)
    record_no: Mapped[int] = mapped_column(Integer, unique=True, index=True)
    date: Mapped[str] = mapped_column(String, index=True, default="")
    po_number: Mapped[str] = mapped_column(String, default="")
    invoice_number: Mapped[str] = mapped_column(String, index=True, default="")
    item_code: Mapped[str] = mapped_column(String, index=True, default="")
    item_name: Mapped[str] = mapped_column(String, default="")
    product_name: Mapped[str] = mapped_column(String, default="", server_default="")
    brand: Mapped[str] = mapped_column(String, default="", server_default="")
    main_category: Mapped[str] = mapped_column(String, default="", server_default="")
    subcategory: Mapped[str] = mapped_column(String, default="", server_default="")
    specifications: Mapped[str] = mapped_column(Text, default="", server_default="")
    supplier: Mapped[str] = mapped_column(String, index=True, default="")
    project: Mapped[str] = mapped_column(String, default="")
    quantity: Mapped[float] = mapped_column(Float, default=0)
    unit: Mapped[str] = mapped_column(String, default="")
    unit_price: Mapped[float] = mapped_column(Float, default=0)
    discount_pct: Mapped[float] = mapped_column(Float, default=0)
    vat_pct: Mapped[float] = mapped_column(Float, default=0)
    final_price: Mapped[float] = mapped_column(Float, default=0)
    employee: Mapped[str] = mapped_column(String, default="")


class Setting(ExtraFieldsMixin, Base):
    __tablename__ = "settings"
    id: Mapped[str] = mapped_column(String, primary_key=True)
    key: Mapped[str] = mapped_column(String, unique=True, index=True)
    label: Mapped[str] = mapped_column(String, default="")
    values: Mapped[list] = mapped_column(JSON, default=list, nullable=False)


class BusinessCodeSequence(Base):
    __tablename__ = "business_code_sequences"
    __table_args__ = (
        CheckConstraint(
            "next_value > 0", name="ck_business_code_sequences_positive"
        ),
    )
    entity: Mapped[str] = mapped_column(String, primary_key=True)
    next_value: Mapped[int] = mapped_column(Integer, nullable=False)


MODELS = {
    "suppliers": Supplier, "customers": Customer, "projects": Project,
    "items": Item, "purchases": Purchase, "purchase_items": PurchaseItem,
    "payments": Payment, "price_history": PriceHistory, "settings": Setting,
    "purchase_orders": PurchaseOrder,
    "purchase_order_items": PurchaseOrderItem,
}


DATABASE_URL = _database_url()
IS_SQLITE = DATABASE_URL.startswith("sqlite:")
engine_options = {
    "future": True,
    "pool_pre_ping": True,
}
if IS_SQLITE:
    engine_options["connect_args"] = {"check_same_thread": False}
engine = create_engine(DATABASE_URL, **engine_options)
SessionLocal = sessionmaker(bind=engine, expire_on_commit=False)


@event.listens_for(engine, "connect")
def _sqlite_pragmas(dbapi_connection, _connection_record):
    if not IS_SQLITE:
        return
    cursor = dbapi_connection.cursor()
    cursor.execute("PRAGMA journal_mode=WAL")
    cursor.execute("PRAGMA foreign_keys=ON")
    cursor.close()


def init_db() -> Optional[Path]:
    if not IS_SQLITE:
        # Production schemas are changed only by an explicit Alembic deployment
        # step. Never run the legacy SQLite migration helpers against PostgreSQL.
        required = {
            "business_code_sequences", "incoming_purchase_requests",
            "incoming_purchase_request_items", "price_comparisons",
            "price_comparison_rows", "price_comparison_supplier_offers",
            "engineer_approval_supplier_offers", "purchase_request_documents",
            "purchase_request_document_files", "purchase_request_extracted_items",
            "document_processing_jobs",
            "construction_import_runs", "construction_categories",
            "construction_work_items", "construction_material_rates",
            "construction_calculation_sessions", "construction_calculation_snapshots",
            "users", "user_project_access",
            "daily_reports",
            "whatsapp_drafts", "whatsapp_processed_messages",
        }
        existing = set(inspect(engine).get_table_names())
        if not required.issubset(existing):
            raise RuntimeError(
                "PostgreSQL schema is not initialized; run 'alembic upgrade head' before startup"
            )
        return None
    classification_backup = migrate_item_classification(engine)
    identity_backup = migrate_item_identity(engine)
    incoming_backup = migrate_incoming_requests(engine)
    item_review_backup = migrate_purchase_request_item_review(engine)
    code_sequence_backup = migrate_business_code_sequences(engine)
    price_comparison_backup = migrate_supplier_price_comparisons(engine)
    document_capture_backup = migrate_document_capture(engine)
    workflow_backup = migrate_guided_procurement_workflow(engine)
    receiving_backup = migrate_site_receiving(engine)
    auth_backup = migrate_authentication(engine)
    portal_requests_backup = migrate_site_portal_requests(engine)
    portal_attachments_backup = migrate_site_portal_attachments(engine)
    rfq_backup = migrate_rfq_supplier_quotations(engine)
    po_payment_backup = migrate_po_payment_ledger(engine)
    supplier_offer_backup = migrate_supplier_offer_adjustments(engine)
    daily_report_backup = migrate_daily_reports(engine)
    whatsapp_intake_backup = migrate_whatsapp_intake(engine)
    Base.metadata.create_all(engine)
    return (
        whatsapp_intake_backup or daily_report_backup or supplier_offer_backup or po_payment_backup or rfq_backup or portal_attachments_backup or portal_requests_backup or auth_backup or receiving_backup or workflow_backup or item_review_backup or document_capture_backup or price_comparison_backup or code_sequence_backup or incoming_backup or identity_backup
        or classification_backup
    )


def _model_fields(model) -> set[str]:
    return {column.name for column in model.__table__.columns}


def _document(row) -> dict:
    result = {
        column.name: getattr(row, column.name)
        for column in row.__table__.columns
        if column.name != "extra_data"
    }
    result.update(row.extra_data or {})
    return result


def _condition(model, query: Optional[dict]):
    if not query:
        return None
    from sqlalchemy import and_, or_
    parts = []
    for key, value in query.items():
        if key == "$or":
            nested = [_condition(model, item) for item in value]
            nested = [item for item in nested if item is not None]
            if nested:
                parts.append(or_(*nested))
            continue
        column = getattr(model, key, None)
        if column is None:
            continue
        if isinstance(value, dict) and "$ne" in value:
            parts.append(column != value["$ne"])
        else:
            parts.append(column == value)
    return and_(*parts) if parts else None


def _project(document: dict, projection: Optional[dict]) -> dict:
    if not projection:
        return document
    included = {key for key, value in projection.items() if value and key != "_id"}
    if included:
        return {key: document.get(key) for key in included}
    excluded = {key for key, value in projection.items() if not value}
    return {key: value for key, value in document.items() if key not in excluded}


@dataclass
class WriteResult:
    matched_count: int = 0
    modified_count: int = 0
    deleted_count: int = 0


class LocalQuery:
    def __init__(
        self,
        model,
        query: Optional[dict] = None,
        projection: Optional[dict] = None,
        session=None,
    ):
        self.model = model
        self.query = query or {}
        self.projection = projection
        self.session = session
        self.sort_field: Optional[str] = None
        self.sort_direction = 1

    def sort(self, field: str, direction: int):
        self.sort_field = field
        self.sort_direction = direction
        return self

    async def to_list(self, length: int):
        def execute(session):
            statement = select(self.model)
            condition = _condition(self.model, self.query)
            if condition is not None:
                statement = statement.where(condition)
            if self.sort_field:
                column = getattr(self.model, self.sort_field)
                statement = statement.order_by(column.desc() if self.sort_direction < 0 else column.asc())
            if length:
                statement = statement.limit(length)
            return [
                _project(_document(row), self.projection)
                for row in session.scalars(statement).all()
            ]

        if self.session is not None:
            return execute(self.session)
        with SessionLocal() as session:
            return execute(session)


class LocalCollection:
    def __init__(self, model, session=None):
        self.model = model
        self.fields = _model_fields(model)
        self.session = session

    def find(self, query: Optional[dict] = None, projection: Optional[dict] = None):
        return LocalQuery(self.model, query, projection, self.session)

    async def find_one(self, query: Optional[dict] = None, projection: Optional[dict] = None):
        def execute(session):
            statement = select(self.model)
            condition = _condition(self.model, query)
            if condition is not None:
                statement = statement.where(condition)
            row = session.scalars(statement.limit(1)).first()
            return _project(_document(row), projection) if row else None

        if self.session is not None:
            return execute(self.session)
        with SessionLocal() as session:
            return execute(session)

    def _split_values(self, document: Dict[str, Any]):
        values = {key: value for key, value in document.items() if key in self.fields and key != "extra_data"}
        values["extra_data"] = {
            key: value for key, value in document.items()
            if key not in self.fields and key != "_id"
        }
        return values

    async def insert_one(self, document: Dict[str, Any]):
        if self.session is not None:
            self.session.add(self.model(**self._split_values(document)))
            self.session.flush()
            return WriteResult(matched_count=1, modified_count=1)
        with SessionLocal() as session:
            session.add(self.model(**self._split_values(document)))
            session.commit()
        return WriteResult(matched_count=1, modified_count=1)

    async def update_one(self, query: dict, update: dict):
        def execute(session, *, commit: bool):
            statement = select(self.model)
            condition = _condition(self.model, query)
            if condition is not None:
                statement = statement.where(condition)
            row = session.scalars(statement.limit(1)).first()
            if row is None:
                return WriteResult()
            extras = dict(row.extra_data or {})
            for key, value in update.get("$set", {}).items():
                if key in self.fields and key != "extra_data":
                    setattr(row, key, value)
                else:
                    extras[key] = value
            row.extra_data = extras
            if commit:
                session.commit()
            else:
                session.flush()
            return WriteResult(matched_count=1, modified_count=1)

        if self.session is not None:
            return execute(self.session, commit=False)
        with SessionLocal() as session:
            return execute(session, commit=True)

    async def delete_one(self, query: dict):
        def execute(session, *, commit: bool):
            statement = select(self.model)
            condition = _condition(self.model, query)
            if condition is not None:
                statement = statement.where(condition)
            row = session.scalars(statement.limit(1)).first()
            if row is None:
                return WriteResult()
            session.delete(row)
            if commit:
                session.commit()
            else:
                session.flush()
            return WriteResult(deleted_count=1)

        if self.session is not None:
            return execute(self.session, commit=False)
        with SessionLocal() as session:
            return execute(session, commit=True)

    async def delete_many(self, query: dict):
        def execute(session, *, commit: bool):
            statement = select(self.model)
            condition = _condition(self.model, query)
            if condition is not None:
                statement = statement.where(condition)
            rows = session.scalars(statement).all()
            for row in rows:
                session.delete(row)
            if commit:
                session.commit()
            else:
                session.flush()
            return WriteResult(deleted_count=len(rows))

        if self.session is not None:
            return execute(self.session, commit=False)
        with SessionLocal() as session:
            return execute(session, commit=True)

    async def count_documents(self, query: Optional[dict] = None):
        def execute(session):
            statement = select(self.model)
            condition = _condition(self.model, query)
            if condition is not None:
                statement = statement.where(condition)
            return len(session.scalars(statement).all())

        if self.session is not None:
            return execute(self.session)
        with SessionLocal() as session:
            return execute(session)


class LocalDatabase:
    def __init__(self, session=None):
        self._session = session
        self._collections = {
            name: LocalCollection(model, session) for name, model in MODELS.items()
        }

    @contextmanager
    def transaction(self):
        """Expose the existing collection API inside one commit/rollback boundary."""
        if self._session is not None:
            yield self
            return
        with SessionLocal.begin() as session:
            yield LocalDatabase(session)

    def __getattr__(self, name: str):
        try:
            return self._collections[name]
        except KeyError as exc:
            raise AttributeError(name) from exc

    def __getitem__(self, name: str):
        return self._collections[name]


db = LocalDatabase()
