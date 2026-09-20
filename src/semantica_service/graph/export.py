"""Export the AGE graph into the shapes semantica's engines accept.

The engine input has to be *deterministic* and its extent has to be *stated*.
Both requirements come from the same fact: Datalog has no negation, so "no
derivation" is the only answer available for "not present", and that answer is
only meaningful if the caller knows exactly what was loaded. A random slice of
the graph therefore does not merely lose rows — it manufactures false negatives
that look like findings.

Two things enforce it:

* **Ordering.** Every query orders by the graph's own identifier before it
  limits, and pages with keyset pagination. ``LIMIT`` without ``ORDER BY`` is a
  random sample, which is what this bridge used to do: two identical requests
  loaded different edges (about 23% of 211,630 in the measured case).
* **Scope.** A drug set resolved from names or ATC prefixes, plus a bounded
  neighbourhood expansion. Nothing is loaded outside it, and the response
  echoes the range and whether the bound truncated it.

The dict shapes emitted here follow ``DatalogReasoner.add_fact``'s accepted
forms:

* ``{subject, predicate, object}``
* ``{source, target, type}``
* ``{id, type}``

``DatalogReasoner.load_from_graph`` documents that a graph-store handle is not
an accepted input — it needs a ContextGraph-like object or dicts, and raises
``TypeError`` otherwise (a fork fix; upstream returned 0 and silently reasoned
over an empty fact base). AGE stores are explicitly named as unsupported. This
module is therefore the adapter the plan calls the "application-side bridge".
"""

from __future__ import annotations

from collections.abc import Iterator
from dataclasses import dataclass, field
from typing import Any

from semantica.graph_store.age_store import ApacheAgeStore

#: Rows fetched per round trip. Paging exists so a large scope does not build
#: one enormous result set in memory on either side of the wire; it does not
#: bound the total, which is what ``limit`` is for.
PAGE_SIZE = 2000

# Node reads page by *fact key* rather than row id, because the key is what the
# caller's scope was expressed in and what the reasoner's constants are built
# from. Ordering by row id would be equally deterministic but would make the
# page boundary meaningless to the scope.
_NODES_QUERY = """
MATCH (n)
WHERE {where}
RETURN id(n) AS id, labels(n) AS labels, properties(n) AS props
ORDER BY coalesce(n.drugbank_id, n.uniprot_id, n.code, n.name, '')
LIMIT {limit}
"""

# Edges are paged on the row id of the relationship itself: a relationship has
# no business key, and id() is stable and unique within a graph.
#
# The ORDER BY is two-level on purpose. Ordering by ``id(r)`` alone is
# deterministic but not *useful*: INTERACTS_WITH has 200,182 edges against the
# mechanism relations' low thousands, so a bounded read fills entirely with
# interactions and the INHIBITS / SUBSTRATE_OF / ACTS_ON edges that every
# shipped rule consumes never arrive. The scope would then be reproducible and
# still derive nothing, which is the false-negative problem in a new costume.
# Mechanism edges therefore order first, and the row id only breaks ties within
# a type. Within each type the order stays total, so the load stays
# reproducible.
_MECHANISM_REL_TYPES = (
    "INHIBITS",
    "SUBSTRATE_OF",
    "ACTS_ON",
    "INDUCES",
    "ENZYME_LINKED_TO",
    "TRANSPORTED_BY",
    "CARRIED_BY",
)

_EDGES_QUERY = """
MATCH (a)-[r]->(b)
WHERE {where}
RETURN id(r) AS rel_id, id(a) AS source, id(b) AS target, type(r) AS rel_type,
       properties(r) AS props,
       properties(a) AS source_props, properties(b) AS target_props
ORDER BY CASE WHEN type(r) IN {mechanism} THEN 0 ELSE 1 END, id(r)
LIMIT {limit}
"""

# Relationship types that are not part of the reasoning vocabulary. The ATC
# hierarchy and the drug->class links are structural: including them in a
# neighbourhood expansion would pull in every sibling drug sharing an ATC code
# and turn a targeted question into a whole-graph load by way of two hops.
_EXCLUDED_REL_TYPES = ("IN_ATC_CLASS", "SUBCLASS_OF")

