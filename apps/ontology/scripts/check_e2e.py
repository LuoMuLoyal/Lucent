"""End-to-end check against the live dev stack.

Exercises the real HTTP surface over a real AGE database — no stubs. This is
the "link actually works" proof; the pytest suite stays stub-based so it can
run without a database.

    uv run python scripts/check_e2e.py
"""

import json
import sys
import urllib.error
import urllib.request
from typing import Any

BASE = "http://127.0.0.1:8099"

PASSED: list[str] = []
FAILED: list[str] = []


def call(
    method: str, path: str, payload: dict[str, Any] | None = None
) -> tuple[int, dict[str, Any]]:
    data = json.dumps(payload).encode() if payload is not None else None
    request = urllib.request.Request(
        f"{BASE}{path}",
        data=data,
        method=method,
        headers={"Content-Type": "application/json"} if data else {},
    )
    try:
        with urllib.request.urlopen(request, timeout=60) as response:
            return response.status, json.loads(response.read() or b"{}")
    except urllib.error.HTTPError as exc:
        body = exc.read()
        try:
            return exc.code, json.loads(body)
        except json.JSONDecodeError:
            return exc.code, {"raw": body.decode(errors="replace")}


def check(name: str, condition: bool, detail: str = "") -> None:
    if condition:
        PASSED.append(name)
        print(f"  PASS  {name}")
    else:
        FAILED.append(f"{name}: {detail}")
        print(f"  FAIL  {name}  {detail}")


def main() -> int:
    print("=== /health ===")
    status, body = call("GET", "/health")
    check("health returns 200", status == 200, f"got {status}: {body}")
    check(
        "health reports a non-empty graph",
        body.get("stats", {}).get("node_count", 0) > 0,
        f"stats={body.get('stats')}",
    )

    print()
    print("=== /schema ===")
    status, body = call("GET", "/schema")
    check("schema returns 200", status == 200, f"got {status}")
    labels = {item["label"] for item in body.get("labels", [])}
    # A superset assertion, not equality: the graph may gain a label and that is
    # not a failure of this check. Equality would fail on a correct graph the
    # moment a label is added, which is how this check went red while the graph
    # was right.
    check("schema lists Drug and Protein", {"Drug", "Protein"} <= labels, f"labels={labels}")
    types = {item["label"] for item in body.get("relationship_types", [])}
    check(
        "schema lists the interaction and mechanism edge types",
        {"INTERACTS_WITH", "ACTS_ON", "INHIBITS", "SUBSTRATE_OF"} <= types,
        f"types={types}",
    )

    print()
    print("=== /reason (over the live graph) ===")
    # `/reason` derives from the shipped Cypher rules; the scope is the drug the
    # caller names. The old form of this check posted a Datalog rule and a query,
    # which the endpoint no longer accepts — that is now a 422 by design, so
    # posting it would have tested the refusal rather than the reasoning.
    status, body = call(
        "POST",
        "/reason",
        {
            "load_from_graph": True,
            "intent": "shared_target",
            "scope": {"drug_names": ["Warfarin"]},
        },
    )
    check("reason returns 200", status == 200, f"got {status}: {body}")
    conclusions = body.get("conclusions") or []
    check(
        "shared-target inference returns conclusions",
        len(conclusions) > 0,
        f"conclusions={conclusions[:3]}",
    )
    # Warfarin is present in this bounded subgraph and has a known count. The
    # earlier version of this check named Aspirin, which the graph does not
    # contain at all — it asserted on a drug that was never loaded.
    check(
        "the scope is the named drug, not its whole neighbourhood",
        len(conclusions) <= 100,
        f"{len(conclusions)} conclusions: a neighbour-set scope returned 500 here",
    )
    # Aspirin must not be inferred as sharing a target with itself.
    check(
        "no self-conflict in the inferred set",
        not any(row.get("subject") == row.get("object") for row in conclusions),
        f"conclusions={conclusions[:3]}",
    )
    # Every conclusion must be citable: a conclusion whose premise has no
    # provenance id cannot be checked by the reader.
    uncited = body.get("uncited_premises") or []
    check("every conclusion carries its premise provenance", not uncited, f"uncited={uncited}")
    # A drug the graph does not contain must be refused, not silently widened to
    # the whole graph: an empty scope that reads as "no relations" is the most
    # misleading possible answer.
    status, body = call(
        "POST",
        "/reason",
        {
            "load_from_graph": True,
            "intent": "shared_target",
            "scope": {"drug_names": ["NoSuchDrugNameAnywhere"]},
        },
    )
    check(
        "an unknown drug name is refused rather than widened",
        status == 422 and body.get("detail", {}).get("kind") == "scope_matched_nothing",
        f"got {status}: {body}",
    )

    print()
    print("=== /validate (violation expected) ===")
    # The path must be one the export actually writes. `lucent:name` was used
    # here before and reported 0 violations: the shape selected real Drug nodes
    # but the path matched nothing, so "conforms" was a clean pass from a check
    # that never ran. `drugbank_id` is a property the export really emits.
    shapes = """
    @prefix sh: <http://www.w3.org/ns/shacl#> .
    @prefix lucent: <http://lucent.local/graph#> .

    lucent:DrugShape a sh:NodeShape ;
        sh:targetClass lucent:Drug ;
        sh:property [
            sh:path lucent:no_such_property_exists ;
            sh:minCount 1 ;
            sh:message "This property does not exist, so this must not conform." ;
        ] .
    """
    status, body = call("POST", "/validate", {"shacl": shapes, "explain": True})
    check("validate returns 200", status == 200, f"got {status}: {body}")
    check(
        "validate reports a non-conforming graph",
        body.get("conforms") is False,
        f"conforms={body.get('conforms')}",
    )
    check(
        "validate reports at least one violation",
        body.get("violation_count", 0) >= 1,
        f"count={body.get('violation_count')}",
    )

    print()
    print("=== /validate (conforming) ===")
    lenient = """
    @prefix sh: <http://www.w3.org/ns/shacl#> .
    @prefix lucent: <http://lucent.local/graph#> .

    lucent:DrugShape a sh:NodeShape ;
        sh:targetClass lucent:Drug ;
        sh:property [
            sh:path lucent:drugbank_id ;
            sh:minCount 1 ;
        ] .
    """
    status, body = call("POST", "/validate", {"shacl": lenient})
    check(
        "a satisfied shape conforms",
        body.get("conforms") is True,
        f"conforms={body.get('conforms')} violations={body.get('violations')}",
    )

    print()
    print("=== error handling ===")
    # A legacy Datalog payload: the fields are gone by design, and the point of
    # rejecting them is that a caller who sends them must not receive a confident
    # answer derived from a rule it did not run.
    status, body = call("POST", "/reason", {"rules": [{"rule": "a(X) :- b(X)."}]})
    check("a legacy rules payload is 422", status == 422, f"got {status}")
    detail = json.dumps(body)
    check(
        "the refusal names the field that was removed",
        "rules" in detail,
        f"detail={detail[:200]}",
    )

    status, _ = call("POST", "/validate", {"shacl": lenient, "ontology": {"concepts": []}})
    check("both shape sources is 422", status == 422, f"got {status}")

    print()
    total = len(PASSED) + len(FAILED)
    print(f"=== {len(PASSED)}/{total} passed ===")
    for failure in FAILED:
        print(f"  FAILED: {failure}")
    return 1 if FAILED else 0


if __name__ == "__main__":
    sys.exit(main())
