"""Export a bounded, scoped slice of the AGE graph as a ContextGraph JSON file.

The Explorer (``semantica-explorer --graph <file.json>``) loads its graph through
``ContextGraph.load_from_file`` into an **in-memory** graph: it has no AGE
adapter and never opens a connection of its own. So the only way to see the real
DrugBank graph in the official UI is to hand it a file — and the whole graph
cannot be that file (211,630 edges would be loaded into memory and rendered as a
hairball).

This script is that bridge, and it is deliberately the *same* scoping the rest of
the service uses. It reuses ``resolve_scope`` / ``GraphExport`` rather than
re-deriving a neighbourhood, so the slice the Explorer shows is the slice
``/reason`` would reason over — including the symmetric-edge mirroring, without
which warfarin (530 incoming, 0 outgoing) would render as an isolated dot.

**The read budget and the render budget are not the same number.** They were
conflated in the first version of this script, and the failure was total rather
than partial: with ``--limit 400`` the export returned 400 nodes and 400 edges
that shared *zero* endpoints, so the Explorer would have drawn 400 disconnected
dots. The cause is that ``GraphExport`` bounds nodes and edges **independently**
— the node query orders by ``coalesce(drugbank_id, uniprot_id, code, name)`` and
a limit of 400 fills entirely with drugs (``DB00005``…), while every edge points
at a ``Protein``. Neither result is truncated in a way the range echo can see,
because neither individual query ran out of rows; the two sets simply never meet.
The read therefore runs at whatever the scope needs (``--read-limit``), and the
*rendered* subset is then chosen from the intersection (``--limit``), which is
the only set where an edge and both its endpoints all exist.

Why a script and not a route: the Explorer is a development console, and
``pyproject.toml`` keeps ``explorer`` out of the service's dependency set so its
routes never become part of the tool contract. A script is read-only, on demand,
and adds nothing to the served surface.

Usage::

    uv run python scripts/export_context_graph.py --drug Warfarin --drug Clopidogrel
    uv run python scripts/export_context_graph.py --atc B01A --out data/viz/b01a.json

Output conforms to what ``ContextGraph.load_from_file`` accepts: an object with
``nodes`` and ``edges``. Node ids are the graph's business keys (``DB00682``,
``P04275``), which is what the exporter already emits and what makes the rendered
node readable rather than an AGE row id.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

# Import the service's own scoping/export layer. The script is run from the repo
# root by `uv run`, which puts `src/` on the path via the installed package.
from semantica_service.config import get_settings
from semantica_service.graph import StorePool
from semantica_service.graph.export import GraphExport
from semantica_service.graph.range import ScopeSpec, resolve_scope

DEFAULT_OUT = Path(__file__).resolve().parent.parent / "data" / "viz"

# Node labels that carry no properties worth rendering and whose edges are
# structural. ATC classes are excluded from the *reasoning* vocabulary
# (`export._EXCLUDED_REL_TYPES`), and including them here would drag every
# sibling drug sharing a code into the picture. The flag exists so a reviewer can
# ask for them explicitly.
_STRUCTURAL_REL_TYPES = ("IN_ATC_CLASS", "SUBCLASS_OF")


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    parser.add_argument(
        "--drug",
        action="append",
        default=[],
        help="Drug name or DrugBank id to anchor the scope (repeatable).",
    )
    parser.add_argument(
        "--atc",
        action="append",
        default=[],
        help="ATC level-4 prefix to widen the scope (repeatable), e.g. B01A.",
    )
    parser.add_argument(
        "--limit",
        type=int,
        default=400,
        help=(
            "Max nodes AND max edges to *render* (default: 400). This is the legibility "
            "budget, not the read budget; the slice is taken from the edges that have both "
            "endpoints present."
        ),
    )
    parser.add_argument(
        "--read-limit",
        type=int,
        default=60_000,
        help=(
            "Max nodes and max edges to *read* from AGE before selecting what to render. "
            "Must be large enough that the node set actually intersects the edge set — at "
            "small values the node query fills with drugs and every edge endpoint is a "
            "protein, which yields a graph with no connected component (default: 60000)."
        ),
    )
    parser.add_argument(
        "--include-atc-links",
        action="store_true",
        help="Also load IN_ATC_CLASS / SUBCLASS_OF edges (excluded by default).",
    )
    parser.add_argument(
        "--out",
        type=Path,
        default=None,
        help=f"Output JSON path (default: {DEFAULT_OUT}/<scope>.json).",
    )
    return parser.parse_args(argv)


def _scope_slug(names: list[str], prefixes: list[str]) -> str:
    """A stable, filesystem-safe name for the scope, so re-runs overwrite."""
    parts = [n.strip().replace(" ", "_") for n in names if n.strip()]
    parts += [p.strip() for p in prefixes if p.strip()]
    slug = "-".join(parts) if parts else "all"
    return "".join(ch if ch.isalnum() or ch in "-_" else "_" for ch in slug)[:80]


def _node_doc(node: dict[str, Any]) -> dict[str, Any]:
    """Convert an export node into the ContextGraph node contract.

    ``content`` is set explicitly because the Explorer's search index and node
    cards read it; ``ContextNode`` would otherwise fall back to the id, and every
    card in the UI would read ``DB00682`` instead of ``Warfarin``.
    """
    props = dict(node.get("properties") or {})
    label = props.get("name") or props.get("uniprot_title") or props.get("code") or node["id"]
    return {
        "id": str(node["id"]),
        "type": str(node.get("type") or "entity"),
        "content": str(label),
        "properties": props,
    }


def _edge_doc(edge: dict[str, Any]) -> dict[str, Any]:
    """Convert an export edge into the ContextGraph edge contract.

    ``weight`` is carried across because the Explorer's Dijkstra path view reads
    it; a missing weight is not an error there but every edge becomes equal-cost,
    which makes the weighted path view silently meaningless.
    """
    props = dict(edge.get("properties") or {})
    return {
        "source": str(edge["source"]),
        "target": str(edge["target"]),
        "type": str(edge.get("type") or "related_to"),
        "weight": 1.0,
        "properties": props,
    }


def build_document(export: GraphExport, limit: int) -> dict[str, Any]:
    """Assemble the JSON payload the Explorer loads, bounded to ``limit``.

    Selection runs in four steps, and the order matters:

    1. **Intersect.** Keep only edges whose endpoints are both in the node set.
       ``ContextGraph`` accepts dangling endpoints silently, so an edge to a node
       that was never loaded would render as an edge to nowhere; dropping it here
       makes the loss visible in the report instead of quietly wrong on screen.
    2. **Cap per relationship type.** ``INTERACTS_WITH`` is 200,182 of the
       graph's 211,630 edges, so *any* unbiased selection is overwhelmingly
       interaction pairs. Measured: ranking a 400-edge slice purely by endpoint
       degree produced 400 ``INTERACTS_WITH`` edges over just 37 drug nodes and no
       proteins at all — the mechanistic edges (``INHIBITS``, ``ACTS_ON``,
       ``SUBSTRATE_OF``) that make the graph explain *why* two drugs interact
       were crowded out entirely. Each type gets an equal share, so the picture
       shows mechanism as well as co-prescription.
    3. **Rank by degree.** Within a type, the most-connected endpoints are what
       make a graph readable: a slice chosen by row id would be several copies of
       the same hub's neighbourhood.
    4. **Bound.** Keep only nodes the kept edges touch, and trim to ``limit``.

    Steps 2–4 are what make the picture legible; step 1 is what makes it *true*.
    """
    all_nodes = [_node_doc(n) for n in export.find_nodes()]
    node_ids = {n["id"] for n in all_nodes}
    raw_edges = [_edge_doc(e) for e in export.find_edges()]
    connected = [e for e in raw_edges if e["source"] in node_ids and e["target"] in node_ids]

    degree: dict[str, int] = {}
    for edge in connected:
        degree[edge["source"]] = degree.get(edge["source"], 0) + 1
        degree[edge["target"]] = degree.get(edge["target"], 0) + 1

    # Group by type, preserving a deterministic order, then round-robin so every
    # type is represented before any type gets a second helping.
    by_type: dict[str, list[dict[str, Any]]] = {}
    for edge in sorted(connected, key=lambda e: (e["type"], e["source"], e["target"])):
        by_type.setdefault(edge["type"], []).append(edge)
    for edges_of_type in by_type.values():
        edges_of_type.sort(
            key=lambda e: (-(degree[e["source"]] + degree[e["target"]]), e["source"], e["target"])
        )

    kept_edges: list[dict[str, Any]] = []
    seen_keys: set[tuple[str, str, str]] = set()
    cursors = dict.fromkeys(by_type, 0)
    while len(kept_edges) < limit and any(cursors[t] < len(by_type[t]) for t in by_type):
        for rel_type in by_type:
            if len(kept_edges) >= limit:
                break
            index = cursors[rel_type]
            if index >= len(by_type[rel_type]):
                continue
            edge = by_type[rel_type][index]
            cursors[rel_type] = index + 1
            key = (edge["source"], edge["target"], edge["type"])
            if key in seen_keys:
                continue
            seen_keys.add(key)
            kept_edges.append(edge)

    kept_ids = {e["source"] for e in kept_edges} | {e["target"] for e in kept_edges}
    kept_nodes = sorted(
        (n for n in all_nodes if n["id"] in kept_ids),
        key=lambda n: (-degree.get(n["id"], 0), n["id"]),
    )[:limit]
    kept_node_ids = {n["id"] for n in kept_nodes}
    kept_edges = [
        e for e in kept_edges if e["source"] in kept_node_ids and e["target"] in kept_node_ids
    ]

    return {
        "graph_id": "lucent-graph-export",
        "nodes": kept_nodes,
        "edges": kept_edges,
        "_export": {
            "range": export.range.describe(),
            "read_nodes": len(all_nodes),
            "read_edges": len(raw_edges),
            "connected_edges": len(connected),
            "dangling_edges_dropped": len(raw_edges) - len(connected),
            "rendered_nodes": len(kept_nodes),
            "rendered_edges": len(kept_edges),
            "rendered_edge_types": sorted({e["type"] for e in kept_edges}),
            "rendered_node_types": sorted({n["type"] for n in kept_nodes}),
            "limit": limit,
        },
    }


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    if not args.drug and not args.atc:
        print("Refusing to export the whole graph: name a --drug or --atc scope.", file=sys.stderr)
        return 2

    settings = get_settings()
    spec = ScopeSpec(
        drug_names=tuple(args.drug),
        atc_prefixes=tuple(args.atc),
        limit=args.read_limit,
    )

    with StorePool(settings).borrow() as store:
        resolved = resolve_scope(store, spec)
        if resolved.is_empty:
            named = ", ".join([*args.drug, *args.atc])
            print(f"Scope matched nothing in the graph: {named}", file=sys.stderr)
            return 1

        export = GraphExport(
            store,
            args.read_limit,
            drug_keys=resolved.drug_keys,
            atc_keys=resolved.atc_keys,
            seed_drug_keys=resolved.seed_drug_keys,
            scope_label=",".join([*args.drug, *args.atc]),
            include_atc_links=args.include_atc_links,
        )
        document = build_document(export, args.limit)

    out = args.out or (DEFAULT_OUT / f"{_scope_slug(args.drug, args.atc)}.json")
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(document, ensure_ascii=False, indent=2), encoding="utf-8")

    rng = export.range
    info = document["_export"]
    print(f"scope       : {rng.scope}")
    print(f"drugs       : {len(rng.drug_keys)} (named {len(rng.seed_drug_keys)})")
    print(f"atc classes : {len(rng.atc_keys)}")
    print(f"read        : {info['read_nodes']} nodes / {info['read_edges']} edges")
    print(f"connected   : {info['connected_edges']} edges with both endpoints present")
    if info["dangling_edges_dropped"]:
        print(f"dropped     : {info['dangling_edges_dropped']} edges pointing outside the node set")
    print(f"rendered    : {info['rendered_nodes']} nodes / {info['rendered_edges']} edges")
    print(f"  node types: {info['rendered_node_types']}")
    print(f"  edge types: {info['rendered_edge_types']}")
    if rng.truncated:
        print("truncated   : yes — the read is a prefix of the scope, not all of it")

    if not document["edges"]:
        # The failure mode this script was rewritten to catch: a payload that
        # loads cleanly in the Explorer and renders as disconnected dots.
        print(
            "\nREFUSING to write a graph with no edges: raise --read-limit "
            "(or lower --limit) so the node set intersects the edge set.",
            file=sys.stderr,
        )
        out.unlink(missing_ok=True)
        return 1

    print(f"written     : {out}")
    print(f'\nopen with   : uv run semantica-explorer --graph "{out}" --port 8010')
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