#: The namespace every exported term lives in. A caller writing SHACL shapes has
#: to use exactly this IRI, and getting it wrong is not a loud failure: a shape
#: whose terms match nothing selects no targets, so SHACL reports "conforms" and
#: the caller reads a clean bill of health off a check that never ran. It is
#: exported so the shape gate can compare against it rather than repeat it.
GRAPH_NAMESPACE = "http://lucent.local/graph#"

#: The Turtle prefix bound to :data:`GRAPH_NAMESPACE` in the export.
GRAPH_PREFIX = "lucent"


@dataclass
class ExportRange:
    """What was actually loaded, for the response that has to state it.

    Without this a caller cannot tell a finding of "nothing derived" apart from
    "nothing was loaded", which is precisely the confusion the plan forbids.
    """

    scope: str
    node_count: int = 0
    edge_count: int = 0
    drug_keys: list[str] = field(default_factory=list)
    atc_keys: list[str] = field(default_factory=list)
    #: The keys the caller named, as opposed to the neighbours the expansion
    #: pulled in. "The scope is warfarin" and "the scope is warfarin plus its
    #: interaction partners" are different claims about what was reasoned over.
    seed_drug_keys: list[str] = field(default_factory=list)
    # Set when the bound cut the load short. A caller seeing this must not read
    # an absent derivation as a negative finding.
    truncated: bool = False
    limit: int = 0

    def describe(self) -> dict[str, Any]:
        return {
            "scope": self.scope,
            "node_count": self.node_count,
            "edge_count": self.edge_count,
            "drug_count": len(self.drug_keys),
            "atc_count": len(self.atc_keys),
            "seed_drug_keys": self.seed_drug_keys,
            "drug_keys": self.drug_keys,
            "atc_keys": self.atc_keys,
            "truncated": self.truncated,
            "limit": self.limit,
        }


def _as_dict(value: Any) -> dict[str, Any]:
    """Normalise an AGE ``properties()`` result to a plain dict.

    AGE returns agtype, which arrives as either a dict or a JSON-ish string
    depending on the driver's parsing.
    """
    if isinstance(value, dict):
        return value
    if isinstance(value, str):
        import json

        try:
            parsed = json.loads(value)
        except json.JSONDecodeError:
            return {}
        return parsed if isinstance(parsed, dict) else {}
    return {}


def _first_label(labels: Any) -> str:
    """Pick a single label from AGE's label list.

    A node may carry several labels; the reasoner's fact format takes one type,
    so the first is used deterministically.
    """
    if isinstance(labels, list) and labels:
        return str(labels[0])
    if isinstance(labels, str) and labels:
        return labels.strip("[]").split(",")[0].strip().strip('"')
    return "entity"


def _stable_key(record_id: Any, props: dict[str, Any]) -> str:
    """Choose the identifier that Datalog facts will be built from.

    ``add_fact`` prefers a dict's ``id`` field, so passing AGE's internal row
    id would make every derived fact read ``shares_target(844424930131970, ...)``
    — correct but useless to a caller. A business identifier in the properties
    is therefore preferred, with the row id only as a fallback for nodes that
    carry none.

    Nodes and edges must resolve to the *same* key or edge facts would not join
    to node facts at all, which is why this one function is shared by both.
    """
    for candidate in _KEY_CANDIDATES:
        value = props.get(candidate)
        if value not in (None, ""):
            return str(value)
    return str(record_id)


