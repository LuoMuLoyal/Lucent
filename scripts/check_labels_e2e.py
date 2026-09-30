"""E2E over HTTP against the mid-size graph, focusing on the label question.

The point of this run is to answer "does a derived fact carry enough for a
caller to show a user or an assistant a name, not an identifier" with evidence
from the live service rather than from a stub.
"""

from __future__ import annotations

import json
import time
import urllib.error
import urllib.request
from typing import Any

BASE = "http://127.0.0.1:8099"

PASSED: list[str] = []
FAILED: list[str] = []


def call(method: str, path: str, payload: dict[str, Any] | None = None) -> tuple[int, Any]:
    data = json.dumps(payload).encode() if payload is not None else None
    request = urllib.request.Request(
        f"{BASE}{path}",
        data=data,
        method=method,
        headers={"Content-Type": "application/json"} if data else {},
    )
    try:
        with urllib.request.urlopen(request, timeout=300) as response:
            return response.status, json.loads(response.read().decode())
    except urllib.error.HTTPError as exc:
        return exc.code, json.loads(exc.read().decode())


def check(name: str, condition: bool, detail: str = "") -> None:
    if condition:
        PASSED.append(name)
        print(f"  PASS  {name}")
    else:
        FAILED.append(name)
        print(f"  FAIL  {name}  {detail}")


def main() -> None:
    print("=== /health ===")
    status, body = call("GET", "/health")
    check("health 200", status == 200, str(body)[:200])
    check("graph has 895 drugs", body.get("stats", {}).get("label_counts", {}).get("Drug") == 895)
    check(
        "graph has ~211k edges",
        body.get("stats", {}).get("relationship_count", 0) > 200_000,
    )

    print("\n=== /resolve: name -> identifier ===")
    status, body = call("POST", "/resolve", {"name": "Paroxetine"})
    check("resolve 200", status == 200, str(body)[:200])
    check("resolve finds Paroxetine", body.get("match_count") == 1, str(body)[:200])
    paroxetine_key = None
    if body.get("matches"):
        paroxetine_key = body["matches"][0]["key"]
        check("resolved key is DB00715", paroxetine_key == "DB00715", str(paroxetine_key))
        check("resolved type is Drug", body["matches"][0]["type"] == "Drug")

    print("\n=== /resolve: a name that is NOT unique ===")
    status, body = call("POST", "/resolve", {"name": "Beta-lactamase"})
    check("ambiguous name reports >1 match", body.get("match_count", 0) > 1, str(body)[:200])
    check("ambiguous flag is set", body.get("ambiguous") is True)
    if body.get("matches"):
        species = {m["properties"].get("species") for m in body["matches"]}
        print(f"        {body['match_count']} matches across species={species}")

    print("\n=== /reason over the real graph, with labels ===")
    # `/reason` now applies a shipped Cypher rule chosen by intent; the caller
    # no longer supplies a Datalog rule. `interaction` maps to the
    # inhibitor/substrate rule, which is the same shape the old
    # `shares_enzyme` example had.
    request = {
        "load_from_graph": True,
        "limit": 5000,
        "intent": "interaction",
        "scope": {"drug_names": ["Warfarin"]},
    }
    started = time.perf_counter()
    status, body = call("POST", "/reason", request)
    elapsed = (time.perf_counter() - started) * 1000
    check("reason 200", status == 200, str(body)[:300])
    facts = body.get("derived", [])
    labels = body.get("labels", {})
    print(f"        {len(facts)} facts over the exported graph in {elapsed:.0f} ms")
    check("reason returns facts", len(facts) > 0)
    check("reason returns a label table", len(labels) > 0, f"{len(labels)} labels")

    # The whole point: can a caller turn a derived term into a name? The
    # conclusion rows already carry the identifiers as separate fields, so they
    # are read directly rather than parsed back out of the rendered fact string.
    conclusions = body.get("conclusions") or []
    derived = [row for row in conclusions if row.get("verifiability") == "derived"]
    check("conclusions are marked derived", len(derived) > 0, f"{len(derived)} derived")
    print(f"        {len(derived)} derived conclusions")

    unresolved = 0
    sample_lines = []
    for row in derived[:5]:
        a, b = row["subject"], row["object"]
        name_a = labels.get(a, f"<no label for {a}>")
        name_b = labels.get(b, f"<no label for {b}>")
        sample_lines.append(f"        {row['fact']}  ->  {name_a}  ×  {name_b}")
    for row in derived:
        if row["subject"] not in labels or row["object"] not in labels:
            unresolved += 1
    for line in sample_lines:
        print(line)
    check(
        f"every derived term resolves to a name ({len(derived)} conclusions)",
        unresolved == 0,
        f"{unresolved} unresolved",
    )

    # Every conclusion must be citable: a conclusion whose premise carries no
    # provenance id cannot be checked by the reader, and saying so is the point.
    uncited = [row for row in derived if row.get("uncited_premises")]
    check("every conclusion carries its premise provenance", not uncited, f"{uncited[:2]}")

    print("\n=== does the self-interaction guard hold? ===")
    self_pairs = [row["fact"] for row in derived if row["subject"] == row["object"]]
    check("no self-pairs survive the inequality filter", len(self_pairs) == 0, str(self_pairs[:3]))

    print("\n=== /schema ===")
    status, body = call("GET", "/schema")
    check("schema 200", status == 200)
    check("schema lists SUBCLASS_OF", "SUBCLASS_OF" in str(body))

    print("\n" + "=" * 60)
    print(f"passed {len(PASSED)}, failed {len(FAILED)}")
    if FAILED:
        print("FAILURES:")
        for name in FAILED:
            print(f"  - {name}")


if __name__ == "__main__":
    main()
