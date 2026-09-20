"""Reasoning: the versioned rule library, its vocabulary checks, and the
bridge that recovers the premises behind a derived conclusion."""

from .provenance_bridge import (
    MAX_RECOVERED,
    premises_for_conclusion,
    recovery_is_complete,
)
from .rules import (
    DEFAULT_RULES_DIR,
    ReasoningRule,
    RuleLibrary,
    RuleLibraryError,
    load_library,
    verify_against_vocabulary,
)

__all__ = [
    "DEFAULT_RULES_DIR",
    "MAX_RECOVERED",
    "ReasoningRule",
    "RuleLibrary",
    "RuleLibraryError",
    "load_library",
    "premises_for_conclusion",
    "recovery_is_complete",
    "verify_against_vocabulary",
]
