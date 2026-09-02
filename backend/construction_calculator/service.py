"""Application service orchestrating reference queries, calculations, and snapshots."""

from __future__ import annotations

import hashlib
import uuid
from decimal import Decimal

from sqlalchemy import select

try:
    from ..business_codes import reserve_code
    from ..database import Project
    from ..incoming_requests import (
        IncomingPurchaseRequest,
        IncomingPurchaseRequestItem,
        IncomingRequestStatusHistory,
    )
except ImportError:  # pragma: no cover
    from business_codes import reserve_code
    from database import Project
    from incoming_requests import (
        IncomingPurchaseRequest,
        IncomingPurchaseRequestItem,
        IncomingRequestStatusHistory,
    )

from .domain import (
    CalculationInput,
    EquipmentInput,
    FORMULAS_VERSION,
    LaborInput,
    MaterialInput,
    calculate,
    decimal_json,
    decimal_value,
    source_formula_manifest,
)
from .models import (
    ConstructionCalculationEquipmentResult,
    ConstructionCalculationLaborResult,
    ConstructionCalculationMaterialResult,
    ConstructionCalculationSession,
    ConstructionCalculationSnapshot,
    ConstructionCategory,
    ConstructionEquipment,
    ConstructionImportRun,
    ConstructionLaborRole,
    ConstructionMarketAlias,
    ConstructionMaterial,
    ConstructionMaterialRate,
    ConstructionPurchaseRequestItemLink,
    ConstructionPurchaseRequestLink,
    ConstructionWorkItem,
)
from .repository import ConstructionRepository, utc_now
from .seed import import_reference_workbook
from .domain import normalize_arabic_search


PURCHASE_REQUEST_CLASSIFICATIONS = {
    "material_purchase": "Material purchase",
    "tool_purchase": "Tool purchase",
    "equipment_rental": "Equipment rental",
    "subcontractor_labor": "Subcontractor or labor requirement",
}


