"""Manual check that SHACL actually detects violations and Datalog actually derives.

The endpoint tests assert response shapes; this asserts the engines do real
work. Run deliberately, not as part of the suite.

    uv run python scripts/check_reasoning.py
"""

from semantica.ontology.engine import OntologyEngine
from semantica.reasoning.datalog_reasoner import DatalogReasoner

TURTLE = """
@prefix lucent: <http://lucent.local/graph#> .

lucent:node1 a lucent:Drug ;
    lucent:name "Aspirin" .
lucent:node2 a lucent:Drug ;
    lucent:name "Warfarin" .
lucent:node3 a lucent:Protein .
"""

SHAPES = """
@prefix sh: <http://www.w3.org/ns/shacl#> .
@prefix lucent: <http://lucent.local/graph#> .

lucent:DrugShape a sh:NodeShape ;
    sh:targetClass lucent:Drug ;
    sh:property [
        sh:path lucent:name ;
        sh:minCount 1 ;
        sh:message "A Drug must have a name." ;
    ] .

lucent:ProteinShape a sh:NodeShape ;
    sh:targetClass lucent:Protein ;
    sh:property [
        sh:path lucent:name ;
        sh:minCount 1 ;
        sh:message "A Protein must have a name." ;
    ] .
"""


def check_shacl() -> None:
    print("=== SHACL ===")
    engine = OntologyEngine()
    report = engine.validate_graph(TURTLE, SHAPES, explain=True)
    print("conforms:", report.conforms)
    print("summary :", report.summary())
    print("violations:", len(report.violations))
    for violation in report.violations:
        node = getattr(violation, "focus_node", "?")
        msg = getattr(violation, "message", "?")
        print(f"  - {node}: {msg}")

    # node3 is a Protein with no name, so exactly one violation is expected.
    assert not report.conforms, "SHACL reported conformance on a graph that violates a shape"
    assert len(report.violations) == 1, f"expected 1 violation, got {len(report.violations)}"
    print("OK: violation detected as expected")


def check_datalog() -> None:
    print()
    print("=== Datalog ===")
    engine = DatalogReasoner()
    for fact in ["parent(tom, bob)", "parent(bob, ann)", "parent(ann, sue)"]:
        engine.add_fact(fact)
    engine.add_rule("ancestor(X, Y) :- parent(X, Y).")
    engine.add_rule("ancestor(X, Z) :- parent(X, Y), ancestor(Y, Z).")

    derived = engine.derive_all()
    ancestors = sorted(f for f in derived if f.startswith("ancestor"))
    print("derived ancestor facts:")
    for fact in ancestors:
        print(f"  {fact}")

    # Transitive closure over a 3-edge chain: 3 direct + 2 two-hop + 1 three-hop.
    assert "ancestor(tom, sue)" in derived, "three-hop closure missing"
    assert len(ancestors) == 6, f"expected 6 ancestor facts, got {len(ancestors)}"
    print("OK: transitive closure complete")

    print()
    print("=== Datalog inequality (fork fix) ===")
    conflicts = DatalogReasoner()
    conflicts.add_fact("takes(alice, aspirin)")
    conflicts.add_fact("takes(bob, aspirin)")
    conflicts.add_rule("conflict(X, Y) :- takes(X, D), takes(Y, D), X != Y.")
    result = conflicts.derive_all()
    found = sorted(f for f in result if f.startswith("conflict"))
    print("derived:", found)
    assert found, "inequality constraint was silently ignored"
    assert not any("alice, alice" in f or "bob, bob" in f for f in found), "self-conflict derived"
    print("OK: inequality enforced")


if __name__ == "__main__":
    check_shacl()
    check_datalog()
    print()
    print("all checks passed")
