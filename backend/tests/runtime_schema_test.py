import sys
from pathlib import Path

import pytest


sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from runtime_schema import (  # noqa: E402
    EXPECTED_SEMANTIC_SHA256,
    _assert_preserved,
)


LOCAL_PRE_ANCESTRY_SCHEMA = (
    "6ce55002652092793f4b58ae2e1fbe19c09c1eb55231a645cebcdc61e8d2b9ad"
)


def _state(semantic, request_digest="request-digest", supplier_digest="supplier-digest"):
    return {
        "semantic_sha256": semantic,
        "counts": {"incoming_purchase_requests": 2, "suppliers": 3},
        "financial_totals": {"purchase_invoice_total": 100},
        "row_digests": {
            "incoming_purchase_requests": request_digest,
            "suppliers": supplier_digest,
        },
    }


def test_release_gate_accepts_only_the_certified_additive_ancestry_digest_change():
    before = _state(LOCAL_PRE_ANCESTRY_SCHEMA)
    after = _state(EXPECTED_SEMANTIC_SHA256, request_digest="digest-with-null-ancestry")

    _assert_preserved(before, after)


def test_release_gate_rejects_an_unrelated_business_table_digest_change():
    before = _state(LOCAL_PRE_ANCESTRY_SCHEMA)
    after = _state(
        EXPECTED_SEMANTIC_SHA256,
        request_digest="digest-with-null-ancestry",
        supplier_digest="changed-supplier-data",
    )

    with pytest.raises(RuntimeError, match="row_digests"):
        _assert_preserved(before, after)
