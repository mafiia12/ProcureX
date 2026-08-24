"""Deterministic multilingual matching against existing ProcureX items."""

from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass
from difflib import SequenceMatcher


@dataclass(frozen=True)
class MatchCandidate:
    item_id: str
    score: float
    reasons: list[str]


def normalize(value: str) -> str:
    text = unicodedata.normalize("NFKC", value or "").casefold()
    text = re.sub(r"[\u064b-\u065f\u0670]", "", text)
    text = text.replace("أ", "ا").replace("إ", "ا").replace("آ", "ا").replace("ى", "ي")
    return " ".join(re.sub(r"[^\w\s]", " ", text).split())


def _names(item) -> list[str]:
    aliases = item.search_aliases or []
    alternatives = item.alternative_names or []
    return [
        item.code,
        item.name,
        item.product_name,
        item.name_ar,
        item.name_en,
        *(str(value) for value in alternatives),
        *(str(value) for value in aliases),
    ]


def match_items(extracted, items, limit: int = 5) -> list[MatchCandidate]:
    wanted = normalize(extracted.product_name)
    wanted_brand = normalize(extracted.brand)
    candidates: list[MatchCandidate] = []
    if not wanted:
        return candidates
    wanted_tokens = set(wanted.split())
    for item in items:
        variants = [normalize(value) for value in _names(item) if value]
        if not variants:
            continue
        similarity = max(
            SequenceMatcher(None, wanted, variant).ratio() for variant in variants
        )
        token_score = max(
            len(wanted_tokens & set(variant.split()))
            / max(len(wanted_tokens | set(variant.split())), 1)
            for variant in variants
        )
        exact = any(wanted == variant for variant in variants)
        brand_match = bool(wanted_brand and wanted_brand == normalize(item.brand))
        context = normalize(
            " ".join(
                filter(
                    None,
                    [
                        item.main_category,
                        item.subcategory,
                        item.specifications,
                    ],
                )
            )
        )
        extracted_context = normalize(
            " ".join(
                filter(
                    None,
                    [
                        extracted.specification,
                        extracted.size,
                    ],
                )
            )
        )
        context_score = (
            SequenceMatcher(None, extracted_context, context).ratio()
            if extracted_context and context
            else 0
        )
        score = min(
            1.0,
            (0.57 * similarity)
            + (0.25 * token_score)
            + (0.1 if brand_match else 0)
            + (0.08 * context_score),
        )
        reasons = []
        if exact:
            score = max(score, 0.97)
            reasons.append("exact_name")
        elif token_score >= 0.75:
            reasons.append("name_tokens")
        if brand_match:
            reasons.append("brand")
        if context_score >= 0.7:
            reasons.append("specification_or_classification")
        if score >= 0.42:
            candidates.append(MatchCandidate(item.id, round(score, 4), reasons))
    return sorted(candidates, key=lambda row: (-row.score, row.item_id))[:limit]


def match_state(candidates: list[MatchCandidate]) -> tuple[str, str | None]:
    if not candidates:
        return "no_match", None
    first = candidates[0]
    runner_up = candidates[1].score if len(candidates) > 1 else 0
    if first.score >= 0.90 and first.score - runner_up >= 0.08:
        return "high_confidence", first.item_id
    if len(candidates) > 1 and first.score - runner_up < 0.05:
        return "ambiguous", None
    return "suggested", None