def _fetch_pages(
    store: ApacheAgeStore,
    template: str,
    where: str,
    parameters: dict[str, Any],
    limit: int,
    page_size: int,
    formatting: dict[str, Any] | None = None,
) -> tuple[list[dict[str, Any]], bool]:
    """Run a query in pages until ``limit`` or exhaustion.

    Each page re-runs the same ordered query with a larger ``LIMIT`` and keeps
    the rows beyond the previous page's count. The query takes no offset, so the
    ordering is the only thing that makes the pages line up — which is why an
    unordered export cannot be paged correctly at all, and why the ordering is
    checked in the tests rather than left implicit.

    A growing ``LIMIT`` re-reads earlier rows on every round trip. That is the
    price of not using ``OFFSET``, which would make each page scan further than
    the last and turn a deep read quadratic. Reads here are bounded by ``limit``,
    which the caller sets, so the total work stays proportionate to the answer.
    """
    records: list[dict[str, Any]] = []
    truncated: bool = False
    while len(records) < limit:
        remaining = limit - len(records)
        size = min(page_size, remaining)
        # Ask for everything seen so far plus the next page, so the new rows are
        # the tail rather than a repeat of the first page.
        wanted = len(records) + size
        result = store.execute_query(
            template.format(where=where, limit=wanted, **(formatting or {})),
            parameters,
        )
        if not result.get("success"):
            raise RuntimeError(f"AGE export failed: {result.get('error')}")
        page = [r for r in (result.get("records") or []) if isinstance(r, dict)]
        # Rows before `len(records)` were the previous page's; anything at or
        # beyond that index is new.
        fresh = page[len(records) :]
        records = page
        if len(page) < wanted:
            # The query ran out of matches, so the result is complete rather
            # than cut. Only a full result at the limit is ambiguous.
            return records, False
        if not fresh:
            # A full page with nothing new cannot make progress; stopping beats
            # spinning forever on a query result that never advances.
            break
        if len(records) >= limit:
            # A full result at exactly the limit is ambiguous: the graph may
            # hold precisely this many rows, or more. Without settling it, a
            # complete answer would be reported as a truncated one — and a
            # caller told its input was cut will discount a conclusion that was
            # in fact drawn from everything. One extra row resolves it.
            truncated = _has_more(store, template, where, parameters, formatting, limit)
            break
    return records, truncated


def _has_more(
    store: ApacheAgeStore,
    template: str,
    where: str,
    parameters: dict[str, Any],
    formatting: dict[str, Any] | None,
    limit: int,
) -> bool:
    """Whether the graph holds more than ``limit`` matching rows."""
    result = store.execute_query(
        template.format(where=where, limit=limit + 1, **(formatting or {})),
        parameters,
    )
    if not result.get("success"):
        raise RuntimeError(f"AGE export failed: {result.get('error')}")
    rows = [r for r in (result.get("records") or []) if isinstance(r, dict)]
    return len(rows) > limit


def export_nodes(
    store: ApacheAgeStore,
    limit: int,
    *,
    drug_keys: list[str] | None = None,
    atc_keys: list[str] | None = None,
    page_size: int = PAGE_SIZE,
) -> tuple[list[dict[str, Any]], bool]:
    """Read nodes in the reasoner's node-dict form.

    With no keys the whole graph is read, which is only ever right for a small
    graph: the caller states its extent through the returned truncation flag.
    """
    where, parameters = _node_filter(drug_keys, atc_keys)
    records, truncated = _fetch_pages(store, _NODES_QUERY, where, parameters, limit, page_size)

    nodes: list[dict[str, Any]] = []
    for record in records:
        node_id = record.get("id")
        if node_id is None:
            # A node with no row id cannot be referenced by an edge, so it has
            # no place in a fact base built to join edges to nodes.
            continue
        props = _as_dict(record.get("props"))
        nodes.append(
            {
                "id": _stable_key(node_id, props),
                "type": _first_label(record.get("labels")),
                "properties": props,
                # Retained so callers can map a fact back to the graph element.
                "graph_id": str(node_id),
            }
        )
    return nodes, truncated


def _node_filter(
    drug_keys: list[str] | None, atc_keys: list[str] | None
) -> tuple[str, dict[str, Any]]:
    """Cypher predicate and parameters selecting the scoped nodes.

    The scoped kinds carry different identifier properties — a drug has
    ``drugbank_id``, a protein ``uniprot_id``, an ATC class ``code`` — so the
    predicate names all three rather than filtering afterwards, which would
    make the LIMIT apply to the wrong population.

    Protein keys are accepted under ``$drug_keys`` because that list is the
    whole scope key set, not only its drugs: the neighbourhood expansion
    resolves drug keys and protein keys into one list, and both become Datalog
    constants that need node facts behind them.
    """
    if not drug_keys and not atc_keys:
        return "true", {}
    clauses = []
    parameters: dict[str, Any] = {}
    if drug_keys:
        clauses.append(f"(n.{_DRUG_COLUMN} IN $drug_keys OR n.{_PROTEIN_COLUMN} IN $drug_keys)")
        parameters["drug_keys"] = drug_keys
    if atc_keys:
        clauses.append(f"n.{_ATC_COLUMN} IN $atc_keys")
        parameters["atc_keys"] = atc_keys
    return "(" + " OR ".join(clauses) + ")", parameters


