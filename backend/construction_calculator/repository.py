"""Repository implementation for construction reference and calculation data."""

from __future__ import annotations

import re
import uuid
from collections import Counter
from datetime import datetime, timezone
from typing import Any, Iterable

from sqlalchemy import and_, func, or_, select
from sqlalchemy.orm import Session

from .domain import generated_aliases, normalize_arabic_search
from .models import (
    ConstructionCategory,
    ConstructionCrewEquipment,
    ConstructionCrewLaborMember,
    ConstructionEquipment,
    ConstructionImportIssue,
    ConstructionImportRun,
    ConstructionLaborRole,
    ConstructionMarketAlias,
    ConstructionMaterial,
    ConstructionMaterialRate,
    ConstructionProductivityRate,
    ConstructionWorkCrew,
    ConstructionWorkItem,
    ConstructionWorkItemAdjustment,
)
from .workbook_import import ImportBundle, labor_role_kind


CODE_PREFIXES = {
    ConstructionCategory: ("CON-CAT-", 4),
    ConstructionWorkItem: ("CON-WI-", 6),
    ConstructionMaterial: ("CON-MAT-", 6),
    ConstructionLaborRole: ("CON-LAB-", 6),
    ConstructionEquipment: ("CON-EQP-", 6),
    ConstructionWorkCrew: ("CON-CREW-", 6),
    ConstructionMaterialRate: ("CON-RATE-", 6),
    ConstructionProductivityRate: ("CON-PROD-", 6),
    ConstructionWorkItemAdjustment: ("CON-ADJ-", 6),
    ConstructionMarketAlias: ("CON-ALIAS-", 6),
    ConstructionCrewLaborMember: ("CON-CLAB-", 6),
    ConstructionCrewEquipment: ("CON-CEQP-", 6),
}
NAMESPACE = uuid.UUID("7d21d859-a9bc-4f15-96c3-cc564b8ab759")


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def stable_id(identity: str) -> str:
    return str(uuid.uuid5(NAMESPACE, identity))


def _text(parts: Iterable[str]) -> str:
    return " | ".join(part for part in parts if part)