class ConstructionCalculatorService:
    def __init__(self, repository: ConstructionRepository):
        self.repository = repository

    def categories(self) -> list[dict]:
        return self.repository.list_categories()

    def options(self) -> dict:
        options = self.repository.reference_options()
        options["request_classifications"] = [
            {"code": code, "name": name}
            for code, name in PURCHASE_REQUEST_CLASSIFICATIONS.items()
        ]
        return options

    def search(self, **filters) -> dict:
        return self.repository.search_work_items(**filters)

    def work_item(self, work_item_id: str) -> dict:
        detail = self.repository.work_item_detail(work_item_id)
        if detail is None:
            raise LookupError("Construction work item was not found")
        return decimal_json(detail)

    def _resolve_adjustment(self, detail: dict, payload: dict) -> Decimal | None:
        adjustment_id = payload.get("adjustment_id")
        selected = payload.get("adjustment_percentage")
        if not adjustment_id:
            return None
        adjustment = next(
            (row for row in detail["adjustments"] if row["id"] == adjustment_id), None
        )
        if adjustment is None:
            raise ValueError("Selected adjustment is not attached to the work item")
        if adjustment["kind"] == "fixed":
            return Decimal(adjustment["fixed_percentage"])
        if selected is None:
            raise ValueError(
                "A selected adjustment percentage is required for a source range"
            )
        chosen = decimal_value(selected, "adjustment_percentage")
        minimum = Decimal(adjustment["minimum_percentage"])
        maximum = Decimal(adjustment["maximum_percentage"])
        if not minimum <= chosen <= maximum:
            raise ValueError(
                "Selected adjustment percentage must remain inside the source range"
            )
        return chosen

    def _build_calculation(self, payload: dict):
        detail = self.repository.work_item_detail(payload["work_item_id"])
        if detail is None:
            raise LookupError("Construction work item was not found")
        if payload.get("measurement_unit") != detail["measurement_unit"]:
            raise ValueError(
                "Measurement unit is not compatible with the selected work item"
            )
        selected_crew_ids = list(dict.fromkeys(payload.get("selected_crew_ids") or []))
        if not selected_crew_ids:
            raise ValueError("Select at least one source crew/scenario")
        primary_crew_id = payload.get("primary_crew_id")
        if primary_crew_id not in selected_crew_ids:
            raise ValueError("Primary crew must be one of the selected source crews")
        crew_map = {row["id"]: row for row in detail["crews"]}
        if any(crew_id not in crew_map for crew_id in selected_crew_ids):
            raise ValueError("A selected crew is not attached to the work item")
        primary = crew_map[primary_crew_id]
        if not primary["productivity"]:
            raise ValueError(
                "The primary crew has no numerical productivity in the workbook"
            )

        selected_rates = payload.get("selected_rates") or {}
        packages = payload.get("package_capacities") or {}
        labor_overrides = payload.get("labor_count_overrides") or {}
        equipment_overrides = payload.get("equipment_quantity_overrides") or {}
        material_inputs: list[MaterialInput] = []
        labor_inputs: list[LaborInput] = []
        equipment_inputs: list[EquipmentInput] = []
        for crew_id in selected_crew_ids:
            crew = crew_map[crew_id]
            for rate in crew["material_rates"]:
                material_inputs.append(
                    MaterialInput(
                        rate_code=rate["code"],
                        material_id=rate["material_id"],
                        material_code=rate["material_code"],
                        material_name=rate["material_name"],
                        material_unit=rate["material_unit"],
                        rate_kind=rate["rate_kind"],
                        fixed_rate=(
                            Decimal(rate["fixed_rate"])
                            if rate["fixed_rate"] is not None
                            else None
                        ),
                        minimum_rate=(
                            Decimal(rate["minimum_rate"])
                            if rate["minimum_rate"] is not None
                            else None
                        ),
                        maximum_rate=(
                            Decimal(rate["maximum_rate"])
                            if rate["maximum_rate"] is not None
                            else None
                        ),
                        basis_quantity=Decimal(rate["basis_quantity"]),
                        waste_percentage=(
                            Decimal(rate["waste_percentage"])
                            if rate["waste_percentage"] is not None
                            else None
                        ),
                        selected_rate=(
                            decimal_value(
                                selected_rates[rate["code"]],
                                f"selected_rate.{rate['code']}",
                            )
                            if rate["code"] in selected_rates
                            else None
                        ),
                        package_capacity=(
                            decimal_value(
                                packages[rate["material_id"]],
                                f"package_capacity.{rate['material_id']}",
                            )
                            if rate["material_id"] in packages
                            and packages[rate["material_id"]] not in (None, "")
                            else (
                                Decimal(rate["package_capacity"])
                                if rate["package_capacity"] is not None
                                else None
                            )
                        ),
                        source=rate["source"],
                    )
                )
            for member in crew["labor"]:
                override = labor_overrides.get(member["id"])
                if override is not None:
                    if not member["project_specific_count_allowed"]:
                        raise ValueError(
                            "A project-specific labor count is allowed only when the workbook count is unspecified"
                        )
                    if (
                        not isinstance(override, int)
                        or isinstance(override, bool)
                        or override <= 0
                    ):
                        raise ValueError(
                            "Project-specific labor counts must be positive integers"
                        )
                labor_inputs.append(
                    LaborInput(
                        crew_id=crew_id,
                        labor_role_id=member["labor_role_id"],
                        labor_role_code=member["code"],
                        labor_role_name=member["name"],
                        count_per_crew=member["count_per_crew"],
                        project_specific_count_per_crew=override,
                        source=member["source"],
                    )
                )
            for member in crew["equipment"]:
                override = equipment_overrides.get(member["id"])
                if override is not None:
                    if not member["project_specific_quantity_allowed"]:
                        raise ValueError(
                            "A project-specific equipment quantity is allowed only when the workbook quantity is unspecified"
                        )
                    if (
                        not isinstance(override, int)
                        or isinstance(override, bool)
                        or override <= 0
                    ):
                        raise ValueError(
                            "Project-specific equipment quantities must be positive integers"
                        )
                equipment_inputs.append(
                    EquipmentInput(
                        crew_id=crew_id,
                        equipment_id=member["equipment_id"],
                        equipment_code=member["code"],
                        equipment_name=member["name"],
                        quantity_per_crew=member["quantity_per_crew"],
                        project_specific_quantity_per_crew=override,
                        source=member["source"],
                    )
                )
        adjustment = self._resolve_adjustment(detail, payload)
        calculation_input = CalculationInput(
            measured_quantity=decimal_value(
                payload["measured_quantity"], "measured_quantity"
            ),
            measurement_unit=detail["measurement_unit"],
            productivity=Decimal(primary["productivity"]["daily_productivity"]),
            crew_count=payload.get("crew_count"),
            required_days=(
                decimal_value(payload["required_days"], "required_days")
                if payload.get("required_days") not in (None, "")
                else None
            ),
            adjustment_percentage=adjustment,
            materials=tuple(material_inputs),
            labor=tuple(labor_inputs),
            equipment=tuple(equipment_inputs),
        )
        result = calculate(calculation_input)
        return detail, primary, adjustment, result

    def preview(self, payload: dict) -> dict:
        detail, primary, adjustment, result = self._build_calculation(payload)
        return decimal_json(
            {
                "work_item": detail,
                "primary_crew": primary,
                "measured_quantity": payload["measured_quantity"],
                "selected_adjustment_percentage": adjustment,
                "execution_quantity": result.execution_quantity,
                "crew_count": result.crew_count,
                "theoretical_duration": result.theoretical_duration,
                "planning_duration": result.planning_duration,
                "materials": result.materials,
                "labor": result.labor,
                "equipment": result.equipment,
                "warnings": result.warnings,
                "formulas": source_formula_manifest(),
            }
        )

    def save(
        self,
        payload: dict,
        actor: str,
        recalculated_from_session_id: str = "",
    ) -> dict:
        detail, primary, adjustment, result = self._build_calculation(payload)
        project = None
        if payload.get("project_id"):
            project = self.repository.session.get(Project, payload["project_id"])
            if project is None:
                raise ValueError("Selected project does not exist")
        number = reserve_code(
            "construction_calculations",
            "CON-CALC-",
            6,
            ("CON-CALC-",),
            ConstructionCalculationSession,
            ConstructionCalculationSession.calculation_number,
        )
        now = utc_now()
        session_id = str(uuid.uuid4())
        row = ConstructionCalculationSession(
            id=session_id,
            calculation_number=number,
            project_id=project.id if project else None,
            project_name=project.name if project else "",
            work_item_id=detail["id"],
            work_item_code=detail["code"],
            work_item_name=detail["name_ar"],
            measured_quantity=decimal_value(payload["measured_quantity"]),
            execution_quantity=result.execution_quantity,
            measurement_unit=detail["measurement_unit"],
            selected_crew_ids=payload["selected_crew_ids"],
            primary_crew_id=payload["primary_crew_id"],
            crew_count=result.crew_count,
            required_days=(
                decimal_value(payload["required_days"])
                if payload.get("required_days") not in (None, "")
                else None
            ),
            theoretical_duration=result.theoretical_duration,
            planning_duration=result.planning_duration,
            selected_adjustment_percentage=adjustment,
            source_import_version=detail["import_version"],
            created_by=actor,
            status="saved",
            created_at=now,
            updated_at=now,
        )
        self.repository.session.add(row)
        self.repository.session.flush()
        material_rows = []
        for item in result.materials:
            result_id = str(uuid.uuid4())
            material_rows.append((result_id, item))
            self.repository.session.add(
                ConstructionCalculationMaterialResult(
                    id=result_id,
                    session_id=session_id,
                    position=item["position"],
                    material_id=item["material_id"],
                    material_code=item["material_code"],
                    material_name=item["material_name"],
                    selected_rate=item["selected_rate"],
                    minimum_rate=item["minimum_rate"],
                    maximum_rate=item["maximum_rate"],
                    material_unit=item["material_unit"],
                    base_quantity=item["base_quantity"],
                    waste_percentage=item["waste_percentage"],
                    waste_quantity=item["waste_quantity"],
                    required_quantity=item["required_quantity"],
                    package_capacity=item["package_capacity"],
                    package_count=item["package_count"],
                    purchased_quantity=item["purchased_quantity"],
                    rounding_surplus=item["rounding_surplus"],
                    source_rate_code=item["rate_code"],
                    warnings=item["warnings"],
                )
            )
        for item in result.labor:
            persisted = {
                key: value
                for key, value in item.items()
                if key in ConstructionCalculationLaborResult.__table__.columns
            }
            self.repository.session.add(
                ConstructionCalculationLaborResult(
                    id=str(uuid.uuid4()), session_id=session_id, **persisted
                )
            )
        for item in result.equipment:
            persisted = {
                key: value
                for key, value in item.items()
                if key in ConstructionCalculationEquipmentResult.__table__.columns
            }
            self.repository.session.add(
                ConstructionCalculationEquipmentResult(
                    id=str(uuid.uuid4()), session_id=session_id, **persisted
                )
            )
        import_run = self.repository.session.scalar(
            select(ConstructionImportRun).where(
                ConstructionImportRun.import_version == detail["import_version"]
            )
        )
        preview = self.preview(payload)
        snapshot_payload = {
            "calculation_number": number,
            "input": payload,
            "actor": actor,
            "calculated_at": now,
            "result": preview,
            "formulas_version": FORMULAS_VERSION,
            "formulas": source_formula_manifest(),
            "recalculated_from_session_id": recalculated_from_session_id or None,
        }
        self.repository.session.add(
            ConstructionCalculationSnapshot(
                id=str(uuid.uuid4()),
                session_id=session_id,
                snapshot_version=1,
                payload=decimal_json(snapshot_payload),
                source_workbook_sha256=import_run.workbook_sha256 if import_run else "",
                formulas_version=FORMULAS_VERSION,
                created_by=actor,
                created_at=now,
            )
        )
        self.repository.session.commit()
        return {
            "id": session_id,
            "calculation_number": number,
            "snapshot": decimal_json(snapshot_payload),
            "recalculated_from_session_id": recalculated_from_session_id or None,
        }

    def list_saved(self, limit: int = 100) -> list[dict]:
        rows = self.repository.session.scalars(
            select(ConstructionCalculationSession)
            .order_by(ConstructionCalculationSession.created_at.desc())
            .limit(limit)
        ).all()
        return decimal_json(
            [
                {
                    "id": row.id,
                    "calculation_number": row.calculation_number,
                    "project_name": row.project_name,
                    "work_item_name": row.work_item_name,
                    "measured_quantity": row.measured_quantity,
                    "measurement_unit": row.measurement_unit,
                    "planning_duration": row.planning_duration,
                    "created_by": row.created_by,
                    "created_at": row.created_at,
                }
                for row in rows
            ]
        )

    def saved_detail(self, session_id: str) -> dict:
        row = self.repository.session.get(ConstructionCalculationSession, session_id)
        if row is None:
            raise LookupError("Saved calculation was not found")
        snapshot = self.repository.session.scalar(
            select(ConstructionCalculationSnapshot).where(
                ConstructionCalculationSnapshot.session_id == session_id
            )
        )
        links = self.repository.session.scalars(
            select(ConstructionPurchaseRequestLink)
            .where(ConstructionPurchaseRequestLink.calculation_session_id == session_id)
            .order_by(ConstructionPurchaseRequestLink.revision)
        ).all()
        return {
            "id": row.id,
            "calculation_number": row.calculation_number,
            "snapshot": snapshot.payload if snapshot else {},
            "purchase_requests": [
                {"request_id": link.purchase_request_id, "revision": link.revision}
                for link in links
            ],
        }

    def recalculate_latest(self, session_id: str, actor: str) -> dict:
        snapshot = self.repository.session.scalar(
            select(ConstructionCalculationSnapshot).where(
                ConstructionCalculationSnapshot.session_id == session_id
            )
        )
        if snapshot is None or not snapshot.payload.get("input"):
            raise LookupError("Saved calculation snapshot was not found")
        return self.save(
            dict(snapshot.payload["input"]),
            actor,
            recalculated_from_session_id=session_id,
        )

    def convert_to_purchase_request(
        self, session_id: str, payload: dict, actor: str
    ) -> dict:
        calculation = self.repository.session.get(
            ConstructionCalculationSession, session_id
        )
        if calculation is None:
            raise LookupError("Saved calculation was not found")
        existing_links = self.repository.session.scalars(
            select(ConstructionPurchaseRequestLink)
            .where(ConstructionPurchaseRequestLink.calculation_session_id == session_id)
            .order_by(ConstructionPurchaseRequestLink.revision)
        ).all()
        if existing_links and not payload.get("create_revision"):
            raise FileExistsError(
                "A purchase request already exists for this calculation"
            )
        materials = self.repository.session.scalars(
            select(ConstructionCalculationMaterialResult)
            .where(ConstructionCalculationMaterialResult.session_id == session_id)
            .order_by(ConstructionCalculationMaterialResult.position)
        ).all()
        if not materials:
            raise ValueError("Saved calculation contains no material requirements")
        revision = len(existing_links) + 1
        now = utc_now()
        request_id = str(uuid.uuid4())
        request_number = (
            f"REQ-CALC-{now[:10].replace('-', '')}-{uuid.uuid4().hex[:8].upper()}"
        )
        fingerprint = hashlib.sha256(f"{session_id}:{revision}".encode()).hexdigest()
        request = IncomingPurchaseRequest(
            id=request_id,
            request_number=request_number,
            requester_name=actor or "Construction calculator",
            company_name="",
            phone_number="",
            whatsapp_number="",
            email="",
            project_name=calculation.project_name,
            project_location=payload.get("project_location", ""),
            delivery_location=payload["delivery_location"],
            required_delivery_date=payload["required_delivery_date"],
            priority=payload.get("priority", "normal"),
            notes=f"Generated from {calculation.calculation_number}; material purchase only",
            status="new",
            assigned_employee="",
            submission_token=str(uuid.uuid4()),
            content_fingerprint=fingerprint,
            requester_ip_hash="internal-calculator",
            user_agent_hash="internal-calculator",
            converted_customer_id="",
            conversion_type="material_purchase",
            converted_document_id="",
            created_at=now,
            updated_at=now,
        )
        self.repository.session.add(request)
        self.repository.session.flush()
        link = ConstructionPurchaseRequestLink(
            id=str(uuid.uuid4()),
            calculation_session_id=session_id,
            purchase_request_id=request_id,
            revision=revision,
            project_id=calculation.project_id,
            created_by=actor,
            created_at=now,
        )
        self.repository.session.add(link)
        self.repository.session.flush()
        for position, material in enumerate(materials, 1):
            purchase_quantity = (
                material.purchased_quantity or material.required_quantity
            )
            request_item_id = str(uuid.uuid4())
            request_item = IncomingPurchaseRequestItem(
                id=request_item_id,
                request_id=request_id,
                position=position,
                product_name=material.material_name,
                preferred_brand="",
                main_category="Construction material",
                subcategory=calculation.work_item_name,
                specifications=(
                    f"Engineering requirement {material.required_quantity} {material.material_unit}; "
                    f"source {calculation.calculation_number} / {material.source_rate_code}"
                ),
                quantity=purchase_quantity,
                unit=material.material_unit,
            )
            self.repository.session.add(request_item)
            self.repository.session.flush()
            self.repository.session.add(
                ConstructionPurchaseRequestItemLink(
                    id=str(uuid.uuid4()),
                    purchase_request_link_id=link.id,
                    purchase_request_item_id=request_item_id,
                    material_result_id=material.id,
                    engineering_quantity=material.required_quantity,
                    purchase_quantity=purchase_quantity,
                    unit=material.material_unit,
                )
            )
        self.repository.session.add(
            IncomingRequestStatusHistory(
                id=str(uuid.uuid4()),
                request_id=request_id,
                from_status="",
                to_status="new",
                changed_by=actor,
                note=f"Created from {calculation.calculation_number}",
                created_at=now,
            )
        )
        self.repository.session.commit()
        return {
            "request_id": request_id,
            "request_number": request_number,
            "revision": revision,
            "material_count": len(materials),
            "classification": "material_purchase",
        }

    def import_workbook(self, path, import_version: str) -> dict:
        return import_reference_workbook(self.repository.session, path, import_version)

    def update_packaging(self, material_id: str, payload: dict) -> dict:
        material = self.repository.session.get(ConstructionMaterial, material_id)
        if material is None:
            raise LookupError("Construction material was not found")
        capacity = payload.get("package_capacity")
        material.package_capacity = (
            decimal_value(capacity, "package_capacity")
            if capacity not in (None, "")
            else None
        )
        if material.package_capacity is not None and material.package_capacity <= 0:
            raise ValueError("Package capacity must be greater than zero")
        material.package_unit = payload.get("package_unit", "").strip()
        material.package_purchase_unit = payload.get(
            "package_purchase_unit", ""
        ).strip()
        material.package_notes = payload.get("package_notes", "").strip()
        material.updated_at = utc_now()
        self.repository.session.commit()
        return decimal_json(
            {
                "id": material.id,
                "code": material.code,
                "name": material.name_ar,
                "package_capacity": material.package_capacity,
                "package_unit": material.package_unit,
                "package_purchase_unit": material.package_purchase_unit,
                "package_notes": material.package_notes,
            }
        )

    def set_material_rate_status(self, rate_id: str, is_active: bool) -> dict:
        rate = self.repository.session.get(ConstructionMaterialRate, rate_id)
        if rate is None:
            raise LookupError("Construction material rate was not found")
        rate.is_active = int(is_active)
        rate.updated_at = utc_now()
        self.repository.session.commit()
        return {
            "id": rate.id,
            "code": rate.code,
            "is_active": bool(rate.is_active),
            "source_workbook": rate.source_workbook,
            "source_worksheet": rate.source_worksheet,
            "source_row": rate.source_row,
        }

    def import_market_aliases(self, rows: list[dict], source_name: str) -> dict:
        entity_models = {
            "material": ConstructionMaterial,
            "work_item": ConstructionWorkItem,
            "labor_role": ConstructionLaborRole,
            "equipment": ConstructionEquipment,
            "category": ConstructionCategory,
        }
        inserted = skipped = rejected = 0
        issues = []
        now = utc_now()
        for position, row in enumerate(rows, 2):
            entity_type = str(row.get("entity_type") or "").strip()
            code = str(row.get("code") or "").strip()
            alias = str(row.get("alias") or "").strip()
            model = entity_models.get(entity_type)
            if model is None or not code or not alias:
                rejected += 1
                issues.append(
                    {
                        "row": position,
                        "reason": "entity_type, code, and alias are required",
                    }
                )
                continue
            entity = self.repository.session.scalar(
                select(model).where(model.code == code)
            )
            if entity is None:
                rejected += 1
                issues.append(
                    {"row": position, "reason": f"Unknown reference code: {code}"}
                )
                continue
            normalized = normalize_arabic_search(alias)
            existing = self.repository.session.scalar(
                select(ConstructionMarketAlias).where(
                    ConstructionMarketAlias.entity_type == entity_type,
                    ConstructionMarketAlias.entity_id == entity.id,
                    ConstructionMarketAlias.normalized_alias == normalized,
                )
            )
            if existing:
                skipped += 1
                continue
            identity = f"alias|{entity_type}|{entity.id}|{normalized}"
            self.repository.session.add(
                ConstructionMarketAlias(
                    id=str(
                        uuid.uuid5(
                            uuid.UUID("7d21d859-a9bc-4f15-96c3-cc564b8ab759"), identity
                        )
                    ),
                    code=self.repository._next_code(ConstructionMarketAlias),
                    is_active=1,
                    source_workbook=source_name,
                    source_worksheet="Aliases",
                    source_row=position,
                    source_text=alias,
                    source_identity=identity,
                    import_version=f"market-alias-{now[:10]}",
                    created_at=now,
                    updated_at=now,
                    entity_type=entity_type,
                    entity_id=entity.id,
                    alias_ar=alias,
                    normalized_alias=normalized,
                    alias_origin="administrator",
                )
            )
            inserted += 1
        self.repository.session.commit()
        return {
            "inserted": inserted,
            "skipped": skipped,
            "rejected": rejected,
            "issues": issues,
        }