def export_edges(
    store: ApacheAgeStore,
    limit: int,
    *,
    drug_keys: list[str] | None = None,
    atc_keys: list[str] | None = None,
    include_atc_links: bool = False,
    page_size: int = PAGE_SIZE,
) -> tuple[list[dict[str, Any]], bool]:
    """Read edges in the reasoner's edge-dict form.

    Each edge also carries ``source_props`` / ``target_props``: the endpoint
    node's own properties. They are not part of the reasoner's edge contract,
    but they are the only way to name an endpoint whose node row fell outside
    the node query's limit.
    """
    where, parameters = _edge_filter(drug_keys, atc_keys, include_atc_links)
    records, truncated = _fetch_pages(
        store,
        _EDGES_QUERY,
        where,
        parameters,
        limit,
        page_size,
        # Rendered as a Cypher list literal: the mechanism types are constants
        # in this module, never caller input, so there is nothing to inject.
        formatting={"mechanism": list(_MECHANISM_REL_TYPES)},
    )

    edges: list[dict[str, Any]] = []
    for record in records:
        source = record.get("source")
        target = record.get("target")
        if source is None or target is None:
            continue
        rel_type = record.get("rel_type") or "connected_to"
        props = _as_dict(record.get("props"))
        source_props = _as_dict(record.get("source_props"))
        target_props = _as_dict(record.get("target_props"))
        edges.append(
            {
                # Edge endpoints arrive as row ids, so they are mapped through
                # the same key function the nodes used. If the two disagreed,
                # edge facts would never join to node facts.
                "source": _stable_key(source, source_props),
                "target": _stable_key(target, target_props),
                "type": str(rel_type),
                "properties": props,
                # Retained for label resolution and the fact -> assertion map.
                "graph_id": str(record.get("rel_id")) if record.get("rel_id") else None,
                "source_props": source_props,
                "target_props": target_props,
            }
        )
    return edges, truncated


def _edge_filter(
    drug_keys: list[str] | None,
    atc_keys: list[str] | None,
    include_atc_links: bool,
) -> tuple[str, dict[str, Any]]:
    """Cypher predicate selecting edges inside the scope.

    An edge is in scope when *either* endpoint is one of the scope's keys —
    the scope is a neighbourhood, not an intersection. Requiring both ends
    would make every caller-named scope edge-free, since a caller names one
    drug and that drug's interaction partners are by definition not what was
    named; the fact base would then be edgeless and no rule could fire.

    The scope's key list is what bounds the result, and it was itself built
    under an ordered limit, so the load stays finite and reproducible.
    """
    if not drug_keys and not atc_keys:
        return "true", {}

    parameters: dict[str, Any] = {}
    endpoint = []
    if drug_keys:
        endpoint.append(f"(a.{_DRUG_COLUMN} IN $drug_keys OR b.{_DRUG_COLUMN} IN $drug_keys)")
        parameters["drug_keys"] = drug_keys
    if atc_keys:
        endpoint.append(f"(a.{_ATC_COLUMN} IN $atc_keys OR b.{_ATC_COLUMN} IN $atc_keys)")
        parameters["atc_keys"] = atc_keys

    clauses = ["(" + " OR ".join(endpoint) + ")"]
    if not include_atc_links:
        # Structural links are excluded from a neighbourhood expansion so that
        # sharing an ATC code does not drag in every sibling drug.
        clauses.append(f"NOT type(r) IN {list(_EXCLUDED_REL_TYPES)!r}")
    return " AND ".join(clauses), parameters


# Property names that can carry a display label, in preference order. Shared so
# the node path and the edge-endpoint path cannot drift apart.
_NAME_CANDIDATES = ("name", "uniprot_title", "gene_name", "code")

# Property names that can carry a fact key, in preference order. `code` is
# included because ATC class nodes are identified by their code.
_KEY_CANDIDATES = ("drugbank_id", "uniprot_id", "id", "code", "name")

_DRUG_COLUMN = "drugbank_id"
_PROTEIN_COLUMN = "uniprot_id"
_ATC_COLUMN = "code"


