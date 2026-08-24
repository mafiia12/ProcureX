"""SQLAlchemy persistence models for the construction calculator module."""

from __future__ import annotations

from sqlalchemy import (
    ForeignKey,
    Index,
    Integer,
    JSON,
    Numeric,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column

try:
    from ..database import Base
except ImportError:  # pragma: no cover - direct backend execution
    from database import Base


DECIMAL = Numeric(24, 10)


class ImportedReferenceMixin:
    code: Mapped[str] = mapped_column(String(32), unique=True, index=True)
    is_active: Mapped[int] = mapped_column(Integer, default=1, index=True)
    source_workbook: Mapped[str] = mapped_column(String(300))
    source_worksheet: Mapped[str] = mapped_column(String(200), index=True)
    source_row: Mapped[int] = mapped_column(Integer, index=True)
    source_text: Mapped[str] = mapped_column(Text)
    source_identity: Mapped[str] = mapped_column(String(300), unique=True, index=True)
    import_version: Mapped[str] = mapped_column(String(100), index=True)
    created_at: Mapped[str] = mapped_column(String(40))
    updated_at: Mapped[str] = mapped_column(String(40))


class ConstructionImportRun(Base):
    __tablename__ = "construction_import_runs"
    id: Mapped[str] = mapped_column(String, primary_key=True)
    import_version: Mapped[str] = mapped_column(String(100), unique=True, index=True)
    workbook_name: Mapped[str] = mapped_column(String(300))
    workbook_sha256: Mapped[str] = mapped_column(String(64), index=True)
    status: Mapped[str] = mapped_column(String(30), index=True)
    inserted_count: Mapped[int] = mapped_column(Integer, default=0)
    updated_count: Mapped[int] = mapped_column(Integer, default=0)
    skipped_count: Mapped[int] = mapped_column(Integer, default=0)
    rejected_count: Mapped[int] = mapped_column(Integer, default=0)
    report_json: Mapped[dict] = mapped_column(JSON, default=dict)
    started_at: Mapped[str] = mapped_column(String(40))
    completed_at: Mapped[str] = mapped_column(String(40), default="")


class ConstructionImportIssue(Base):
    __tablename__ = "construction_import_issues"
    __table_args__ = (
        Index("ix_construction_import_issue_run_row", "import_run_id", "source_row"),
    )
    id: Mapped[str] = mapped_column(String, primary_key=True)
    import_run_id: Mapped[str] = mapped_column(
        String,
        ForeignKey("construction_import_runs.id", ondelete="CASCADE"),
        index=True,
    )
    severity: Mapped[str] = mapped_column(String(20), index=True)
    entity_type: Mapped[str] = mapped_column(String(50), index=True)
    source_worksheet: Mapped[str] = mapped_column(String(200))
    source_row: Mapped[int] = mapped_column(Integer)
    source_text: Mapped[str] = mapped_column(Text)
    reason: Mapped[str] = mapped_column(Text)
    created_at: Mapped[str] = mapped_column(String(40))


class ConstructionCategory(ImportedReferenceMixin, Base):
    __tablename__ = "construction_categories"
    id: Mapped[str] = mapped_column(String, primary_key=True)
    name_ar: Mapped[str] = mapped_column(String(300), index=True)
    name_en: Mapped[str] = mapped_column(String(300), default="")
    search_text: Mapped[str] = mapped_column(Text)
    technical_notes: Mapped[str] = mapped_column(Text, default="")


class ConstructionWorkItem(ImportedReferenceMixin, Base):
    __tablename__ = "construction_work_items"
    __table_args__ = (
        Index("ix_construction_work_item_category_active", "category_id", "is_active"),
        Index("ix_construction_work_item_unit_active", "measurement_unit", "is_active"),
    )
    id: Mapped[str] = mapped_column(String, primary_key=True)
    category_id: Mapped[str] = mapped_column(
        String, ForeignKey("construction_categories.id"), index=True
    )
    name_ar: Mapped[str] = mapped_column(String(500), index=True)
    name_en: Mapped[str] = mapped_column(String(500), default="")
    description: Mapped[str] = mapped_column(Text, default="")
    measurement_unit: Mapped[str] = mapped_column(String(80), index=True)
    conditions_consumption: Mapped[str] = mapped_column(Text, default="")
    conditions_productivity: Mapped[str] = mapped_column(Text, default="")
    technical_notes: Mapped[str] = mapped_column(Text, default="")
    search_text: Mapped[str] = mapped_column(Text)


class ConstructionMaterial(ImportedReferenceMixin, Base):
    __tablename__ = "construction_materials"
    id: Mapped[str] = mapped_column(String, primary_key=True)
    name_ar: Mapped[str] = mapped_column(String(300), index=True)
    name_en: Mapped[str] = mapped_column(String(300), default="")
    default_unit: Mapped[str] = mapped_column(String(80), index=True)
    search_text: Mapped[str] = mapped_column(Text)
    package_capacity: Mapped[object | None] = mapped_column(DECIMAL, nullable=True)
    package_unit: Mapped[str] = mapped_column(String(80), default="")
    package_purchase_unit: Mapped[str] = mapped_column(String(80), default="")
    package_notes: Mapped[str] = mapped_column(Text, default="")


class ConstructionLaborRole(ImportedReferenceMixin, Base):
    __tablename__ = "construction_labor_roles"
    id: Mapped[str] = mapped_column(String, primary_key=True)
    name_ar: Mapped[str] = mapped_column(String(300), index=True)
    name_en: Mapped[str] = mapped_column(String(300), default="")
    role_kind: Mapped[str] = mapped_column(String(40), index=True)
    search_text: Mapped[str] = mapped_column(Text)


class ConstructionEquipment(ImportedReferenceMixin, Base):
    __tablename__ = "construction_equipment"
    id: Mapped[str] = mapped_column(String, primary_key=True)
    name_ar: Mapped[str] = mapped_column(String(300), index=True)
    name_en: Mapped[str] = mapped_column(String(300), default="")
    search_text: Mapped[str] = mapped_column(Text)


class ConstructionWorkCrew(ImportedReferenceMixin, Base):
    __tablename__ = "construction_work_crews"
    __table_args__ = (
        Index("ix_construction_crew_work_item_active", "work_item_id", "is_active"),
    )
    id: Mapped[str] = mapped_column(String, primary_key=True)
    work_item_id: Mapped[str] = mapped_column(
        String, ForeignKey("construction_work_items.id", ondelete="CASCADE"), index=True
    )
    description: Mapped[str] = mapped_column(Text)
    scenario_label: Mapped[str] = mapped_column(String(500), default="")
    numerical_breakdown_complete: Mapped[int] = mapped_column(
        Integer, default=0, index=True
    )


class ConstructionCrewLaborMember(ImportedReferenceMixin, Base):
    __tablename__ = "construction_crew_labor_members"
    __table_args__ = (
        UniqueConstraint("crew_id", "labor_role_id", "source_identity"),
        Index("ix_construction_crew_labor_role", "labor_role_id", "crew_id"),
    )
    id: Mapped[str] = mapped_column(String, primary_key=True)
    crew_id: Mapped[str] = mapped_column(
        String, ForeignKey("construction_work_crews.id", ondelete="CASCADE"), index=True
    )
    labor_role_id: Mapped[str] = mapped_column(
        String, ForeignKey("construction_labor_roles.id"), index=True
    )
    count_per_crew: Mapped[int | None] = mapped_column(Integer, nullable=True)
    project_specific_count_allowed: Mapped[int] = mapped_column(Integer, default=0)
    notes: Mapped[str] = mapped_column(Text, default="")


class ConstructionCrewEquipment(ImportedReferenceMixin, Base):
    __tablename__ = "construction_crew_equipment"
    __table_args__ = (
        UniqueConstraint("crew_id", "equipment_id", "source_identity"),
        Index("ix_construction_crew_equipment_equipment", "equipment_id", "crew_id"),
    )
    id: Mapped[str] = mapped_column(String, primary_key=True)
    crew_id: Mapped[str] = mapped_column(
        String, ForeignKey("construction_work_crews.id", ondelete="CASCADE"), index=True
    )
    equipment_id: Mapped[str] = mapped_column(
        String, ForeignKey("construction_equipment.id"), index=True
    )
    quantity_per_crew: Mapped[int | None] = mapped_column(Integer, nullable=True)
    project_specific_quantity_allowed: Mapped[int] = mapped_column(Integer, default=0)
    notes: Mapped[str] = mapped_column(Text, default="")


class ConstructionMaterialRate(ImportedReferenceMixin, Base):
    __tablename__ = "construction_material_rates"
    __table_args__ = (
        Index("ix_construction_rate_work_item_material", "work_item_id", "material_id"),
        Index("ix_construction_rate_crew_active", "crew_id", "is_active"),
    )
    id: Mapped[str] = mapped_column(String, primary_key=True)
    work_item_id: Mapped[str] = mapped_column(
        String, ForeignKey("construction_work_items.id", ondelete="CASCADE"), index=True
    )
    crew_id: Mapped[str | None] = mapped_column(
        String,
        ForeignKey("construction_work_crews.id", ondelete="CASCADE"),
        nullable=True,
        index=True,
    )
    material_id: Mapped[str] = mapped_column(
        String, ForeignKey("construction_materials.id"), index=True
    )
    rate_kind: Mapped[str] = mapped_column(String(20), index=True)
    fixed_rate: Mapped[object | None] = mapped_column(DECIMAL, nullable=True)
    minimum_rate: Mapped[object | None] = mapped_column(DECIMAL, nullable=True)
    maximum_rate: Mapped[object | None] = mapped_column(DECIMAL, nullable=True)
    material_unit: Mapped[str] = mapped_column(String(80), index=True)
    basis_quantity: Mapped[object] = mapped_column(DECIMAL, default=1)
    basis_unit: Mapped[str] = mapped_column(String(80))
    waste_percentage: Mapped[object | None] = mapped_column(DECIMAL, nullable=True)
    conditions: Mapped[str] = mapped_column(Text, default="")


class ConstructionProductivityRate(ImportedReferenceMixin, Base):
    __tablename__ = "construction_productivity_rates"
    __table_args__ = (
        Index("ix_construction_productivity_work_item", "work_item_id", "crew_id"),
    )
    id: Mapped[str] = mapped_column(String, primary_key=True)
    work_item_id: Mapped[str] = mapped_column(
        String, ForeignKey("construction_work_items.id", ondelete="CASCADE"), index=True
    )
    crew_id: Mapped[str] = mapped_column(
        String, ForeignKey("construction_work_crews.id", ondelete="CASCADE"), index=True
    )
    daily_productivity: Mapped[object] = mapped_column(DECIMAL)
    productivity_unit: Mapped[str] = mapped_column(String(120))
    conditions: Mapped[str] = mapped_column(Text, default="")


class ConstructionWorkItemAdjustment(ImportedReferenceMixin, Base):
    __tablename__ = "construction_work_item_adjustments"
    __table_args__ = (
        Index("ix_construction_adjustment_work_item", "work_item_id", "is_active"),
    )
    id: Mapped[str] = mapped_column(String, primary_key=True)
    work_item_id: Mapped[str] = mapped_column(
        String, ForeignKey("construction_work_items.id", ondelete="CASCADE"), index=True
    )
    adjustment_kind: Mapped[str] = mapped_column(String(20))
    fixed_percentage: Mapped[object | None] = mapped_column(DECIMAL, nullable=True)
    minimum_percentage: Mapped[object | None] = mapped_column(DECIMAL, nullable=True)
    maximum_percentage: Mapped[object | None] = mapped_column(DECIMAL, nullable=True)
    documented_meaning: Mapped[str] = mapped_column(Text, default="")


class ConstructionMarketAlias(ImportedReferenceMixin, Base):
    __tablename__ = "construction_market_aliases"
    __table_args__ = (
        UniqueConstraint("entity_type", "entity_id", "normalized_alias"),
        Index("ix_construction_alias_search", "normalized_alias", "is_active"),
    )
    id: Mapped[str] = mapped_column(String, primary_key=True)
    entity_type: Mapped[str] = mapped_column(String(40), index=True)
    entity_id: Mapped[str] = mapped_column(String, index=True)
    alias_ar: Mapped[str] = mapped_column(String(500), index=True)
    normalized_alias: Mapped[str] = mapped_column(String(500), index=True)
    alias_origin: Mapped[str] = mapped_column(String(30), index=True)


class ConstructionCalculationSession(Base):
    __tablename__ = "construction_calculation_sessions"
    __table_args__ = (
        Index("ix_construction_session_project_created", "project_id", "created_at"),
        Index(
            "ix_construction_session_work_item_created", "work_item_id", "created_at"
        ),
    )
    id: Mapped[str] = mapped_column(String, primary_key=True)
    calculation_number: Mapped[str] = mapped_column(String(32), unique=True, index=True)
    project_id: Mapped[str | None] = mapped_column(
        String,
        ForeignKey("projects.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    project_name: Mapped[str] = mapped_column(String(300), default="")
    work_item_id: Mapped[str] = mapped_column(
        String, ForeignKey("construction_work_items.id"), index=True
    )
    work_item_code: Mapped[str] = mapped_column(String(32))
    work_item_name: Mapped[str] = mapped_column(String(500))
    measured_quantity: Mapped[object] = mapped_column(DECIMAL)
    execution_quantity: Mapped[object] = mapped_column(DECIMAL)
    measurement_unit: Mapped[str] = mapped_column(String(80))
    selected_crew_ids: Mapped[list] = mapped_column(JSON)
    primary_crew_id: Mapped[str] = mapped_column(String, index=True)
    crew_count: Mapped[int] = mapped_column(Integer)
    required_days: Mapped[object | None] = mapped_column(DECIMAL, nullable=True)
    theoretical_duration: Mapped[object] = mapped_column(DECIMAL)
    planning_duration: Mapped[int] = mapped_column(Integer)
    selected_adjustment_percentage: Mapped[object | None] = mapped_column(
        DECIMAL, nullable=True
    )
    source_import_version: Mapped[str] = mapped_column(String(100), index=True)
    created_by: Mapped[str] = mapped_column(String(200), default="")
    status: Mapped[str] = mapped_column(String(30), default="saved", index=True)
    created_at: Mapped[str] = mapped_column(String(40), index=True)
    updated_at: Mapped[str] = mapped_column(String(40))


class ConstructionCalculationMaterialResult(Base):
    __tablename__ = "construction_calculation_material_results"
    __table_args__ = (
        Index("ix_construction_material_result_session", "session_id", "position"),
    )
    id: Mapped[str] = mapped_column(String, primary_key=True)
    session_id: Mapped[str] = mapped_column(
        String,
        ForeignKey("construction_calculation_sessions.id", ondelete="CASCADE"),
        index=True,
    )
    position: Mapped[int] = mapped_column(Integer)
    material_id: Mapped[str] = mapped_column(
        String, ForeignKey("construction_materials.id")
    )
    material_code: Mapped[str] = mapped_column(String(32))
    material_name: Mapped[str] = mapped_column(String(300))
    selected_rate: Mapped[object] = mapped_column(DECIMAL)
    minimum_rate: Mapped[object | None] = mapped_column(DECIMAL, nullable=True)
    maximum_rate: Mapped[object | None] = mapped_column(DECIMAL, nullable=True)
    material_unit: Mapped[str] = mapped_column(String(80))
    base_quantity: Mapped[object] = mapped_column(DECIMAL)
    waste_percentage: Mapped[object | None] = mapped_column(DECIMAL, nullable=True)
    waste_quantity: Mapped[object] = mapped_column(DECIMAL)
    required_quantity: Mapped[object] = mapped_column(DECIMAL)
    package_capacity: Mapped[object | None] = mapped_column(DECIMAL, nullable=True)
    package_count: Mapped[int | None] = mapped_column(Integer, nullable=True)
    purchased_quantity: Mapped[object | None] = mapped_column(DECIMAL, nullable=True)
    rounding_surplus: Mapped[object | None] = mapped_column(DECIMAL, nullable=True)
    source_rate_code: Mapped[str] = mapped_column(String(32))
    warnings: Mapped[list] = mapped_column(JSON, default=list)


class ConstructionCalculationLaborResult(Base):
    __tablename__ = "construction_calculation_labor_results"
    __table_args__ = (
        Index("ix_construction_labor_result_session", "session_id", "position"),
    )
    id: Mapped[str] = mapped_column(String, primary_key=True)
    session_id: Mapped[str] = mapped_column(
        String,
        ForeignKey("construction_calculation_sessions.id", ondelete="CASCADE"),
        index=True,
    )
    position: Mapped[int] = mapped_column(Integer)
    crew_id: Mapped[str] = mapped_column(String)
    labor_role_id: Mapped[str] = mapped_column(String)
    labor_role_code: Mapped[str] = mapped_column(String(32))
    labor_role_name: Mapped[str] = mapped_column(String(300))
    count_per_crew: Mapped[int | None] = mapped_column(Integer, nullable=True)
    crew_count: Mapped[int] = mapped_column(Integer)
    required_headcount: Mapped[int | None] = mapped_column(Integer, nullable=True)
    planning_duration: Mapped[int] = mapped_column(Integer)
    labor_days: Mapped[int | None] = mapped_column(Integer, nullable=True)
    numerical_count_unspecified: Mapped[int] = mapped_column(Integer, default=0)


class ConstructionCalculationEquipmentResult(Base):
    __tablename__ = "construction_calculation_equipment_results"
    __table_args__ = (
        Index("ix_construction_equipment_result_session", "session_id", "position"),
    )
    id: Mapped[str] = mapped_column(String, primary_key=True)
    session_id: Mapped[str] = mapped_column(
        String,
        ForeignKey("construction_calculation_sessions.id", ondelete="CASCADE"),
        index=True,
    )
    position: Mapped[int] = mapped_column(Integer)
    crew_id: Mapped[str] = mapped_column(String)
    equipment_id: Mapped[str] = mapped_column(String)
    equipment_code: Mapped[str] = mapped_column(String(32))
    equipment_name: Mapped[str] = mapped_column(String(300))
    quantity_per_crew: Mapped[int | None] = mapped_column(Integer, nullable=True)
    crew_count: Mapped[int] = mapped_column(Integer)
    required_equipment: Mapped[int | None] = mapped_column(Integer, nullable=True)
    planning_duration: Mapped[int] = mapped_column(Integer)
    equipment_days: Mapped[int | None] = mapped_column(Integer, nullable=True)
    numerical_quantity_unspecified: Mapped[int] = mapped_column(Integer, default=0)


class ConstructionCalculationSnapshot(Base):
    __tablename__ = "construction_calculation_snapshots"
    id: Mapped[str] = mapped_column(String, primary_key=True)
    session_id: Mapped[str] = mapped_column(
        String,
        ForeignKey("construction_calculation_sessions.id", ondelete="CASCADE"),
        unique=True,
        index=True,
    )
    snapshot_version: Mapped[int] = mapped_column(Integer, default=1)
    payload: Mapped[dict] = mapped_column(JSON)
    source_workbook_sha256: Mapped[str] = mapped_column(String(64))
    formulas_version: Mapped[str] = mapped_column(String(50))
    created_by: Mapped[str] = mapped_column(String(200), default="")
    created_at: Mapped[str] = mapped_column(String(40))


class ConstructionPurchaseRequestLink(Base):
    __tablename__ = "construction_purchase_request_links"
    __table_args__ = (
        UniqueConstraint("calculation_session_id", "revision"),
        Index("ix_construction_request_link_request", "purchase_request_id"),
    )
    id: Mapped[str] = mapped_column(String, primary_key=True)
    calculation_session_id: Mapped[str] = mapped_column(
        String, ForeignKey("construction_calculation_sessions.id"), index=True
    )
    purchase_request_id: Mapped[str] = mapped_column(
        String, ForeignKey("incoming_purchase_requests.id"), index=True
    )
    revision: Mapped[int] = mapped_column(Integer, default=1)
    project_id: Mapped[str | None] = mapped_column(String, nullable=True)
    created_by: Mapped[str] = mapped_column(String(200), default="")
    created_at: Mapped[str] = mapped_column(String(40))


class ConstructionPurchaseRequestItemLink(Base):
    __tablename__ = "construction_purchase_request_item_links"
    __table_args__ = (
        Index("ix_construction_request_item_link_request", "purchase_request_link_id"),
    )
    id: Mapped[str] = mapped_column(String, primary_key=True)
    purchase_request_link_id: Mapped[str] = mapped_column(
        String,
        ForeignKey("construction_purchase_request_links.id", ondelete="CASCADE"),
        index=True,
    )
    purchase_request_item_id: Mapped[str] = mapped_column(
        String,
        ForeignKey("incoming_purchase_request_items.id", ondelete="CASCADE"),
        unique=True,
    )
    material_result_id: Mapped[str] = mapped_column(
        String, ForeignKey("construction_calculation_material_results.id")
    )
    engineering_quantity: Mapped[object] = mapped_column(DECIMAL)
    purchase_quantity: Mapped[object] = mapped_column(DECIMAL)
    unit: Mapped[str] = mapped_column(String(80))
