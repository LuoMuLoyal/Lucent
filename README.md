# semantica-service

English-side OAG sidecar: an HTTP wrapper over Apache AGE that exposes
ontology-grounded reasoning to Lucent.

The graph itself is built deterministically from DrugBank's structured fields —
no LLM extraction happens here. This service validates and executes Cypher that
Lucent generated, and it runs ontology (SHACL) checks and Datalog inference over
the graph. It therefore holds **no LLM credentials**.

## Status

Working locally against a real AGE database (3,278 nodes / 211,630 edges):
connection pool, `/health`, `/schema`, `/query`, `/validate`, `/reason`,
`/rules` and `/provenance`. Wired into Lucent (assistant tool
`reason_over_ontology`); not yet deployed as a container image.
See `docs/VERIFICATION.md` for measured results and known gaps.

Two graph-data gaps are handled rather than inherited, and both were measured
before being fixed:

- **Interactions were stored one-directionally.** Only 4,218 of 19,842 source
  rows named a drug in the source column, so 80 of the graph's 895 drugs never
  appear as a source — warfarin among them, with 0 outgoing edges and 530
  incoming. An outgoing-only traversal therefore answered "warfarin interacts
  with nothing". The export now mirrors symmetric relations and records the
  original direction as metadata.
- **SHACL validation could pass vacuously.** A shape in the wrong namespace
  selects no targets and is reported as conforming. `/validate` now refuses such
  shapes instead.

## Requirements

- Python 3.13 — not 3.14. `gensim`, a base dependency of semantica, publishes
  no cp314 wheel, so pip falls back to a source build that needs a C compiler.