def _endpoint_key(props: dict[str, Any]) -> str | None:
    """Derive the fact key for an edge endpoint from its own properties.

    Mirrors ``_stable_key`` — the same candidate order — so an endpoint names
    the same key the node list would have used for it, lower-cased to match the
    constants ``add_fact`` produces. Returns ``None`` when the endpoint carries
    no usable identifier, in which case it simply goes unlabelled.
    """
    return _lower_or_none(_first_present(props, _KEY_CANDIDATES))


def _lower_or_none(value: str | None) -> str | None:
    return None if value is None else value.lower()


def _display_name(props: dict[str, Any]) -> str | None:
    """Human-readable label from a node's properties, or ``None`` if it has none.

    Facts are keyed by a business identifier (``DB00945``) because Datalog
    constants must be unique and stable, but a caller reading
    ``shares_target(db00945, db01050)`` needs names to show a user. The two are
    kept separate: the key identifies, the label explains.

    ``code`` is the last resort: ATC class nodes carry a code rather than a
    name, and a class is legitimately identified by its code.
    """
    return _first_present(props, _NAME_CANDIDATES)


def _first_present(props: dict[str, Any], candidates: tuple[str, ...]) -> str | None:
    for candidate in candidates:
        value = props.get(candidate)
        if value not in (None, ""):
            return str(value)
    return None


