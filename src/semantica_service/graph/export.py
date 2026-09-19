"""Bridge from the AGE graph store to the shapes semantica's engines accept.

``DatalogReasoner.load_from_graph`` documents that a graph-store handle is not
an accepted input — it needs a ContextGraph-like object or dicts, and raises
``TypeError`` otherwise (a fork fix; upstream returned 0 and silently reasoned
over an empty fact base). AGE stores are explicitly named as unsupported. This
module is therefore the adapter the plan calls the "application-side bridge".

The dict shapes emitted here follow ``DatalogReasoner.add_fact``'s accepted
forms:

* ``{subject, predicate, object}``
* ``{source, target, type}``
* ``{id, type}``
"""

from __future__ import annotations

from collections.abc import Iterator
from typing import Any

from semantica.graph_store.age_store import ApacheAgeStore

# One Cypher round-trip per kind of element. Reading through execute_query
# rather than get_nodes keeps the shape under our control, since the dict
# forms above are what the reasoner actually consumes.
_NODES_QUERY = """
MATCH (n)
RETURN id(n) AS id, labels(n) AS labels, properties(n) AS props
LIMIT {limit}
"""

_EDGES_QUERY = """
MATCH (a)-[r]->(b)
RETURN id(a) AS source, id(b) AS target, type(r) AS rel_type,
       properties(r) AS props,
       properties(a) AS source_props, properties(b) AS target_props
LIMIT {limit}
"""


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


def export_nodes(store: ApacheAgeStore, limit: int) -> list[dict[str, Any]]:
    """Read nodes in the reasoner's node-dict form."""
    result = store.execute_query(_NODES_QUERY.format(limit=limit))
    if not result.get("success"):
        raise RuntimeError(f"AGE node export failed: {result.get('error')}")

    nodes: list[dict[str, Any]] = []
    for record in result.get("records", []):
        node_id = record.get("id")
        if node_id is None:
            continue
        props = _as_dict(record.get("props"))
        key = _stable_key(node_id, props)
        node = {
            "id": key,
            "type": _first_label(record.get("labels")),
            "properties": props,
            # Retained so callers can map a fact back to the graph element.
            "graph_id": str(node_id),
        }
        nodes.append(node)
    return nodes


def export_edges(store: ApacheAgeStore, limit: int) -> list[dict[str, Any]]:
    """Read edges in the reasoner's edge-dict form.

    Each edge also carries ``source_props`` / ``target_props``: the endpoint
    node's own properties. They are not part of the reasoner's edge contract,
    but they are the only way to name an endpoint whose node row fell outside
    the node query's limit.
    """
    result = store.execute_query(_EDGES_QUERY.format(limit=limit))
    if not result.get("success"):
        raise RuntimeError(f"AGE edge export failed: {result.get('error')}")

    edges: list[dict[str, Any]] = []
    for record in result.get("records", []):
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
                # Retained for label resolution only.
                "source_props": source_props,
                "target_props": target_props,
            }
        )
    return edges


# Property names that can carry a display label, in preference order. Shared so
# the node path and the edge-endpoint path cannot drift apart.
_NAME_CANDIDATES = ("name", "uniprot_title", "gene_name", "code")

# Property names that can carry a fact key, in preference order. `code` is
# included because ATC class nodes are identified by their code.
_KEY_CANDIDATES = ("drugbank_id", "uniprot_id", "id", "code", "name")


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
    """

    def __init__(self, store: ApacheAgeStore, limit: int) -> None:
        self._nodes = export_nodes(store, limit)
        self._edges = export_edges(store, limit)

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
            "@prefix lucent: <http://lucent.local/graph#> .",
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