class ConstructionRepository:
    def __init__(self, session: Session):
        self.session = session
        self._next_codes: dict[type, int] = {}

    def _next_code(self, model: type) -> str:
        prefix, width = CODE_PREFIXES[model]
        if model not in self._next_codes:
            maximum = 0
            for code in self.session.scalars(select(model.code)).all():
                match = re.fullmatch(rf"{re.escape(prefix)}(\d+)", code or "")
                if match:
                    maximum = max(maximum, int(match.group(1)))
            self._next_codes[model] = maximum + 1
        value = self._next_codes[model]
        self._next_codes[model] += 1
        return f"{prefix}{value:0{width}d}"

    def _upsert(
        self, model: type, identity: str, values: dict[str, Any], counters: Counter
    ) -> Any:
        row = self.session.scalar(
            select(model).where(model.source_identity == identity)
        )
        if row is None:
            row = model(
                id=stable_id(identity),
                code=self._next_code(model),
                source_identity=identity,
                **values,
            )
            self.session.add(row)
            self.session.flush()
            counters[f"inserted_{model.__tablename__}"] += 1
            counters["inserted"] += 1
            return row
        changed = False
        for key, value in values.items():
            if key == "created_at":
                continue
            if getattr(row, key) != value:
                setattr(row, key, value)
                changed = True
        if changed:
            counters[f"updated_{model.__tablename__}"] += 1
            counters["updated"] += 1
        else:
            counters[f"skipped_{model.__tablename__}"] += 1
            counters["skipped"] += 1
        return row

    @staticmethod
    def _source_values(
        bundle: ImportBundle, row: int, text: str, now: str
    ) -> dict[str, Any]:
        return {
            "is_active": 1,
            "source_workbook": bundle.workbook_name,
            "source_worksheet": bundle.worksheet,
            "source_row": row,
            "source_text": text,
            "import_version": bundle.import_version,
            "created_at": now,
            "updated_at": now,
        }

    def import_bundle(self, bundle: ImportBundle) -> dict[str, Any]:
        existing = self.session.scalar(
            select(ConstructionImportRun).where(
                ConstructionImportRun.import_version == bundle.import_version
            )
        )
        if existing and existing.status == "completed":
            if existing.workbook_sha256 != bundle.workbook_sha256:
                raise ValueError(
                    "Import version already exists with a different workbook checksum"
                )
            report = dict(existing.report_json or {})
            report["already_installed"] = True
            return report

        now = utc_now()
        run = existing or ConstructionImportRun(
            id=str(uuid.uuid4()),
            import_version=bundle.import_version,
            workbook_name=bundle.workbook_name,
            workbook_sha256=bundle.workbook_sha256,
            status="running",
            started_at=now,
            completed_at="",
            report_json={},
        )
        if existing is None:
            self.session.add(run)
        counters: Counter = Counter()

        category_map: dict[str, ConstructionCategory] = {}
        for parsed in bundle.categories:
            source = self._source_values(
                bundle, parsed.source_row, parsed.source_text, now
            )
            row = self._upsert(
                ConstructionCategory,
                parsed.source_identity,
                {
                    **source,
                    "name_ar": parsed.name,
                    "name_en": "",
                    "search_text": normalize_arabic_search(parsed.name),
                    "technical_notes": _text(parsed.notes),
                },
                counters,
            )
            category_map[parsed.source_identity] = row

        material_map: dict[tuple[str, str], ConstructionMaterial] = {}
        labor_map: dict[str, ConstructionLaborRole] = {}
        equipment_map: dict[str, ConstructionEquipment] = {}
        alias_targets: list[tuple[str, str, str, int, str]] = []

        for parsed_item in bundle.work_items:
            category = category_map[parsed_item.category_identity]
            name = " ".join(parsed_item.name_parts)
            item_source = _text(parsed_item.source_text_parts)
            item = self._upsert(
                ConstructionWorkItem,
                parsed_item.source_identity,
                {
                    **self._source_values(
                        bundle, parsed_item.source_row, item_source, now
                    ),
                    "category_id": category.id,
                    "name_ar": name,
                    "name_en": "",
                    "description": name,
                    "measurement_unit": parsed_item.measurement_unit,
                    "conditions_consumption": _text(parsed_item.notes),
                    "conditions_productivity": _text(parsed_item.notes),
                    "technical_notes": _text(parsed_item.notes),
                    "search_text": normalize_arabic_search(
                        f"{name} {category.name_ar} {parsed_item.measurement_unit}"
                    ),
                },
                counters,
            )
            alias_targets.append(
                ("work_item", item.id, name, parsed_item.source_row, item_source)
            )
            for parsed_adjustment in parsed_item.adjustments:
                self._upsert(
                    ConstructionWorkItemAdjustment,
                    parsed_adjustment.source_identity,
                    {
                        **self._source_values(
                            bundle,
                            parsed_adjustment.source_row,
                            parsed_adjustment.source_text,
                            now,
                        ),
                        "work_item_id": item.id,
                        "adjustment_kind": parsed_adjustment.kind,
                        "fixed_percentage": parsed_adjustment.fixed_percentage,
                        "minimum_percentage": parsed_adjustment.minimum_percentage,
                        "maximum_percentage": parsed_adjustment.maximum_percentage,
                        "documented_meaning": parsed_adjustment.documented_meaning,
                    },
                    counters,
                )
            for parsed_crew in parsed_item.crews:
                crew_text = _text(parsed_crew.source_text_parts)
                crew = self._upsert(
                    ConstructionWorkCrew,
                    parsed_crew.source_identity,
                    {
                        **self._source_values(
                            bundle, parsed_crew.source_row, crew_text, now
                        ),
                        "work_item_id": item.id,
                        "description": _text(parsed_crew.description_parts),
                        "scenario_label": crew_text,
                        "numerical_breakdown_complete": int(
                            bool(parsed_crew.participants)
                            and all(
                                member.quantity is not None
                                for member in parsed_crew.participants
                            )
                        ),
                    },
                    counters,
                )
                if parsed_crew.productivity is not None:
                    productivity_identity = (
                        f"{bundle.worksheet}|productivity|{parsed_crew.source_row:04d}"
                    )
                    self._upsert(
                        ConstructionProductivityRate,
                        productivity_identity,
                        {
                            **self._source_values(
                                bundle,
                                parsed_crew.source_row,
                                str(parsed_crew.productivity),
                                now,
                            ),
                            "work_item_id": item.id,
                            "crew_id": crew.id,
                            "daily_productivity": parsed_crew.productivity,
                            "productivity_unit": parsed_crew.productivity_unit,
                            "conditions": parsed_crew.productivity_conditions,
                        },
                        counters,
                    )
                for participant in parsed_crew.participants:
                    normalized = normalize_arabic_search(participant.name)
                    if participant.kind == "labor":
                        role = labor_map.get(normalized)
                        if role is None:
                            identity = f"labor-role|{normalized}"
                            role = self._upsert(
                                ConstructionLaborRole,
                                identity,
                                {
                                    **self._source_values(
                                        bundle,
                                        participant.source_row,
                                        participant.source_text,
                                        now,
                                    ),
                                    "name_ar": participant.name,
                                    "name_en": "",
                                    "role_kind": labor_role_kind(participant.name),
                                    "search_text": normalized,
                                },
                                counters,
                            )
                            labor_map[normalized] = role
                            alias_targets.append(
                                (
                                    "labor_role",
                                    role.id,
                                    role.name_ar,
                                    participant.source_row,
                                    participant.source_text,
                                )
                            )
                        self._upsert(
                            ConstructionCrewLaborMember,
                            participant.source_identity,
                            {
                                **self._source_values(
                                    bundle,
                                    participant.source_row,
                                    participant.source_text,
                                    now,
                                ),
                                "crew_id": crew.id,
                                "labor_role_id": role.id,
                                "count_per_crew": participant.quantity,
                                "project_specific_count_allowed": int(
                                    participant.quantity is None
                                ),
                                "notes": (
                                    ""
                                    if participant.quantity is not None
                                    else "Source count unspecified"
                                ),
                            },
                            counters,
                        )
                    else:
                        equipment = equipment_map.get(normalized)
                        if equipment is None:
                            identity = f"equipment|{normalized}"
                            equipment = self._upsert(
                                ConstructionEquipment,
                                identity,
                                {
                                    **self._source_values(
                                        bundle,
                                        participant.source_row,
                                        participant.source_text,
                                        now,
                                    ),
                                    "name_ar": participant.name,
                                    "name_en": "",
                                    "search_text": normalized,
                                },
                                counters,
                            )
                            equipment_map[normalized] = equipment
                            alias_targets.append(
                                (
                                    "equipment",
                                    equipment.id,
                                    equipment.name_ar,
                                    participant.source_row,
                                    participant.source_text,
                                )
                            )
                        self._upsert(
                            ConstructionCrewEquipment,
                            participant.source_identity,
                            {
                                **self._source_values(
                                    bundle,
                                    participant.source_row,
                                    participant.source_text,
                                    now,
                                ),
                                "crew_id": crew.id,
                                "equipment_id": equipment.id,
                                "quantity_per_crew": participant.quantity,
                                "project_specific_quantity_allowed": int(
                                    participant.quantity is None
                                ),
                                "notes": (
                                    ""
                                    if participant.quantity is not None
                                    else "Source quantity unspecified"
                                ),
                            },
                            counters,
                        )
                for parsed_rate in parsed_crew.rates:
                    material_key = (
                        normalize_arabic_search(parsed_rate.name),
                        parsed_rate.material_unit,
                    )
                    material = material_map.get(material_key)
                    if material is None:
                        identity = f"material|{material_key[0]}|{normalize_arabic_search(material_key[1])}"
                        material = self._upsert(
                            ConstructionMaterial,
                            identity,
                            {
                                **self._source_values(
                                    bundle,
                                    parsed_rate.source_row,
                                    parsed_rate.source_text,
                                    now,
                                ),
                                "name_ar": parsed_rate.name,
                                "name_en": "",
                                "default_unit": parsed_rate.material_unit,
                                "search_text": normalize_arabic_search(
                                    f"{parsed_rate.name} {parsed_rate.material_unit}"
                                ),
                                "package_capacity": None,
                                "package_unit": "",
                                "package_purchase_unit": "",
                                "package_notes": "",
                            },
                            counters,
                        )
                        material_map[material_key] = material
                        alias_targets.append(
                            (
                                "material",
                                material.id,
                                material.name_ar,
                                parsed_rate.source_row,
                                parsed_rate.source_text,
                            )
                        )
                    self._upsert(
                        ConstructionMaterialRate,
                        parsed_rate.source_identity,
                        {
                            **self._source_values(
                                bundle,
                                parsed_rate.source_row,
                                parsed_rate.source_text,
                                now,
                            ),
                            "work_item_id": item.id,
                            "crew_id": crew.id,
                            "material_id": material.id,
                            "rate_kind": parsed_rate.rate_kind,
                            "fixed_rate": parsed_rate.fixed_rate,
                            "minimum_rate": parsed_rate.minimum_rate,
                            "maximum_rate": parsed_rate.maximum_rate,
                            "material_unit": parsed_rate.material_unit,
                            "basis_quantity": parsed_rate.basis_quantity,
                            "basis_unit": parsed_rate.basis_unit,
                            "waste_percentage": parsed_rate.waste_percentage,
                            "conditions": parsed_rate.conditions,
                        },
                        counters,
                    )

        for category in category_map.values():
            alias_targets.append(
                (
                    "category",
                    category.id,
                    category.name_ar,
                    category.source_row,
                    category.source_text,
                )
            )
        for entity_type, entity_id, name, source_row, source_text in alias_targets:
            seen_aliases: set[str] = set()
            for alias in generated_aliases(name):
                normalized = normalize_arabic_search(alias)
                if normalized in seen_aliases:
                    continue
                seen_aliases.add(normalized)
                identity = f"alias|{entity_type}|{entity_id}|{normalized}"
                self._upsert(
                    ConstructionMarketAlias,
                    identity,
                    {
                        **self._source_values(bundle, source_row, source_text, now),
                        "entity_type": entity_type,
                        "entity_id": entity_id,
                        "alias_ar": alias,
                        "normalized_alias": normalized,
                        "alias_origin": "workbook" if alias == name else "generated",
                    },
                    counters,
                )

        self.session.query(ConstructionImportIssue).filter(
            ConstructionImportIssue.import_run_id == run.id
        ).delete(synchronize_session=False)
        for issue in bundle.issues:
            self.session.add(
                ConstructionImportIssue(
                    id=str(uuid.uuid4()),
                    import_run_id=run.id,
                    severity=issue.severity,
                    entity_type=issue.entity_type,
                    source_worksheet=issue.sheet,
                    source_row=issue.row,
                    source_text=issue.source_text,
                    reason=issue.reason,
                    created_at=now,
                )
            )

        entity_counts = {
            "categories": len(category_map),
            "work_items": len(bundle.work_items),
            "materials": len(material_map),
            "labor_roles": len(labor_map),
            "equipment": len(equipment_map),
            "crews": sum(len(item.crews) for item in bundle.work_items),
            "material_rates": sum(
                len(crew.rates) for item in bundle.work_items for crew in item.crews
            ),
            "productivity_rates": sum(
                int(crew.productivity is not None)
                for item in bundle.work_items
                for crew in item.crews
            ),
            "adjustments": sum(len(item.adjustments) for item in bundle.work_items),
            "aliases": len(
                {
                    (kind, entity_id, normalize_arabic_search(alias))
                    for kind, entity_id, name, _, _ in alias_targets
                    for alias in generated_aliases(name)
                }
            ),
        }
        report = {
            "import_version": bundle.import_version,
            "workbook": bundle.workbook_name,
            "workbook_sha256": bundle.workbook_sha256,
            "worksheet": bundle.worksheet,
            "entity_counts": entity_counts,
            "inserted": counters["inserted"],
            "updated": counters["updated"],
            "skipped": counters["skipped"],
            "rejected": sum(issue.severity == "rejected" for issue in bundle.issues),
            "warnings": sum(issue.severity == "warning" for issue in bundle.issues),
            "issues": [issue.__dict__ for issue in bundle.issues],
            "already_installed": False,
        }
        run.status = "completed"
        run.inserted_count = report["inserted"]
        run.updated_count = report["updated"]
        run.skipped_count = report["skipped"]
        run.rejected_count = report["rejected"]
        run.report_json = report
        run.completed_at = utc_now()
        self.session.commit()
        return report

    def list_categories(self) -> list[dict]:
        rows = self.session.scalars(
            select(ConstructionCategory)
            .where(ConstructionCategory.is_active == 1)
            .order_by(ConstructionCategory.code)
        ).all()
        return [
            {"id": row.id, "code": row.code, "name_ar": row.name_ar} for row in rows
        ]

    def search_work_items(
        self,
        query: str,
        category_id: str | None,
        material_id: str | None,
        labor_role_id: str | None,
        equipment_id: str | None,
        measurement_unit: str | None,
        import_version: str | None,
        rate_kind: str | None,
        crew_status: str | None,
        active: bool,
        page: int,
        page_size: int,
    ) -> dict:
        statement = select(ConstructionWorkItem)
        conditions = [ConstructionWorkItem.is_active == int(active)]
        if category_id:
            conditions.append(ConstructionWorkItem.category_id == category_id)
        if material_id or rate_kind in {"fixed", "range"}:
            material_filter = select(ConstructionMaterialRate.work_item_id).where(
                ConstructionMaterialRate.is_active == 1
            )
            if material_id:
                material_filter = material_filter.where(
                    ConstructionMaterialRate.material_id == material_id
                )
            if rate_kind in {"fixed", "range"}:
                material_filter = material_filter.where(
                    ConstructionMaterialRate.rate_kind == rate_kind
                )
            conditions.append(ConstructionWorkItem.id.in_(material_filter))
        if labor_role_id:
            conditions.append(
                ConstructionWorkItem.id.in_(
                    select(ConstructionWorkCrew.work_item_id)
                    .join(
                        ConstructionCrewLaborMember,
                        ConstructionCrewLaborMember.crew_id == ConstructionWorkCrew.id,
                    )
                    .where(ConstructionCrewLaborMember.labor_role_id == labor_role_id)
                )
            )
        if equipment_id:
            conditions.append(
                ConstructionWorkItem.id.in_(
                    select(ConstructionWorkCrew.work_item_id)
                    .join(
                        ConstructionCrewEquipment,
                        ConstructionCrewEquipment.crew_id == ConstructionWorkCrew.id,
                    )
                    .where(ConstructionCrewEquipment.equipment_id == equipment_id)
                )
            )
        if measurement_unit:
            conditions.append(ConstructionWorkItem.measurement_unit == measurement_unit)
        if import_version:
            conditions.append(ConstructionWorkItem.import_version == import_version)
        if crew_status in {"specified", "unspecified"}:
            completeness = 1 if crew_status == "specified" else 0
            conditions.append(
                ConstructionWorkItem.id.in_(
                    select(ConstructionWorkCrew.work_item_id).where(
                        ConstructionWorkCrew.numerical_breakdown_complete
                        == completeness,
                        ConstructionWorkCrew.is_active == 1,
                    )
                )
            )
        normalized_query = normalize_arabic_search(query)
        if normalized_query:
            matching_aliases = select(
                ConstructionMarketAlias.entity_id,
                ConstructionMarketAlias.entity_type,
            ).where(
                ConstructionMarketAlias.normalized_alias.contains(normalized_query),
                ConstructionMarketAlias.is_active == 1,
            )
            direct_alias_ids = matching_aliases.where(
                ConstructionMarketAlias.entity_type == "work_item"
            ).with_only_columns(ConstructionMarketAlias.entity_id)
            matching_material_ids = select(ConstructionMaterial.id).where(
                or_(
                    ConstructionMaterial.search_text.contains(normalized_query),
                    ConstructionMaterial.id.in_(
                        matching_aliases.where(
                            ConstructionMarketAlias.entity_type == "material"
                        ).with_only_columns(ConstructionMarketAlias.entity_id)
                    ),
                )
            )
            matching_labor_ids = select(ConstructionLaborRole.id).where(
                or_(
                    ConstructionLaborRole.search_text.contains(normalized_query),
                    ConstructionLaborRole.id.in_(
                        matching_aliases.where(
                            ConstructionMarketAlias.entity_type == "labor_role"
                        ).with_only_columns(ConstructionMarketAlias.entity_id)
                    ),
                )
            )
            matching_equipment_ids = select(ConstructionEquipment.id).where(
                or_(
                    ConstructionEquipment.search_text.contains(normalized_query),
                    ConstructionEquipment.id.in_(
                        matching_aliases.where(
                            ConstructionMarketAlias.entity_type == "equipment"
                        ).with_only_columns(ConstructionMarketAlias.entity_id)
                    ),
                )
            )
            material_work_items = select(ConstructionMaterialRate.work_item_id).where(
                ConstructionMaterialRate.material_id.in_(matching_material_ids)
            )
            labor_work_items = (
                select(ConstructionWorkCrew.work_item_id)
                .join(
                    ConstructionCrewLaborMember,
                    ConstructionCrewLaborMember.crew_id == ConstructionWorkCrew.id,
                )
                .where(
                    ConstructionCrewLaborMember.labor_role_id.in_(matching_labor_ids)
                )
            )
            equipment_work_items = (
                select(ConstructionWorkCrew.work_item_id)
                .join(
                    ConstructionCrewEquipment,
                    ConstructionCrewEquipment.crew_id == ConstructionWorkCrew.id,
                )
                .where(
                    ConstructionCrewEquipment.equipment_id.in_(matching_equipment_ids)
                )
            )
            category_work_items = (
                select(ConstructionWorkItem.id)
                .join(
                    ConstructionCategory,
                    ConstructionCategory.id == ConstructionWorkItem.category_id,
                )
                .where(ConstructionCategory.search_text.contains(normalized_query))
            )
            conditions.append(
                or_(
                    ConstructionWorkItem.search_text.contains(normalized_query),
                    ConstructionWorkItem.code.ilike(f"%{query.strip()}%"),
                    ConstructionWorkItem.id.in_(direct_alias_ids),
                    ConstructionWorkItem.id.in_(material_work_items),
                    ConstructionWorkItem.id.in_(labor_work_items),
                    ConstructionWorkItem.id.in_(equipment_work_items),
                    ConstructionWorkItem.id.in_(category_work_items),
                )
            )
        statement = statement.where(and_(*conditions))
        count_statement = select(func.count()).select_from(statement.subquery())
        total = self.session.scalar(count_statement) or 0
        rows = self.session.scalars(
            statement.order_by(ConstructionWorkItem.code)
            .offset((page - 1) * page_size)
            .limit(page_size)
        ).all()
        categories = {
            row.id: row.name_ar
            for row in self.session.scalars(select(ConstructionCategory)).all()
        }
        return {
            "items": [
                {
                    "id": row.id,
                    "code": row.code,
                    "name_ar": row.name_ar,
                    "measurement_unit": row.measurement_unit,
                    "category_id": row.category_id,
                    "category_name": categories.get(row.category_id, ""),
                    "import_version": row.import_version,
                }
                for row in rows
            ],
            "page": page,
            "page_size": page_size,
            "total": total,
            "pages": (total + page_size - 1) // page_size,
        }

    def work_item_detail(self, work_item_id: str) -> dict | None:
        item = self.session.get(ConstructionWorkItem, work_item_id)
        if item is None or not item.is_active:
            return None
        category = self.session.get(ConstructionCategory, item.category_id)
        crews = self.session.scalars(
            select(ConstructionWorkCrew)
            .where(
                ConstructionWorkCrew.work_item_id == item.id,
                ConstructionWorkCrew.is_active == 1,
            )
            .order_by(ConstructionWorkCrew.source_row, ConstructionWorkCrew.code)
        ).all()
        productivity = {
            row.crew_id: row
            for row in self.session.scalars(
                select(ConstructionProductivityRate).where(
                    ConstructionProductivityRate.work_item_id == item.id,
                    ConstructionProductivityRate.is_active == 1,
                )
            ).all()
        }
        rates = self.session.scalars(
            select(ConstructionMaterialRate)
            .where(
                ConstructionMaterialRate.work_item_id == item.id,
                ConstructionMaterialRate.is_active == 1,
            )
            .order_by(
                ConstructionMaterialRate.source_row, ConstructionMaterialRate.code
            )
        ).all()
        material_ids = {row.material_id for row in rates}
        materials = (
            {
                row.id: row
                for row in self.session.scalars(
                    select(ConstructionMaterial).where(
                        ConstructionMaterial.id.in_(material_ids)
                    )
                ).all()
            }
            if material_ids
            else {}
        )
        crew_ids = [crew.id for crew in crews]
        labor_members = (
            self.session.scalars(
                select(ConstructionCrewLaborMember).where(
                    ConstructionCrewLaborMember.crew_id.in_(crew_ids),
                    ConstructionCrewLaborMember.is_active == 1,
                )
            ).all()
            if crew_ids
            else []
        )
        equipment_members = (
            self.session.scalars(
                select(ConstructionCrewEquipment).where(
                    ConstructionCrewEquipment.crew_id.in_(crew_ids),
                    ConstructionCrewEquipment.is_active == 1,
                )
            ).all()
            if crew_ids
            else []
        )
        labor_roles = (
            {
                row.id: row
                for row in self.session.scalars(
                    select(ConstructionLaborRole).where(
                        ConstructionLaborRole.id.in_(
                            {member.labor_role_id for member in labor_members}
                        )
                    )
                ).all()
            }
            if labor_members
            else {}
        )
        equipment = (
            {
                row.id: row
                for row in self.session.scalars(
                    select(ConstructionEquipment).where(
                        ConstructionEquipment.id.in_(
                            {member.equipment_id for member in equipment_members}
                        )
                    )
                ).all()
            }
            if equipment_members
            else {}
        )
        rates_by_crew: dict[str, list] = {}
        for rate in rates:
            material = materials[rate.material_id]
            rates_by_crew.setdefault(rate.crew_id or "", []).append(
                {
                    "id": rate.id,
                    "code": rate.code,
                    "material_id": material.id,
                    "material_code": material.code,
                    "material_name": material.name_ar,
                    "material_unit": rate.material_unit,
                    "rate_kind": rate.rate_kind,
                    "fixed_rate": rate.fixed_rate,
                    "minimum_rate": rate.minimum_rate,
                    "maximum_rate": rate.maximum_rate,
                    "basis_quantity": rate.basis_quantity,
                    "basis_unit": rate.basis_unit,
                    "waste_percentage": rate.waste_percentage,
                    "conditions": rate.conditions,
                    "package_capacity": material.package_capacity,
                    "package_unit": material.package_unit,
                    "source": {
                        "workbook": rate.source_workbook,
                        "worksheet": rate.source_worksheet,
                        "row": rate.source_row,
                        "text": rate.source_text,
                        "import_version": rate.import_version,
                    },
                }
            )
        labor_by_crew: dict[str, list] = {}
        for member in labor_members:
            role = labor_roles[member.labor_role_id]
            labor_by_crew.setdefault(member.crew_id, []).append(
                {
                    "id": member.id,
                    "labor_role_id": role.id,
                    "code": role.code,
                    "name": role.name_ar,
                    "role_kind": role.role_kind,
                    "count_per_crew": member.count_per_crew,
                    "project_specific_count_allowed": bool(
                        member.project_specific_count_allowed
                    ),
                    "numerical_count_unspecified": member.count_per_crew is None,
                    "source": {
                        "workbook": member.source_workbook,
                        "worksheet": member.source_worksheet,
                        "row": member.source_row,
                        "text": member.source_text,
                        "import_version": member.import_version,
                    },
                }
            )
        equipment_by_crew: dict[str, list] = {}
        for member in equipment_members:
            entity = equipment[member.equipment_id]
            equipment_by_crew.setdefault(member.crew_id, []).append(
                {
                    "id": member.id,
                    "equipment_id": entity.id,
                    "code": entity.code,
                    "name": entity.name_ar,
                    "quantity_per_crew": member.quantity_per_crew,
                    "project_specific_quantity_allowed": bool(
                        member.project_specific_quantity_allowed
                    ),
                    "numerical_quantity_unspecified": member.quantity_per_crew is None,
                    "source": {
                        "workbook": member.source_workbook,
                        "worksheet": member.source_worksheet,
                        "row": member.source_row,
                        "text": member.source_text,
                        "import_version": member.import_version,
                    },
                }
            )
        adjustments = self.session.scalars(
            select(ConstructionWorkItemAdjustment)
            .where(
                ConstructionWorkItemAdjustment.work_item_id == item.id,
                ConstructionWorkItemAdjustment.is_active == 1,
            )
            .order_by(ConstructionWorkItemAdjustment.source_row)
        ).all()
        return {
            "id": item.id,
            "code": item.code,
            "name_ar": item.name_ar,
            "description": item.description,
            "measurement_unit": item.measurement_unit,
            "category": {
                "id": category.id,
                "code": category.code,
                "name_ar": category.name_ar,
            },
            "conditions_consumption": item.conditions_consumption,
            "conditions_productivity": item.conditions_productivity,
            "technical_notes": item.technical_notes,
            "import_version": item.import_version,
            "source": {
                "workbook": item.source_workbook,
                "worksheet": item.source_worksheet,
                "row": item.source_row,
                "text": item.source_text,
                "import_version": item.import_version,
            },
            "crews": [
                {
                    "id": crew.id,
                    "code": crew.code,
                    "description": crew.description,
                    "scenario_label": crew.scenario_label,
                    "numerical_breakdown_complete": bool(
                        crew.numerical_breakdown_complete
                    ),
                    "productivity": (
                        {
                            "id": productivity[crew.id].id,
                            "code": productivity[crew.id].code,
                            "daily_productivity": productivity[
                                crew.id
                            ].daily_productivity,
                            "unit": productivity[crew.id].productivity_unit,
                            "conditions": productivity[crew.id].conditions,
                            "source_row": productivity[crew.id].source_row,
                            "source_text": productivity[crew.id].source_text,
                        }
                        if crew.id in productivity
                        else None
                    ),
                    "material_rates": rates_by_crew.get(crew.id, []),
                    "labor": labor_by_crew.get(crew.id, []),
                    "equipment": equipment_by_crew.get(crew.id, []),
                    "source": {
                        "workbook": crew.source_workbook,
                        "worksheet": crew.source_worksheet,
                        "row": crew.source_row,
                        "text": crew.source_text,
                        "import_version": crew.import_version,
                    },
                }
                for crew in crews
            ],
            "adjustments": [
                {
                    "id": row.id,
                    "code": row.code,
                    "kind": row.adjustment_kind,
                    "fixed_percentage": row.fixed_percentage,
                    "minimum_percentage": row.minimum_percentage,
                    "maximum_percentage": row.maximum_percentage,
                    "documented_meaning": row.documented_meaning,
                    "source_row": row.source_row,
                    "source_text": row.source_text,
                }
                for row in adjustments
            ],
        }

    def reference_options(self) -> dict:
        def values(model, name_column):
            rows = self.session.scalars(
                select(model).where(model.is_active == 1).order_by(model.code)
            ).all()
            return [
                {"id": row.id, "code": row.code, "name": getattr(row, name_column)}
                for row in rows
            ]

        return {
            "materials": values(ConstructionMaterial, "name_ar"),
            "labor_roles": values(ConstructionLaborRole, "name_ar"),
            "equipment": values(ConstructionEquipment, "name_ar"),
            "units": self.session.scalars(
                select(ConstructionWorkItem.measurement_unit)
                .where(ConstructionWorkItem.is_active == 1)
                .distinct()
                .order_by(ConstructionWorkItem.measurement_unit)
            ).all(),
            "import_versions": self.session.scalars(
                select(ConstructionImportRun.import_version)
                .where(ConstructionImportRun.status == "completed")
                .order_by(ConstructionImportRun.completed_at.desc())
            ).all(),
        }
