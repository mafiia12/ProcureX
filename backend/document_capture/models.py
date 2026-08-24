"""Persistence models for human-reviewed purchase-request document capture."""

from __future__ import annotations

from sqlalchemy import (
    Float,
    ForeignKey,
    Index,
    Integer,
    JSON,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column

try:
    from ..database import Base
except ImportError:  # pragma: no cover - direct backend execution
    from database import Base


class PurchaseRequestDocument(Base):
    __tablename__ = "purchase_request_documents"
    id: Mapped[str] = mapped_column(String, primary_key=True)
    request_id: Mapped[str] = mapped_column(
        String,
        ForeignKey("incoming_purchase_requests.id", ondelete="CASCADE"),
        index=True,
    )
    document_type: Mapped[str] = mapped_column(String, index=True)
    status: Mapped[str] = mapped_column(String, index=True, default="uploaded")
    ocr_provider: Mapped[str] = mapped_column(String, default="")
    extraction_provider: Mapped[str] = mapped_column(String, default="")
    raw_text: Mapped[str] = mapped_column(Text, default="")
    ocr_confidence: Mapped[float | None] = mapped_column(Float, nullable=True)
    page_count: Mapped[int] = mapped_column(Integer, default=0)
    provider_metadata: Mapped[dict] = mapped_column(JSON, default=dict, nullable=False)
    failure_code: Mapped[str] = mapped_column(String, default="")
    failure_message: Mapped[str] = mapped_column(Text, default="")
    confirmed_by: Mapped[str] = mapped_column(String, default="")
    confirmed_at: Mapped[str] = mapped_column(String, default="")
    retention_expires_at: Mapped[str] = mapped_column(String, index=True, default="")
    created_at: Mapped[str] = mapped_column(String, index=True)
    updated_at: Mapped[str] = mapped_column(String)


class DocumentFile(Base):
    __tablename__ = "purchase_request_document_files"
    __table_args__ = (UniqueConstraint("document_id", "position"),)
    id: Mapped[str] = mapped_column(String, primary_key=True)
    document_id: Mapped[str] = mapped_column(
        String,
        ForeignKey("purchase_request_documents.id", ondelete="CASCADE"),
        index=True,
    )
    position: Mapped[int] = mapped_column(Integer)
    original_filename: Mapped[str] = mapped_column(String)
    stored_filename: Mapped[str] = mapped_column(String, unique=True)
    media_type: Mapped[str] = mapped_column(String)
    size_bytes: Mapped[int] = mapped_column(Integer)
    sha256: Mapped[str] = mapped_column(String, index=True)
    created_at: Mapped[str] = mapped_column(String)


class ExtractedItem(Base):
    __tablename__ = "purchase_request_extracted_items"
    __table_args__ = (UniqueConstraint("document_id", "position"),)
    id: Mapped[str] = mapped_column(String, primary_key=True)
    document_id: Mapped[str] = mapped_column(
        String,
        ForeignKey("purchase_request_documents.id", ondelete="CASCADE"),
        index=True,
    )
    position: Mapped[int] = mapped_column(Integer)
    raw_line_text: Mapped[str] = mapped_column(Text, default="")
    product_name: Mapped[str] = mapped_column(String, default="")
    brand: Mapped[str] = mapped_column(String, default="")
    specification: Mapped[str] = mapped_column(Text, default="")
    size: Mapped[str] = mapped_column(String, default="")
    quantity: Mapped[float | None] = mapped_column(Float, nullable=True)
    unit: Mapped[str] = mapped_column(String, default="")
    notes: Mapped[str] = mapped_column(Text, default="")
    extraction_confidence: Mapped[float | None] = mapped_column(Float, nullable=True)
    selected_item_id: Mapped[str] = mapped_column(
        String, ForeignKey("items.id", ondelete="SET NULL"), nullable=True, index=True
    )
    match_state: Mapped[str] = mapped_column(String, default="no_match", index=True)
    excluded: Mapped[int] = mapped_column(Integer, default=0)
    review_notes: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[str] = mapped_column(String)
    updated_at: Mapped[str] = mapped_column(String)


class ItemCandidate(Base):
    __tablename__ = "purchase_request_item_candidates"
    __table_args__ = (
        UniqueConstraint("extracted_item_id", "item_id"),
        Index("ix_request_item_candidates_rank", "extracted_item_id", "rank"),
    )
    id: Mapped[str] = mapped_column(String, primary_key=True)
    extracted_item_id: Mapped[str] = mapped_column(
        String,
        ForeignKey("purchase_request_extracted_items.id", ondelete="CASCADE"),
        index=True,
    )
    item_id: Mapped[str] = mapped_column(
        String, ForeignKey("items.id", ondelete="CASCADE"), index=True
    )
    score: Mapped[float] = mapped_column(Float)
    rank: Mapped[int] = mapped_column(Integer)
    reasons: Mapped[list] = mapped_column(JSON, default=list, nullable=False)
    created_at: Mapped[str] = mapped_column(String)


class DocumentProcessingJob(Base):
    __tablename__ = "document_processing_jobs"
    __table_args__ = (
        Index("ix_document_jobs_claim", "status", "available_at", "created_at"),
    )
    id: Mapped[str] = mapped_column(String, primary_key=True)
    document_id: Mapped[str] = mapped_column(
        String,
        ForeignKey("purchase_request_documents.id", ondelete="CASCADE"),
        index=True,
    )
    status: Mapped[str] = mapped_column(String, index=True, default="queued")
    attempts: Mapped[int] = mapped_column(Integer, default=0)
    max_attempts: Mapped[int] = mapped_column(Integer, default=3)
    available_at: Mapped[str] = mapped_column(String, index=True)
    locked_at: Mapped[str] = mapped_column(String, default="")
    locked_by: Mapped[str] = mapped_column(String, default="")
    last_error_code: Mapped[str] = mapped_column(String, default="")
    last_error_message: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[str] = mapped_column(String)
    updated_at: Mapped[str] = mapped_column(String)


class RequestAuditEvent(Base):
    __tablename__ = "purchase_request_audit_events"
    id: Mapped[str] = mapped_column(String, primary_key=True)
    request_id: Mapped[str] = mapped_column(String, index=True)
    document_id: Mapped[str] = mapped_column(String, index=True, default="")
    event_type: Mapped[str] = mapped_column(String, index=True)
    actor: Mapped[str] = mapped_column(String, default="")
    details: Mapped[dict] = mapped_column(JSON, default=dict, nullable=False)
    created_at: Mapped[str] = mapped_column(String, index=True)


class ItemMasterCreationRequest(Base):
    __tablename__ = "item_master_creation_requests"
    id: Mapped[str] = mapped_column(String, primary_key=True)
    request_id: Mapped[str] = mapped_column(String, index=True)
    document_id: Mapped[str] = mapped_column(String, index=True)
    extracted_item_id: Mapped[str] = mapped_column(String, index=True)
    status: Mapped[str] = mapped_column(String, index=True, default="pending")
    proposed_data: Mapped[dict] = mapped_column(JSON, default=dict, nullable=False)
    requested_by: Mapped[str] = mapped_column(String, default="")
    resolved_by: Mapped[str] = mapped_column(String, default="")
    created_at: Mapped[str] = mapped_column(String)
    updated_at: Mapped[str] = mapped_column(String)
