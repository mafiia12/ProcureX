"""Conservative matching against Item Master and a Site Engineer's assigned
projects. Deliberately reuses the existing matchers rather than inventing new
ones: document_capture.matching for items (already tuned/tested), and
procurement_workflow.normalize_match for project-name text."""

from __future__ import annotations

from difflib import SequenceMatcher
from types import SimpleNamespace

try:
    from ..document_capture.matching import match_items, match_state
    from ..procurement_workflow import normalize_match
except ImportError:  # pragma: no cover - direct backend execution
    from document_capture.matching import match_items, match_state
    from procurement_workflow import normalize_match

PROJECT_MATCH_THRESHOLD = 0.6
PROJECT_MATCH_MARGIN = 0.08


def match_item_master(product_name: str, items: list) -> str:
    """Returns an items.id only on a high-confidence match; "" otherwise
    (the caller keeps the line as a manual/unlinked item, per spec — never
    guess, never create a new Item Master row)."""
    extracted = SimpleNamespace(product_name=product_name, brand="", specification="", size="")
    candidates = match_items(extracted, items)
    state, item_id = match_state(candidates)
    return item_id if state == "high_confidence" and item_id else ""


def match_project(project_name_text: str, projects: list):
    """Returns the confidently-matched project, or None when the name is
    missing/ambiguous — None always means "present the numbered-choice
    prompt instead of guessing." `projects` is the engineer's own assigned
    list (never all projects)."""
    if not project_name_text or not projects:
        return None
    wanted = normalize_match(project_name_text)
    scored = sorted(
        ((SequenceMatcher(None, wanted, normalize_match(p.name)).ratio(), p) for p in projects),
        key=lambda pair: -pair[0],
    )
    best_score, best_project = scored[0]
    runner_up_score = scored[1][0] if len(scored) > 1 else 0.0
    if best_score >= PROJECT_MATCH_THRESHOLD and best_score - runner_up_score >= PROJECT_MATCH_MARGIN:
        return best_project
    return None