- [uv](https://docs.astral.sh/uv/)

## Setup

```bash
uv sync
cp .env.example .env   # then edit
```

`semantica` is installed from the fork's `main` branch rather than PyPI: the
released 0.6.8 lags main by 127 commits and predates every fork fix. The source
is declared in `pyproject.toml` under `[tool.uv.sources]`.

## Running

```bash
uv run uvicorn semantica_service.main:app --reload --port 8099
```

| Route | Purpose |
| --- | --- |
| `GET /health` | Liveness, AGE reachability and graph size |
| `GET /schema` | Node labels and relationship types, with counts |
| `POST /query` | Execute one read-only Cypher statement |
| `POST /validate` | SHACL validation of the graph |
| `POST /reason` | Datalog inference over the graph |
| `GET /rules` | The versioned rule library, so a caller can discover intents |
| `GET /openapi.json` | Schema, used to generate the Lucent client |

`/health` returns **503** when the graph is unreachable, so a load balancer
stops routing to a process whose dependency is down. With no AGE database
running, a 503 naming a connection error is the expected response.

### /query

The generation half of this loop is Lucent's: it turns a question into Cypher
with its own model. This endpoint is the other half — it decides whether the
statement is safe to run, runs it, and reports any failure in a shape the caller
can hand straight back to its model for a retry. The service holds no LLM
credentials and never rewrites the statement.

```jsonc
// request
{
  "cypher": "MATCH (d:Drug)-[r:INTERACTS_WITH]->(o:Drug) WHERE toLower(d.name) = $name RETURN o.name AS name, r.prov AS prov LIMIT 20",
  "params": {"name": "warfarin"},
  "limit": 100
}

// 200
{
  "columns": ["name", "prov"],
  "rows": [{"name": "Ibuprofen", "prov": "lucent:drugbank_drugs/DB00682/drug_interactions/DB00218"}],
  "row_count": 1,
  "truncated": false,
  "elapsed_ms": 42,
  "provenance": [
    {
      "id": "lucent:drugbank_drugs/DB00682/drug_interactions/DB00218",
      "entity_type": "graph_assertion",
      "source_document": "lucent.drugbank_drugs.drug_interactions",
      "source_location": "drugbank_id=DB00682, drugbankId=DB00218",
      "source_quote": "Ibuprofen may increase the anticoagulant activities of Warfarin.",
      "activity_id": "lucent:ingest/drugbank_xml@2026-03-05",
      "agent_id": "drugbank:full database.xml@2026-03-05",
      "confidence": 1.0,
      "sequence_id": 188106,
      "checksum": "480c4019…",
      "parent_entity_id": null,
      "metadata": {"edge_type": "INTERACTS_WITH"}
    }
  ],
  "provenance_missing": [],
  "provenance_truncated": false,
  "provenance_error": null
}
```

`params` is an object of scalars (string, number, boolean) substituted for
`$name` placeholders; `limit` is 1..500 and defaults to 100. The statement is
executed **as written** — this service does not inject a LIMIT into someone
else's Cypher — so `limit` bounds the response, not the work: a statement whose
own `LIMIT` is larger than the request's can still make the database produce
every matching row, and the connection's `statement_timeout` (15 s by default)
is what stops it running forever. When the statement produced more rows than
`limit`, the first `limit` come back and `truncated` is `true`. Rows are
JSON-normalised: anything AGE returns that is not a JSON scalar, list or object
(a temporal value, a path, a custom type) is stringified rather than dropped.

**Citations.** Every edge of this graph carries a `prov` property naming the
source row it came from, so a statement that returns it (`r.prov AS prov`, or
`r` wholesale) gets its evidence resolved alongside its rows: `provenance` holds
one entry per id, `provenance_missing` names ids the store does not hold,
`provenance_truncated` says the cap (`provenance_limit`, default 100) cut the
list, and `provenance_error` is set when the store could not be read at all —
a different answer from "nothing was recorded". Set `include_provenance: false`
to skip the lookup.

**The read-only guard.** A statement is refused unless it is one statement that
begins with `MATCH`, `OPTIONAL`, `WITH`, `UNWIND` or `RETURN`. A keyword scan
runs over the statement with string literals, quoted identifiers and comments
blanked out first, so `RETURN 'delete this' AS note` is a projection and a
`DELETE` mentioned in a trailing comment is not a clause. The refused words are
`CREATE`, `MERGE`, `SET`, `DELETE`, `DETACH`, `REMOVE`, `DROP`, `CALL`, `COPY`,
`GRANT`, `REVOKE`, `ALTER`, `TRUNCATE`, `LOAD` and `VACUUM`. A `;`-separated
second statement is refused as `multiple_statements` (the more specific
diagnosis); a single trailing `;` is allowed and stripped before execution. The
guard is deliberately a scanner rather than a parser: an unclosed literal blinds
it past that point, and AGE's own parser then reports the syntax error.

**Failures.** A refusal is `422` with the submitted statement echoed back:

```jsonc
{
  "detail": {
    "kind": "unsupported_feature",
    "message": "AGE has no shortestPath; write an explicit typed multi-hop pattern instead",
    "cypher": "MATCH (a), (b) RETURN shortestPath((a)-[*]->(b))"
  }
}
```

`kind` is one of exactly six values, and each is meant to be actionable without
reading this service's source:

| `kind` | Meaning | Retry |
| --- | --- | --- |
| `not_read_only` | A write/admin clause, or the statement does not begin with a read-only clause | Rewrite as a projection |
| `multiple_statements` | More than one statement (only one trailing `;` is allowed) | Send one statement |
| `unsupported_feature` | A construct AGE 1.7 does not implement (`shortestPath` / `allShortestPaths`, multi-type edges like `[r:A\|B]`, `datetime()`) | Use the alternative named in `message` |
| `syntax_error` | AGE rejected the Cypher's syntax | Fix the statement against `/schema` |
| `timeout` | Cancelled by `statement_timeout` | Narrow the pattern, or add a `LIMIT` |
| `internal` | Anything else, including a lost connection | Retry, or report the fault |

`internal` carries the exception's own message but never a stack trace, and
credential-shaped text is redacted. A missing, blank or oversized `cypher`, a
`limit` outside 1..500 and a malformed body are ordinary FastAPI 422s — they
never became a statement, so they get no `kind`.

### /provenance

Resolves the ids a `/query` returned into the rows they came from. A citation
is only worth something if it can be checked, so this endpoint is the check: it
returns the source table, the source row key and the source's own text, plus the
import activity and the entry's position in the hash chain.

```jsonc
// request — lineage also returns each id's ancestors (for a verb edge, its source row)
{"ids": ["lucent:drugbank_drug_targets/DB00682/…/enzyme/SUBSTRATE_OF"], "lineage": true}

// 200
{
  "records": [{"id": "lucent:…", "entity_type": "graph_assertion", "source_document": "lucent.drugbank_drug_targets", "source_location": "drugbank_id=DB00682, target_id=…, relation_kind=enzyme", "source_quote": "SUBSTRATE_OF recognised from actions=['substrate']", "sequence_id": 219999, "checksum": "…"}],
  "missing": [],
  "lineage": [{"id": "lucent:drugbank_drug_targets/DB00682/…/enzyme", "entity_type": "source_row"}],
  "chain": {"available": true, "valid": true, "total_entries": 220011, "broken_links": []},
  "provo": null
}
```

`format` renders the same records as W3C PROV-O instead of this service's JSON:
`records` (default), `jsonld` or `turtle`. The rendering models the assertion as
a `prov:Entity` generated by the import `prov:Activity`, attributed to the
source dataset and derived from the source row — the row being an entity in its
own right, which is what makes `lineage` and the RDF say the same thing.

`GET /provenance/verify` returns just the chain report. Each entry's checksum
covers its predecessor's, so a row deleted or edited after the import breaks the
chain at that point and appears in `broken_links`: the audit trail is
tamper-evident rather than append-only by convention.

The store is written once, at import time, by `scripts/add_edge_provenance.py`,
which writes the ids onto the edges (one Cypher statement per relationship type)
and records one hash-chained entry per edge, per multi-verb source row and per
ingest activity in the Postgres table named by `PROVENANCE_TABLE` (default
`semantica_provenance`, in Lucent's database so audit rows sit beside Lucent's
own `audit_logs`). Re-running is a no-op for ids already present, `--reset`
rebuilds from scratch, and `--verify` checks that the graph's ids and the store
agree in both directions and that the chain is intact.

### /reason

Facts come from the request, or from the graph when `load_from_graph` is set.
Rules use semantica's textual Datalog syntax, including inequalities:

```jsonc
{
  "load_from_graph": true,
  "scope": {"drug_names": ["warfarin"]},
  "intent": "interaction",
  "query": "potential_ddi(db00682, ?Y)"
}
```

Facts are keyed by each node's canonical identifier (`drugbank_id`,
`uniprot_id`), not AGE's row id — row ids would make every derived fact read
`potential_ddi(844424930131970, ...)`. `add_fact` lowercases constants, so
results are ids rather than display names; `labels` maps them back.

