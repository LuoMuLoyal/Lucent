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
    check("schema lists Drug and Protein", labels == {"Drug", "Protein"}, f"labels={labels}")
    types = {item["label"] for item in body.get("relationship_types", [])}
    check("schema lists both edge types", types == {"TARGETS", "INTERACTS_WITH"}, f"types={types}")

    print()
    print("=== /reason (over the live graph) ===")
    # Reachability across the graph: which drugs share a target protein?
    # Facts are built from each node's canonical identifier (drugbank_id),
    # lowercased by add_fact, so results are ids rather than display names.
    status, body = call(
        "POST",
        "/reason",
        {
            "load_from_graph": True,
            "rules": [
                {"rule": "shares_target(X, Y) :- targets(X, P), targets(Y, P), X != Y."},
            ],
            "query": "shares_target(db00945, ?Y)",
        },
    )
    check("reason returns 200", status == 200, f"got {status}: {body}")
    bindings = body.get("bindings") or []
    partners = {row.get("Y") for row in bindings}
    # db00945 is Aspirin, db01050 is Ibuprofen; both target COX-1.
    check(
        "shared-target inference finds Ibuprofen (db01050)",
        "db01050" in partners,
        f"bindings={bindings}",
    )
    # Aspirin must not be inferred as sharing a target with itself.
    check(
        "no self-conflict in the inferred set",
        not any(row.get("Y") == "db00945" for row in bindings),
        f"bindings={bindings}",
    )

    print()
    print("=== /validate (violation expected) ===")
    shapes = """
    @prefix sh: <http://www.w3.org/ns/shacl#> .
    @prefix lucent: <http://lucent.local/graph#> .

    lucent:ProteinShape a sh:NodeShape ;
        sh:targetClass lucent:Protein ;
        sh:property [
            sh:path lucent:name ;
            sh:minCount 1 ;
            sh:message "A Protein must have a name." ;
        ] .
    """
    status, body = call("POST", "/validate", {"shacl": shapes, "explain": True})
    check("validate returns 200", status == 200, f"got {status}: {body}")
    check(
        "validate detects the unnamed Protein",
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
            sh:path lucent:name ;
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
    status, _ = call("POST", "/reason", {"rules": [{"rule": "a(X) :- b(X)."}]})
    check("empty fact base is 422", status == 422, f"got {status}")

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
