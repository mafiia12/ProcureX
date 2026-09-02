"""Pure domain rules for construction calculations and Arabic search."""

from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass, field
from decimal import Decimal, InvalidOperation, ROUND_CEILING


FORMULAS_VERSION = "construction-v1"
ZERO = Decimal("0")
ONE = Decimal("1")

_ARABIC_DIGITS = str.maketrans("٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹", "01234567890123456789")
_ARABIC_VARIANTS = str.maketrans(
    {"أ": "ا", "إ": "ا", "آ": "ا", "ى": "ي", "ؤ": "و", "ئ": "ي"}
)
_DIACRITICS = re.compile(r"[\u0610-\u061a\u064b-\u065f\u0670\u06d6-\u06ed]")
_SPACES = re.compile(r"\s+")


def decimal_value(value: object, field_name: str = "value") -> Decimal:
    try:
        result = Decimal(str(value).strip())
    except (InvalidOperation, AttributeError, ValueError) as exc:
        raise ValueError(f"{field_name} must be a valid decimal") from exc
    if not result.is_finite():
        raise ValueError(f"{field_name} must be finite")
    return result


def normalize_arabic_search(value: str) -> str:
    """Normalize only for search; official stored text is never overwritten."""
    text = unicodedata.normalize("NFKC", value or "").replace("⁄", "/")
    text = text.translate(_ARABIC_DIGITS).translate(_ARABIC_VARIANTS)
    text = _DIACRITICS.sub("", text).replace("ـ", "")
    text = text.replace("½", " 1/2 ").replace("نصف", " نص ")
    text = re.sub(r"\bنص\b", "1/2", text)
    text = text.replace("ة", "ه")
    text = re.sub(r"\s*/\s*", "/", text)
    text = re.sub(r"[^\w\u0600-\u06ff./%-]+", " ", text.casefold())
    return _SPACES.sub(" ", text).strip()


def generated_aliases(value: str) -> list[str]:
    official = _SPACES.sub(" ", (value or "").strip())
    normalized = normalize_arabic_search(official)
    variants = {official, normalized}
    if "1/2" in normalized:
        variants.update(
            {normalized.replace("1/2", "نص"), normalized.replace("1/2", "نصف")}
        )
    return sorted(alias for alias in variants if alias)


@dataclass(frozen=True)
class MaterialInput:
    rate_code: str
    material_id: str
    material_code: str
    material_name: str
    material_unit: str
    rate_kind: str
    fixed_rate: Decimal | None
    minimum_rate: Decimal | None
    maximum_rate: Decimal | None
    basis_quantity: Decimal
    waste_percentage: Decimal | None
    selected_rate: Decimal | None = None
    package_capacity: Decimal | None = None
    source: dict = field(default_factory=dict)


@dataclass(frozen=True)
class LaborInput:
    crew_id: str
    labor_role_id: str
    labor_role_code: str
    labor_role_name: str
    count_per_crew: int | None
    project_specific_count_per_crew: int | None = None
    source: dict = field(default_factory=dict)


@dataclass(frozen=True)
class EquipmentInput:
    crew_id: str
    equipment_id: str
    equipment_code: str
    equipment_name: str
    quantity_per_crew: int | None
    project_specific_quantity_per_crew: int | None = None
    source: dict = field(default_factory=dict)


@dataclass(frozen=True)
class CalculationInput:
    measured_quantity: Decimal
    measurement_unit: str
    productivity: Decimal
    crew_count: int | None
    required_days: Decimal | None
    adjustment_percentage: Decimal | None
    materials: tuple[MaterialInput, ...]
    labor: tuple[LaborInput, ...]
    equipment: tuple[EquipmentInput, ...]


@dataclass
class CalculationOutput:
    execution_quantity: Decimal
    crew_count: int
    theoretical_duration: Decimal
    planning_duration: int
    materials: list[dict] = field(default_factory=list)
    labor: list[dict] = field(default_factory=list)
    equipment: list[dict] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)


