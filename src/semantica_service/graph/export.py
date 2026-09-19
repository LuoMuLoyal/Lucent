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
       properties(r) AS props, labels(a) AS source_labels
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
        nodes.append(
            {
                "id": str(node_id),
                "type": _first_label(record.get("labels")),
                "properties": props,
            }
        )
    return nodes


def export_edges(store: ApacheAgeStore, limit: int) -> list[dict[str, Any]]:
    """Read edges in the reasoner's edge-dict form."""
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
        edges.append(
            {
                "source": str(source),
                "target": str(target),
                "type": str(rel_type),
                "properties": props,
            }
        )
    return edges


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

    def to_turtle(self) -> str:
        """Serialise the graph as Turtle for SHACL validation.

        Nodes become typed subjects, edges become predicate-object pairs. The
        predicate is the relationship type in a local namespace, since AGE
        edges carry no IRI.
        """
        lines = [
            "@prefix lucent: <http://lucent.local/graph#> .",
            "@prefix rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#> .",
            "",
        ]

        for node in self._nodes:
            subject = f"lucent:node{node['id']}"
            lines.append(f"{subject} a lucent:{node['type']} ;")
            for key, value in node["properties"].items():
                predicate = _turtle_key(key)
                lines.append(f"    lucent:{predicate} {_turtle_literal(value)} ;")
            # Close the statement by replacing the trailing ' ;'.
            lines[-1] = lines[-1].rstrip(" ;") + " ."
            lines.append("")

        for edge in self._edges:
            subject = f"lucent:node{edge['source']}"
            obj = f"lucent:node{edge['target']}"
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
