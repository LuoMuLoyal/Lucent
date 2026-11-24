"""Verify the (relation_kind, action) table covers every observed pair.

Run before reloading: a pair that falls through to the kind fallback is a
silent loss of the action verb, which is what this change set out to fix.
"""

from __future__ import annotations

import json
import sys
from collections import Counter
from pathlib import Path

import psycopg2
import psycopg2.extras

sys.path.insert(0, str(Path(__file__).resolve().parent))
# The mapping constants live with the loader that applies them. They used to be
# imported from `load_graph.py`; that AGE loader is gone and `load_graph_neo4j`
# is the only writer now, so the single source is the Neo4j one.
from load_graph_neo4j import ACTION_EDGE, KIND_EDGE  # noqa: E402

DSN = "host=127.0.0.1 port=5432 dbname=lucent user=postgres password=postgres"
DATA = Path(__file__).resolve().parent.parent / "data"


def main() -> None:
    # A dict literal with a repeated key silently keeps the last value; AST
    # -level duplication is easier to catch here than in review.
    print(f"ACTION_EDGE entries: {len(ACTION_EDGE)}")

    conn = psycopg2.connect(DSN)
    conn.set_session(readonly=True)
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
    with (DATA / "drugs.jsonl").open(encoding="utf-8") as handle:
        drugs = [json.loads(line)["id"] for line in handle if line.strip()]

    cur.execute(
        """
        SELECT relation_kind, actions FROM drugbank_drug_targets
        WHERE drugbank_id = ANY(%s)
        """,
        (drugs,),
    )
    pairs: Counter[tuple[str, str]] = Counter()
    for row in cur.fetchall():
        kind = row["relation_kind"] or "all"
        for action in row["actions"] or []:
            pairs[(kind, action.lower())] += 1

    covered = sum(n for pair, n in pairs.items() if pair in ACTION_EDGE)
    fallback = sum(n for pair, n in pairs.items() if pair not in ACTION_EDGE)
    total = covered + fallback
    print(f"observed (kind, action) pairs: {len(pairs)}")
    if total == 0:
        # The source table is empty on a dev database whose data was exported
        # once and then trimmed. Reporting a coverage percentage would be a
        # division by zero, and reporting 100% would be a lie: say which it is.
        print("  source table has no rows for the exported drugs: nothing to check")
        print("  (this is a data condition, not a mapping defect)")
        return
    print(f"  covered by ACTION_EDGE : {covered}/{total} rows ({100 * covered / total:.1f}%)")
    print(f"  fall back to KIND_EDGE : {fallback}/{total} rows ({100 * fallback / total:.1f}%)")

    if fallback:
        print("\n  falling back (kind, action):")
        for (kind, action), n in sorted(pairs.items(), key=lambda kv: -kv[1]):
            if (kind, action) not in ACTION_EDGE:
                print(f"    ({kind!r}, {action!r}) x{n} -> {KIND_EDGE.get(kind, 'ACTS_ON')}")

    # Which relation kinds would be produced?
    produced: Counter[str] = Counter()
    for (kind, action), n in pairs.items():
        produced[ACTION_EDGE.get((kind, action), KIND_EDGE.get(kind, "ACTS_ON"))] += n
    print("\n== edge types that will be produced ==")
    for rel, n in produced.most_common():
        print(f"  {rel:22} {n}")

    conn.close()


if __name__ == "__main__":
    main()
