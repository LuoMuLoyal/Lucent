"""Sanity-check the exported JSONL before loading it into AGE."""

from __future__ import annotations

import json
from collections import Counter
from pathlib import Path
from typing import Any

DATA = Path(__file__).resolve().parent.parent / "data"


def load(name: str) -> list[dict[str, Any]]:
    path = DATA / name
    with path.open(encoding="utf-8") as handle:
        return [json.loads(line) for line in handle if line.strip()]


def main() -> None:
    drugs = load("drugs.jsonl")
    targets = load("targets.jsonl")
    atc = load("atc_nodes.jsonl")
    e_dt = load("edges_drug_target.jsonl")
    e_dd = load("edges_drug_drug.jsonl")
    e_da = load("edges_drug_atc.jsonl")

    drug_ids = {d["id"] for d in drugs}
    target_ids = {t["id"] for t in targets}
    atc_ids = {a["code"] for a in atc}

    print("== node ids ==")
    print(f"  drugs    {len(drugs):>7}  unique {len(drug_ids)}")
    print(f"  targets  {len(targets):>7}  unique {len(target_ids)}")
    print(f"  atc      {len(atc):>7}  unique {len(atc_ids)}")

    print("\n== duplicate names (the display question) ==")
    dn = Counter(d["name"] for d in drugs)
    print(f"  drug names: {len(dn)} distinct, {sum(1 for c in dn.values() if c > 1)} dup groups")
    for n, c in dn.most_common(5):
        if c > 1:
            print(f"    {n!r} x{c}")
    tn = Counter(t["name"] for t in targets)
    dups = [(n, c) for n, c in tn.items() if c > 1]
    print(f"  target names: {len(tn)} distinct, {len(dups)} dup groups")
    for n, c in sorted(dups, key=lambda kv: -kv[1])[:10]:
        print(f"    {n!r} x{c}")

    print("\n== case-insensitive drug name collisions ==")
    cn = Counter(d["name"].casefold() for d in drugs)
    ci = [(n, c) for n, c in cn.items() if c > 1]
    print(f"  groups differing only by case: {len(ci)}")
    for n, c in ci[:10]:
        print(f"    {n!r} x{c}")

    print("\n== edge referential integrity ==")
    bad = [e for e in e_dt if e["source"] not in drug_ids or e["target"] not in target_ids]
    print(f"  drug->target edges with a dangling endpoint: {len(bad)}")
    for e in bad[:5]:
        print(
            f"    {e['source']} -> {e['target']}"
            f" (src ok={e['source'] in drug_ids}, dst ok={e['target'] in target_ids})"
        )
    bad_dd = [e for e in e_dd if e["source"] not in drug_ids or e["target"] not in drug_ids]
    print(f"  drug->drug edges with a dangling endpoint: {len(bad_dd)}")
    for e in bad_dd[:5]:
        print(f"    {e['source']} -> {e['target']}")
    bad_da = [e for e in e_da if e["source"] not in drug_ids or e["target"] not in atc_ids]
    print(f"  drug->atc edges with a dangling endpoint: {len(bad_da)}")
    for e in bad_da[:5]:
        print(f"    {e['source']} -> {e['target']}")

    print("\n== atc edge coverage ==")
    covered = {e["source"] for e in e_da}
    print(f"  drugs with >=1 ATC edge: {len(covered)} / {len(drugs)}")
    no_atc = [d["id"] for d in drugs if d["id"] not in covered]
    print(f"  drugs with no ATC edge: {len(no_atc)}")
    multi = Counter(e["source"] for e in e_da)
    print(f"  max ATC codes on one drug: {max(multi.values()) if multi else 0}")
    print(f"  avg ATC codes per covered drug: {sum(multi.values()) / len(multi):.2f}")

    print("\n== does any drug carry a code matching the scope? ==")
    # Independent of the export, count how many selected drugs really have an
    # ATC code at all -- this is the number the drug->atc edge count must equal.
    with_atc = [d for d in drugs if d.get("atc_codes")]
    print(f"  drugs whose atc_codes is non-empty: {len(with_atc)}")
    total_codes = sum(len(d["atc_codes"]) for d in with_atc)
    print(f"  total codes across those drugs: {total_codes}")

    print("\n== action verbs in this subgraph ==")
    verbs: Counter[str] = Counter()
    for e in e_dt:
        for a in e.get("actions") or []:
            verbs[a] += 1
    for v, c in verbs.most_common(30):
        print(f"  {v}: {c}")

    print("\n== relation_kind ==")
    for k, c in Counter(e["relation_kind"] for e in e_dt).most_common():
        print(f"  {k}: {c}")

    print("\n== drug->drug edge symmetry ==")
    pairs = {(e["source"], e["target"]) for e in e_dd}
    both = sum(1 for s, t in pairs if (t, s) in pairs)
    print(f"  directed pairs: {len(pairs)}  with a reverse present: {both}")
    desc = sum(1 for e in e_dd if e.get("description"))
    print(f"  edges carrying a description: {desc}")

    print("\n== top hub targets ==")
    deg = Counter(e["target"] for e in e_dt)
    tname = {t["id"]: t["name"] for t in targets}
    for tid, c in deg.most_common(12):
        print(f"  {c:5d}  {tname.get(tid, tid)}")


if __name__ == "__main__":
    main()
