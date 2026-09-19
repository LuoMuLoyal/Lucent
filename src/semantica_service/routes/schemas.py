"""Request and response models for the reasoning endpoints.

Shapes mirror what the underlying semantica objects actually return — the
SHACL report's ``conforms`` / ``violations`` fields and Datalog's list of
binding dicts — rather than an invented envelope.
"""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field

# --- /schema ---------------------------------------------------------------


class LabelCount(BaseModel):
    """A graph label and how many elements carry it."""

    label: str
    count: int


class SchemaResponse(BaseModel):
    """The graph's shape: what kinds of nodes and edges exist."""

    graph: str
    node_count: int
    relationship_count: int
    labels: list[LabelCount] = Field(default_factory=list)
    relationship_types: list[LabelCount] = Field(default_factory=list)


# --- /validate -------------------------------------------------------------


class ValidateRequest(BaseModel):
    """A SHACL validation over the graph.

    Exactly one of ``shacl`` or ``ontology`` must be given: semantica rejects
    both-or-neither, and the request model surfaces that here rather than
    letting it fail inside the engine.
    """

    shacl: str | None = Field(
        default=None,
        description="SHACL shapes in Turtle.",
    )
    ontology: dict[str, Any] | None = Field(
        default=None,
        description="Ontology dict; SHACL shapes are derived from it.",
    )
    # The data graph is read from AGE, so the limit bounds how much is
    # exported. Validation is CPU-bound; an unbounded export would pin a
    # worker for as long as it takes to serialise the whole graph.
    limit: int = Field(
        default=1000,
        ge=1,
        le=50_000,
        description="Maximum nodes to export from AGE for validation.",
    )
    explain: bool = Field(
        default=True,
        description="Attach a plain-English explanation to each violation.",
    )


class Violation(BaseModel):
    """One SHACL constraint violation."""

    focus_node: str | None = None
    path: str | None = None
    message: str | None = None
    component: str | None = None
    severity: str | None = None
    explanation: str | None = None
    value: str | None = None


class ValidateResponse(BaseModel):
    """Outcome of a SHACL validation."""

    conforms: bool
    summary: str
    violation_count: int
    warning_count: int
    violations: list[Violation] = Field(default_factory=list)
    warnings: list[Violation] = Field(default_factory=list)
    # Echoed so a caller can tell what was actually validated.
    shacl_source: str = Field(description="'inline' or 'ontology'")


# --- /reason ---------------------------------------------------------------


class RuleSpec(BaseModel):
    """A Datalog rule, in the textual syntax semantica parses.

    Example: ``ancestor(X, Y) :- parent(X, Y).``
    Inequalities are supported and were the subject of a fork fix:
    ``conflict(X, Y) :- takes(X, D), takes(Y, D), X != Y.``
    """

    rule: str


class FactSpec(BaseModel):
    """A ground or rule-derived fact, e.g. ``parent(tom, bob)``."""

    fact: str


class ReasonRequest(BaseModel):
    """Run Datalog inference over facts and rules."""

    rules: list[RuleSpec] = Field(default_factory=list)
    facts: list[FactSpec] = Field(default_factory=list)
    # When true the graph is loaded as the initial fact set via
    # load_from_graph, and `facts` is ignored.
    load_from_graph: bool = False
    limit: int = Field(
        default=1000,
        ge=1,
        le=50_000,
        description="Maximum nodes to load when load_from_graph is set.",
    )
    query: str | None = Field(
        default=None,
        description="Optional goal, e.g. 'ancestor(tom, ?Y)'. Omit to return all derived facts.",
    )


class ReasonResponse(BaseModel):
    """Result of a reasoning run."""

    fact_count: int
    derived: list[str] = Field(default_factory=list)
    bindings: list[dict[str, str]] | None = Field(
        default=None,
        description="Populated only when a query was supplied.",
    )