class GraphExport:
    """A ContextGraph-shaped view over an AGE store.

    Exposes ``find_nodes()`` / ``find_edges()``, which is the accessor pair
    ``load_from_graph`` looks for first. Materialising once keeps the two
    generators consistent — Datalog consumes both, and re-querying between them
    could observe a graph that changed underneath.

    The ``range`` attribute is part of the contract, not a debugging aid: a
    caller that cannot see what was loaded cannot interpret an empty
    derivation, and an empty derivation is the only negative answer Datalog
    can give.
    """

    def __init__(
        self,
        store: ApacheAgeStore,
        limit: int,
        *,
        drug_keys: list[str] | None = None,
        atc_keys: list[str] | None = None,
        seed_drug_keys: list[str] | None = None,
        scope_label: str = "all",
        include_atc_links: bool = False,
        page_size: int = PAGE_SIZE,
    ) -> None:
        self._nodes, nodes_truncated = export_nodes(
            store,
            limit,
            drug_keys=drug_keys,
            atc_keys=atc_keys,
            page_size=page_size,
        )
        self._edges, edges_truncated = export_edges(
            store,
            limit,
            drug_keys=drug_keys,
            atc_keys=atc_keys,
            include_atc_links=include_atc_links,
            page_size=page_size,
        )
        self.range = ExportRange(
            scope=scope_label,
            node_count=len(self._nodes),
            edge_count=len(self._edges),
            drug_keys=sorted(drug_keys or []),
            atc_keys=sorted(atc_keys or []),
            seed_drug_keys=sorted(seed_drug_keys or []),
            truncated=nodes_truncated or edges_truncated,
            limit=limit,
        )

    def find_nodes(self) -> Iterator[dict[str, Any]]:
        yield from self._nodes

    def find_edges(self) -> Iterator[dict[str, Any]]:
        yield from self._edges

    @property
    def node_count(self) -> int:
        return len(self._nodes)

    @property
    def edge_count(self) -> int:
        return len(self._edges)

    @property
    def truncated(self) -> bool:
        return self.range.truncated

    def labels(self) -> dict[str, str]:
        """Map every fact key to its display name.

        The reasoner works in keys, so its output alone is unreadable to a
        caller. Returning the whole map (rather than names for just the facts
        that happened to be derived) lets the caller label subject, object and
        any intermediate ground term without a second round trip.

        Keys are lower-cased because ``add_fact`` normalises constants that
        way: a graph property of ``DB00945`` becomes ``db00945`` in every fact.
        Without folding here the map would be keyed in a case that never
        appears in the facts it is meant to explain.

        Edge endpoints are included because the node and edge queries are
        independent: an edge can point at a node the node query's limit did not
        reach, and that endpoint still becomes a Datalog constant.
        """
        resolved: dict[str, str] = {}
        for node in self._nodes:
            name = _display_name(node.get("properties") or {})
            if name is not None:
                resolved.setdefault(str(node["id"]).lower(), name)
        for props in self._endpoint_props():
            key = _endpoint_key(props)
            name = _display_name(props)
            if key is not None and name is not None:
                resolved.setdefault(key, name)
        return resolved

    def node_types(self) -> dict[str, str]:
        """Map every fact key to its node type, for the same reason as labels."""
        resolved = {str(node["id"]).lower(): str(node["type"]) for node in self._nodes}
        # Endpoints outside the node limit carry no label, so their type is
        # reported as unknown rather than guessed.
        for props in self._endpoint_props():
            key = _endpoint_key(props)
            if key is not None:
                resolved.setdefault(key, "unknown")
        return resolved

    def fact_assertions(self) -> dict[str, str | None]:
        """Map every edge fact to the assertion it came from, or to ``None``.

        Datalog's answer is a derived predicate over opaque constants; a
        conclusion is only auditable if each premise can be traced back to
        something the source data actually asserts. The key is the same triple
        ``add_fact`` builds for an edge dict — ``type(source, target)`` — with
        the graph's ``prov`` id as the value.

        A ``None`` value is meaningful and is kept rather than dropped: the
        edge exists in the graph but carries no provenance id, so a conclusion
        resting on it is real but uncitable. Dropping the entry would make that
        edge look like it was never loaded.
        """
        assertions: dict[str, str | None] = {}
        for edge in self._edges:
            source = _lower_or_none(str(edge["source"]))
            target = _lower_or_none(str(edge["target"]))
            if source is None or target is None:
                continue
            predicate = str(edge["type"]).replace(" ", "_").lower()
            key = f"{predicate}({source}, {target})"
            prov = (edge.get("properties") or {}).get("prov")
            assertions.setdefault(key, str(prov) if prov not in (None, "") else None)
        return assertions

    def _endpoint_props(self) -> Iterator[dict[str, Any]]:
        """Yield the property dict of every edge endpoint, deduplicated."""
        seen: set[str] = set()
        for edge in self._edges:
            for side in ("source_props", "target_props"):
                props = edge.get(side) or {}
                key = _endpoint_key(props)
                if key is None or key in seen:
                    continue
                seen.add(key)
                yield props

    def to_turtle(self) -> str:
        """Serialise the graph as Turtle for SHACL validation.

        Nodes become typed subjects, edges become predicate-object pairs. The
        predicate is the relationship type in a local namespace, since AGE
        edges carry no IRI.

        Subjects are keyed by their business identifier (``lucent:DB00945``)
        rather than the row id, so a constraint violation names something the
        shape author can look up.
        """
        lines = [
            f"@prefix lucent: <{GRAPH_NAMESPACE}> .",
            "@prefix rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#> .",
            "",
        ]

        for node in self._nodes:
            subject = f"lucent:{_turtle_key(node['id'])}"
            lines.append(f"{subject} a lucent:{_turtle_key(node['type'])} ;")
            for key, value in node["properties"].items():
                predicate = _turtle_key(key)
                lines.append(f"    lucent:{predicate} {_turtle_literal(value)} ;")
            # Close the statement by replacing the trailing ' ;'.
            lines[-1] = lines[-1].rstrip(" ;") + " ."
            lines.append("")

        for edge in self._edges:
            subject = f"lucent:{_turtle_key(edge['source'])}"
            obj = f"lucent:{_turtle_key(edge['target'])}"
            lines.append(f"{subject} lucent:{_turtle_key(edge['type'])} {obj} .")

        lines.append("")
        return "\n".join(lines)


def _turtle_key(key: str) -> str:
    """Make an arbitrary property name safe as a Turtle local name."""
    cleaned = "".join(ch if ch.isalnum() or ch == "_" else "_" for ch in str(key))
    if not cleaned or cleaned[0].isdigit():
        cleaned = f"p_{cleaned}"
    return cleaned


def _turtle_literal(value: Any) -> str:
    """Render a Python value as a Turtle literal or IRI."""
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, (int, float)):
        return str(value)
    if value is None:
        return '""'
    text = str(value).replace("\\", "\\\\").replace('"', '\\"').replace("\n", "\\n")
    return f'"{text}"'
