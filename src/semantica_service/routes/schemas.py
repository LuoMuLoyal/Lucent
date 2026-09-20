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


class ScopeSpecModel(BaseModel):
    """The subgraph a graph-backed inference runs over.

    Inference over a truncated graph can only ever answer "not derived", which
    is indistinguishable from "does not hold" unless the extent is known. A
    scope is therefore required for graph-backed reasoning, and it is stated in
    terms a caller can produce rather than in internal keys.
    """

    drug_names: list[str] = Field(
        default_factory=list,
        max_length=200,
        description="Drug names or DrugBank ids to reason over (case-insensitive, exact).",
    )
    atc_prefixes: list[str] = Field(
        default_factory=list,
        max_length=50,
        description="ATC code prefixes; includes the classes and the drugs assigned to them.",
    )


class ReasonRange(BaseModel):
    """What a graph-backed inference actually loaded.

    Present on every graph-backed response so that "nothing derived" is never
    read as a negative finding: a caller seeing ``truncated`` knows the answer
    is relative to a bounded load, and a caller seeing ``drug_count: 0`` knows
    the scope resolved to nothing at all.
    """

    scope: str = Field(description="'explicit' when a scope was supplied, 'all' otherwise.")
    drug_count: int = 0
    atc_count: int = 0
    node_count: int = 0
    edge_count: int = 0
    truncated: bool = False
    limit: int = 0
    seed_drug_keys: list[str] = Field(
        default_factory=list,
        description=(
            "The keys the caller named. The rest of `drug_keys` are neighbours "
            "pulled in by the expansion, so the two are reported apart."
        ),
    )
    drug_keys: list[str] = Field(default_factory=list)
    atc_keys: list[str] = Field(default_factory=list)