**A graph-backed run must state its scope.** Supply `scope` (drug names, ATC
prefixes) or `scope_all: true`; neither is a 422. Datalog has no negation, so
"not derived" is its only answer for "not present" — and that answer carries
information only if the caller knows what was loaded. The response echoes the
extent it reached in `range` (`node_count`, `edge_count`, `truncated`, `limit`),
and a scope that matches nothing is refused rather than answered, so a typo'd
drug name cannot come back as a clean negative finding.

**Naming a rule instead of sending one.** `intent` or `rule_id` selects a rule
from the versioned library in `rules/reasoning.yaml` (list them with `GET
/rules`). The response then carries `rule` and a `conclusions` list: one entry
per fact the rule's own head predicate produced, each with
`verifiability: "derived"`, the `rule_id`, and the premises it rests on.

```jsonc
"conclusions": [
  {
    "fact": "potential_ddi(db00091, db00208)",
    "subject": "db00091",
    "predicate": "potential_ddi",
    "object": "db00208",
    "rule_id": "potential_ddi_inhibitor_substrate",
    "verifiability": "derived",          // never presented as an assertion
    "citations": ["lucent:drugbank_drugs/DB00091/…/enzyme/INHIBITS"],
    "uncited_premises": ["substrate_of(db00208, p10635)"]
  }
]
```

Only the rule's head becomes a conclusion: `derive_all` returns the whole fact
base, and reporting every fact would present the premises as findings. Each
premise is resolved through `fact_assertions` to the `prov` id of the edge that
asserts it; a premise with no id moves to `uncited_premises` rather than being
dropped, because a conclusion resting partly on uncitable evidence is still a
conclusion and hiding that would overstate it. `conclusions_complete` is `false`
when premise recovery stopped before covering every conclusion — a conclusion
with no citations then means "not looked up yet", not "rests on nothing".

Rule text sent in `rules` is still accepted and still derives facts, but it
produces no attributed conclusions: a fact can only be cited to a reviewed rule,
and an inline rule has no id to cite.

### /validate

Supply **exactly one** of `shacl` (Turtle shapes) or `ontology` (shapes are
derived from it); semantica rejects both-or-neither, surfaced here as 422. The
graph is exported from AGE as Turtle first, so a graph with no nodes returns
422 rather than the vacuous "conforms".

