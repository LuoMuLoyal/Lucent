"""Manual check that the shape gate and the vocabulary agree with the live graph.

The unit tests pin the gate against strings. This asserts the thing a string
cannot: that a shape written in this namespace really does select targets in the
deployed graph, and that the same shape in another namespace really does pass
vacuously — which is the false pass the gate exists to prevent.

    uv run python scripts/check_shapes.py
"""

from __future__ import annotations

from semantica.ontology.engine import OntologyEngine

from semantica_service.config import get_settings
from semantica_service.graph import (
    GRAPH_NAMESPACE,
    GraphExport,
    StorePool,
    check_shape_namespaces,
)

# Deliberately unsatisfiable: no Drug carries this property, so a shape that
# really runs must report violations. If it conforms, nothing was checked.
IMPOSSIBLE = f"""
@prefix sh: <http://www.w3.org/ns/shacl#> .
@prefix lucent: <{GRAPH_NAMESPACE}> .

lucent:DrugShape a sh:NodeShape ;
    sh:targetClass lucent:Drug ;
    sh:property [
        sh:path lucent:no_such_property_exists ;
        sh:minCount 1 ;
        sh:message "This property does not exist, so this must not conform." ;
    ] .
"""

SATISFIABLE = f"""
@prefix sh: <http://www.w3.org/ns/shacl#> .
@prefix lucent: <{GRAPH_NAMESPACE}> .

lucent:DrugShape a sh:NodeShape ;
    sh:targetClass lucent:Drug ;
    sh:property [
        sh:path lucent:drugbank_id ;
        sh:minCount 1 ;
        sh:message "A Drug must carry its DrugBank identifier." ;
    ] .
"""


def main() -> None:
    settings = get_settings()
    pool = StorePool(settings)
    try:
        with pool.borrow() as store:
            export = GraphExport(store, limit=2000)
        print(f"graph: {export.node_count} nodes, {export.edge_count} edges")
        turtle = export.to_turtle()
        print(f"turtle: {len(turtle)} bytes")
        print()

        engine = OntologyEngine()

        print("=== the vocabulary the gate accepts ===")
        for label, shapes in (("satisfiable", SATISFIABLE), ("impossible", IMPOSSIBLE)):
            report = check_shape_namespaces(shapes)
            print(f"  {label}: gate={'accepted' if report.ok else 'refused'}")
            assert report.ok, report.problems
        print()

        print("=== a gate-accepted shape really constrains the graph ===")
        for label, shapes, expect_conforms in (
            ("satisfiable", SATISFIABLE, True),
            ("impossible", IMPOSSIBLE, False),
        ):
            result = engine.validate_graph(turtle, shacl=shapes, explain=False)
            violations = len(getattr(result, "violations", []))
            print(f"  {label}: conforms={result.conforms} violations={violations}")
            assert result.conforms is expect_conforms, (
                f"{label} shape: expected conforms={expect_conforms}, got {result.conforms}"
            )
        print()
        print("  the impossible shape reported violations, so validation really ran")
        print()

        print("=== the false pass the gate refuses ===")
        wrong = IMPOSSIBLE.replace(GRAPH_NAMESPACE, "http://example.org/other#")
        result = engine.validate_graph(turtle, shacl=wrong, explain=False)
        violations = len(getattr(result, "violations", []))
        print(f"  wrong namespace: conforms={result.conforms} violations={violations}")
        assert result.conforms is True and violations == 0, (
            "expected the wrong namespace to pass vacuously; if SHACL now refuses "
            "it, the gate is redundant but not wrong"
        )
        print("  SHACL reports a clean pass from a check that never ran")

        gate = check_shape_namespaces(wrong)
        print(f"  gate: {'accepted' if gate.ok else 'refused'}")
        for problem in gate.problems:
            print(f"    {problem}")
        assert not gate.ok, "the gate must refuse what SHACL silently passes"
    finally:
        pool.close()

    print()
    print("all checks passed")


if __name__ == "__main__":
    main()