def _ceil_decimal(value: Decimal) -> int:
    return int(value.to_integral_value(rounding=ROUND_CEILING))


def calculate(payload: CalculationInput) -> CalculationOutput:
    if payload.measured_quantity <= ZERO:
        raise ValueError("measured_quantity must be greater than zero")
    if payload.productivity <= ZERO:
        raise ValueError("productivity must be greater than zero")
    if (
        payload.adjustment_percentage is not None
        and not ZERO <= payload.adjustment_percentage <= ONE
    ):
        raise ValueError("adjustment_percentage must be between zero and one")
    execution_quantity = payload.measured_quantity * (
        ONE + (payload.adjustment_percentage or ZERO)
    )

    if payload.required_days is not None:
        if payload.required_days <= ZERO:
            raise ValueError("required_days must be greater than zero")
        required_crews = _ceil_decimal(
            execution_quantity / (payload.productivity * payload.required_days)
        )
        crew_count = max(1, required_crews)
    else:
        if payload.crew_count is None or payload.crew_count <= 0:
            raise ValueError(
                "crew_count must be a positive integer when required_days is absent"
            )
        crew_count = payload.crew_count

    effective_productivity = payload.productivity * Decimal(crew_count)
    theoretical_duration = execution_quantity / effective_productivity
    planning_duration = max(1, _ceil_decimal(theoretical_duration))
    output = CalculationOutput(
        execution_quantity=execution_quantity,
        crew_count=crew_count,
        theoretical_duration=theoretical_duration,
        planning_duration=planning_duration,
    )

    for position, item in enumerate(payload.materials, 1):
        if item.rate_kind == "range":
            if item.selected_rate is None:
                raise ValueError(f"selected rate is required for {item.rate_code}")
            selected_rate = item.selected_rate
            if item.minimum_rate is None or item.maximum_rate is None:
                raise ValueError(f"range bounds are missing for {item.rate_code}")
            warnings: list[str] = []
            if not item.minimum_rate <= selected_rate <= item.maximum_rate:
                warnings.append("selected_rate_outside_source_range")
        else:
            if item.fixed_rate is None:
                raise ValueError(f"fixed rate is missing for {item.rate_code}")
            selected_rate = item.fixed_rate
            warnings = []
        if selected_rate <= ZERO or item.basis_quantity <= ZERO:
            raise ValueError(
                f"rate and basis must be greater than zero for {item.rate_code}"
            )
        waste_percentage = item.waste_percentage
        if waste_percentage is not None and not ZERO <= waste_percentage <= ONE:
            raise ValueError(f"waste percentage is invalid for {item.rate_code}")
        base_quantity = execution_quantity * selected_rate / item.basis_quantity
        waste_quantity = base_quantity * (waste_percentage or ZERO)
        required_quantity = base_quantity + waste_quantity
        minimum_required_quantity = maximum_required_quantity = None
        if item.rate_kind == "range":
            minimum_base = execution_quantity * item.minimum_rate / item.basis_quantity
            maximum_base = execution_quantity * item.maximum_rate / item.basis_quantity
            minimum_required_quantity = minimum_base * (
                ONE + (waste_percentage or ZERO)
            )
            maximum_required_quantity = maximum_base * (
                ONE + (waste_percentage or ZERO)
            )
        package_count = purchased_quantity = rounding_surplus = None
        if item.package_capacity is not None:
            if item.package_capacity <= ZERO:
                raise ValueError(
                    f"package capacity must be greater than zero for {item.rate_code}"
                )
            package_count = _ceil_decimal(required_quantity / item.package_capacity)
            purchased_quantity = item.package_capacity * Decimal(package_count)
            rounding_surplus = purchased_quantity - required_quantity
        output.materials.append(
            {
                "position": position,
                "rate_code": item.rate_code,
                "material_id": item.material_id,
                "material_code": item.material_code,
                "material_name": item.material_name,
                "material_unit": item.material_unit,
                "selected_rate": selected_rate,
                "minimum_rate": item.minimum_rate,
                "maximum_rate": item.maximum_rate,
                "base_quantity": base_quantity,
                "waste_percentage": waste_percentage,
                "waste_quantity": waste_quantity,
                "required_quantity": required_quantity,
                "minimum_required_quantity": minimum_required_quantity,
                "maximum_required_quantity": maximum_required_quantity,
                "package_capacity": item.package_capacity,
                "package_count": package_count,
                "purchased_quantity": purchased_quantity,
                "rounding_surplus": rounding_surplus,
                "warnings": warnings,
                "source": item.source,
            }
        )
        output.warnings.extend(warnings)

    for position, member in enumerate(payload.labor, 1):
        source_count = member.count_per_crew
        project_count = member.project_specific_count_per_crew
        effective_count = project_count if project_count is not None else source_count
        required_headcount = (
            effective_count * crew_count if effective_count is not None else None
        )
        labor_days = (
            required_headcount * planning_duration
            if required_headcount is not None
            else None
        )
        output.labor.append(
            {
                "position": position,
                "crew_id": member.crew_id,
                "labor_role_id": member.labor_role_id,
                "labor_role_code": member.labor_role_code,
                "labor_role_name": member.labor_role_name,
                "count_per_crew": source_count,
                "project_specific_count_per_crew": project_count,
                "effective_count_per_crew": effective_count,
                "crew_count": crew_count,
                "required_headcount": required_headcount,
                "planning_duration": planning_duration,
                "labor_days": labor_days,
                "numerical_count_unspecified": source_count is None,
                "source": member.source,
            }
        )

    for position, member in enumerate(payload.equipment, 1):
        source_quantity = member.quantity_per_crew
        project_quantity = member.project_specific_quantity_per_crew
        effective_quantity = (
            project_quantity if project_quantity is not None else source_quantity
        )
        required_equipment = (
            effective_quantity * crew_count if effective_quantity is not None else None
        )
        equipment_days = (
            required_equipment * planning_duration
            if required_equipment is not None
            else None
        )
        output.equipment.append(
            {
                "position": position,
                "crew_id": member.crew_id,
                "equipment_id": member.equipment_id,
                "equipment_code": member.equipment_code,
                "equipment_name": member.equipment_name,
                "quantity_per_crew": source_quantity,
                "project_specific_quantity_per_crew": project_quantity,
                "effective_quantity_per_crew": effective_quantity,
                "crew_count": crew_count,
                "required_equipment": required_equipment,
                "planning_duration": planning_duration,
                "equipment_days": equipment_days,
                "numerical_quantity_unspecified": source_quantity is None,
                "source": member.source,
            }
        )
    return output


def decimal_json(value: object) -> object:
    if isinstance(value, Decimal):
        return format(value, "f")
    if isinstance(value, dict):
        return {key: decimal_json(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [decimal_json(item) for item in value]
    return value


def source_formula_manifest() -> dict[str, str]:
    return {
        "execution_quantity": "measured_quantity * (1 + source_adjustment_percentage)",
        "base_quantity": "execution_quantity * selected_rate / rate_basis_quantity",
        "waste_quantity": "base_quantity * waste_percentage",
        "required_quantity": "base_quantity + waste_quantity",
        "package_count": "ceiling(required_quantity / package_capacity)",
        "purchased_quantity": "package_count * package_capacity",
        "rounding_surplus": "purchased_quantity - required_quantity",
        "effective_daily_productivity": "crew_productivity * crew_count",
        "theoretical_duration": "execution_quantity / effective_daily_productivity",
        "planning_duration": "ceiling(theoretical_duration)",
        "required_crews": "ceiling(execution_quantity / (crew_productivity * required_days))",
        "required_headcount": "role_count_per_crew * required_crews",
        "labor_days": "required_headcount * planning_duration",
        "required_equipment": "equipment_count_per_crew * required_crews",
        "equipment_days": "required_equipment * planning_duration",
    }
