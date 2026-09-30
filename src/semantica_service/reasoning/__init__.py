"""Reasoning: the versioned rule library.

Rules are Cypher now, so this package holds no engine and no premise-recovery
bridge. The premises come back from the same query that derives the conclusion —
``RETURN ... r1.prov AS premise_1, r2.prov AS premise_2`` — which is why
``provenance_bridge`` (which re-ran the rule body to reconstruct bindings the old
engine discarded) is gone rather than ported.
"""

from .cypher_rules import (
    RULES,
    CypherRule,
    LibraryError,
    RuleLibrary,
    build_query,
    load_library,
    verify_against_vocabulary,
)

__all__ = [
    "RULES",
    "CypherRule",
    "LibraryError",
    "RuleLibrary",
    "build_query",
    "load_library",
    "verify_against_vocabulary",
]