class ReasonRequest(BaseModel):
    """Run Datalog inference over facts and rules."""

    rules: list[RuleSpec] = Field(default_factory=list, max_length=100)
    facts: list[FactSpec] = Field(default_factory=list, max_length=20_000)
    # When true the graph is loaded as the initial fact set via
    # load_from_graph, and `facts` is ignored.
    load_from_graph: bool = False
    # Graph-backed inference requires a scope. `scope_all` is the explicit
    # opt-in to the whole graph, which is only sound on a graph small enough to
    # fit under `limit` — the response says whether it did.
    scope: ScopeSpecModel | None = None
    scope_all: bool = Field(
        default=False,
        description=(
            "Load the entire graph instead of a named scope. Sound only when the "
            "graph fits under `limit`; the response reports `truncated` otherwise."
        ),
    )
    limit: int = Field(
        default=1000,
        ge=1,
        le=50_000,
        description="Maximum nodes and edges to load when load_from_graph is set.",
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
    # Facts are keyed by business identifier (DB00945), which is what keeps
    # Datalog constants unique and stable, but a caller showing a result to a
    # user or to an assistant needs names. Returning the key->name map here
    # saves a second round trip and keeps the two concerns separate.
    labels: dict[str, str] = Field(
        default_factory=dict,
        description="Display name per fact key, for terms that have one.",
    )
    node_types: dict[str, str] = Field(
        default_factory=dict,
        description="Node type per fact key.",
    )
    range: ReasonRange | None = Field(
        default=None,
        description="What was loaded. Present for graph-backed inference, absent otherwise.",
    )
    fact_assertions: dict[str, str | None] = Field(
        default_factory=dict,
        description=(
            "Premise fact -> the provenance id of the graph edge that asserts it, or "
            "null when the edge carries no id. This is what makes a derivation "
            "auditable: a conclusion is only citable through the assertions it rests on."
        ),
    )


# --- /resolve --------------------------------------------------------------


class ResolveRequest(BaseModel):
    """Look up graph terms by name.

    Display names are not unique in the graph — target names in particular
    repeat across species and strains — so resolution reports every match
    instead of picking one silently.
    """

    name: str = Field(min_length=1, description="Exact, case-insensitive name.")
    limit: int = Field(default=25, ge=1, le=500)


class ResolvedTerm(BaseModel):
    """One graph element matching a name."""

    key: str = Field(description="The identifier used in facts.")
    name: str
    type: str
    properties: dict[str, Any] = Field(default_factory=dict)


class ResolveResponse(BaseModel):
    """Matches for a name lookup."""

    name: str
    match_count: int
    matches: list[ResolvedTerm] = Field(default_factory=list)
    ambiguous: bool = Field(
        description="True when the name maps to more than one term.",
    )


# --- /query ----------------------------------------------------------------


class QueryRequest(BaseModel):
    """One read-only Cypher statement, generated by the caller.

    Lucent turns natural language into Cypher with its own model; this service
    is the side that validates and executes it. ``limit`` bounds the response,
    not the work: the statement is run as written, so its own LIMIT (and the
    connection's ``statement_timeout``) is what bounds the database.
    """

    cypher: str = Field(
        min_length=1,
        max_length=8192,
        description=(
            "A single read-only statement, starting with MATCH, OPTIONAL, WITH, UNWIND or RETURN."
        ),
    )
    params: dict[str, str | int | float | bool] = Field(
        default_factory=dict,
        description="Scalar values substituted for $name placeholders in the statement.",
    )
    limit: int = Field(
        default=100,
        ge=1,
        le=500,
        description="Maximum rows to return. The statement itself is not rewritten.",
    )
    include_provenance: bool = Field(
        default=True,
        description=(
            "Resolve the provenance ids present in the rows (the `prov` property "
            "every edge of this graph carries) into citations."
        ),
    )
    provenance_limit: int = Field(
        default=100,
        ge=1,
        le=500,
        description=(
            "Maximum distinct citations to resolve. A result set citing more than "
            "this reports `provenance_truncated` rather than returning a list that "
            "looks complete."
        ),
    )


class ProvenanceRecordModel(BaseModel):
    """One citation: an assertion, and where it came from."""

    id: str = Field(
        description=(
            "Provenance id of the form `lucent:<source table>/<row key>`; it names "
            "the source row, so it is readable without a lookup."
        )
    )
    entity_type: str = Field(
        description="`graph_assertion`, `source_row` or `ingest_activity`.",
    )
    source_document: str = Field(
        description="Source table, e.g. `lucent.drugbank_drugs.drug_interactions`.",
    )
    source_location: str = Field(description="Row key within that source.")
    source_quote: str = Field(description="The source's own text for this assertion.")
    activity_id: str | None = Field(
        default=None,
        description="The import activity that produced the assertion.",
    )
    agent_id: str | None = Field(
        default=None,
        description="The source dataset, as a PROV agent.",
    )
    agent_type: str | None = Field(default=None, description="What kind of agent that is.")
    role: str | None = None
    confidence: float | None = None
    timestamp: str | None = Field(default=None, description="When the entry was recorded.")
    sequence_id: int | None = Field(default=None, description="Position in the hash chain.")
    checksum: str | None = Field(
        default=None,
        description="SHA-256 over the entry and its predecessor's checksum.",
    )
    parent_entity_id: str | None = Field(
        default=None,
        description="The source row a recognised-verb edge was derived from.",
    )
    metadata: dict[str, Any] = Field(default_factory=dict)


class ChainReport(BaseModel):
    """Integrity of the hash chain behind a citation."""

    available: bool = Field(description="False when the store could not be read.")
    valid: bool | None = Field(default=None, description="None when unavailable.")
    total_entries: int = 0
    broken_links: list[dict[str, Any]] = Field(default_factory=list)
    error: str | None = None


class QueryResponse(BaseModel):
    """Rows from a read-only Cypher statement."""

    columns: list[str] = Field(
        default_factory=list,
        description="Column names in projection order, as AGE reported them.",
    )
    rows: list[dict[str, Any]] = Field(
        default_factory=list,
        description="One object per row, keyed by column name, JSON-normalised.",
    )
    row_count: int = Field(description="Number of rows returned, after truncation.")
    truncated: bool = Field(
        description=(
            "True when the statement produced more rows than `limit`; "
            "only the first `limit` are returned."
        ),
    )
    elapsed_ms: int = Field(
        description="Milliseconds spent borrowing a connection and executing the statement.",
    )
    provenance: list[ProvenanceRecordModel] = Field(
        default_factory=list,
        description=(
            "Citations for the assertions the rows rest on, resolved from the "
            "provenance ids present in them. An empty list is meaningful: either "
            "the rows carried no id, or the ids are not in the store — "
            "`provenance_missing` and `provenance_error` say which."
        ),
    )
    provenance_missing: list[str] = Field(
        default_factory=list,
        description="Ids the rows referenced that the store does not hold.",
    )
    provenance_truncated: bool = Field(
        default=False,
        description="True when the rows cited more assertions than `provenance_limit`.",
    )
    provenance_error: str | None = Field(
        default=None,
        description=(
            "Set when the provenance store could not be read at all, which "
            "distinguishes 'nothing was recorded' from 'there was nothing to ask'."
        ),
    )


# --- /provenance -----------------------------------------------------------


class ProvenanceRequest(BaseModel):
    """Resolve provenance ids into citations.

    The ids normally come from a `prov` value a previous `/query` returned;
    passing them explicitly is what lets a caller re-check the evidence behind
    an answer without re-running the query that produced it.
    """

    ids: list[str] = Field(min_length=1, max_length=200)
    lineage: bool = Field(
        default=True,
        description="Also return each id's ancestors — for a verb edge, its source row.",
    )
    format: str = Field(
        default="records",
        pattern="^(records|jsonld|turtle)$",
        description="`records` for this service's JSON, or W3C PROV-O as JSON-LD or Turtle.",
    )


class ProvenanceResponse(BaseModel):
    """Citations for the requested ids, and the integrity of the chain behind them."""

    records: list[ProvenanceRecordModel] = Field(default_factory=list)
    missing: list[str] = Field(default_factory=list)
    lineage: list[ProvenanceRecordModel] = Field(
        default_factory=list,
        description="Ancestors of the requested ids, when `lineage` was set.",
    )
    chain: ChainReport | None = None
    provo: Any | None = Field(
        default=None,
        description="PROV-O document: parsed JSON-LD, or a Turtle string.",
    )
    error: str | None = Field(
        default=None,
        description="Set when the provenance store could not be read.",
    )