**Shapes must be able to select targets in this graph.** A shape whose terms
resolve to a namespace the data does not use selects nothing, constrains
nothing, and is reported as conforming — a clean pass from a check that never
ran. Measured on the live graph with a shape requiring a property that does not
exist: **895 violations** in the correct namespace
(`http://lucent.local/graph#`), **conforms** in any other. So a shape is refused
(422) when the graph's prefix is bound to a different IRI, or when no term in it
falls in the graph's namespace at all. `ontology` validation is not gated: an
ontology carries its own terms, so there is no prefix to get wrong.


## Development

```bash
uv run pytest            # tests
uv run ruff check .      # lint
uv run ruff format .     # format
uv run mypy src tests    # types
```

## Design constraints

Three constraints shape the code and should not be relaxed:

1. **Every handler is a synchronous `def`.** `psycopg2`, the Datalog fixpoint
   and pyshacl are blocking or CPU-bound. FastAPI runs synchronous handlers in
   a thread pool; an `async def` handler would put that work on the event loop
   and stall every concurrent request.
2. **Requests borrow a connection; there is no global store.** A single shared
   `ApacheAgeStore` holds one connection and measured 2.9x slower at 16
   concurrent callers.
3. **A graph read is reproducible or it is not trusted.** Every exported query
   orders before it limits: `LIMIT` without `ORDER BY` is a random sample, not a
   prefix, so two identical requests would load different edges and an empty
   derivation would mean nothing. Paging advances by growing the `LIMIT` rather
   than using `OFFSET`, which would make each page scan further than the last.

Every pooled connection carries a `statement_timeout`. A variable-length Cypher
path on a dense graph can otherwise run for minutes.

## Operations

**Retry.** Graph reads are retried on failures classified as transient (a
dropped connection, a pooler restart) and raised immediately on failures that
will repeat identically (a syntax error, a cancelled statement, a missing
graph). Retrying is safe because the reads are idempotent — ordered
`MATCH ... RETURN` only — not because optimism is warranted; retrying a
deterministic failure would spend the caller's budget to arrive at the same
error, later, while hiding it behind a longer wait.

**Logging.** `LOG_FORMAT=json` (default) emits one JSON object per line with the
event name in `event` and its values as fields; `LOG_FORMAT=text` renders the
same fields for a human. The numbers are the point: whether a scope was
truncated and how many facts a fixpoint produced are what decide whether an
answer means anything, and they are useless buried in prose. Two lines answer
the question that matters — was that empty result a finding or an empty input:

```json
{"event": "export_loaded", "scope": "explicit", "nodes": 541, "edges": 33350, "truncated": true}
{"event": "reason_finished", "facts": 78159, "conclusions": 27683, "rule": "potential_ddi_inhibitor_substrate"}
```

**Verification scripts.** Each asserts a property that cannot be checked without
a real database, and each prints what it measured:

```bash
uv run python scripts/check_reason_range.py    # determinism, scope, truncation, ceilings
uv run python scripts/check_reason_rule.py     # conclusion -> premise -> prov citation chain
uv run python scripts/check_shapes.py          # a shape really constrains the graph
uv run python scripts/check_transport.py       # retry recovers; counts in logs are real
uv run python scripts/check_orientation.py     # no interaction is one-directional
```

## Settings

| Variable | Default | Purpose |
| --- | --- | --- |
| `AGE_DSN` | local dev | libpq string for the AGE database |
| `GRAPH_NAME` | `lucent_graph` | AGE graph to read |
| `STATEMENT_TIMEOUT_MS` | `15000` | Per-statement ceiling, asserted on every connection |
| `MAX_REASONING_FACTS` | `50000` | Refuses a fixpoint larger than this |
| `REASONING_TIMEOUT_S` | `30` | Wall-clock ceiling on the fixpoint |
| `RULES_DIR` | *(shipped)* | Mount a reviewed rule set without rebuilding the image |
| `LOG_LEVEL` | `INFO` | Root log level |
| `LOG_FORMAT` | `json` | `json` or `text` |

## Layout

```
src/semantica_service/
├── main.py          application factory and lifespan
├── config.py        environment-backed settings
├── logging_setup.py structured logging (JSON / text)
├── reasoning_limits.py  fact and wall-clock ceilings
├── graph/           AGE connection pool, scoped export, retry, shapes, orientation
├── reasoning/       the versioned rule library and premise recovery
├── provenance/      provenance ids, citation lookup, PROV-O rendering
└── routes/          HTTP endpoints

rules/reasoning.yaml the versioned rule library
scripts/check_*.py   verifications that need a real database
```
