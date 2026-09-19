# semantica-service

English-side OAG sidecar: an HTTP wrapper over Apache AGE that exposes
ontology-grounded reasoning to Lucent.

The graph itself is built deterministically from DrugBank's structured fields —
no LLM extraction happens here. This service validates and executes Cypher that
Lucent generated, and it runs ontology (SHACL) checks and Datalog inference over
the graph. It therefore holds **no LLM credentials**.

## Status

Working locally against a real AGE database: connection pool, `/health`,
`/schema`, `/validate` and `/reason`. Not yet integrated into Lucent, and not
yet deployed. See `docs/VERIFICATION.md` for measured results and known gaps.

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
| `POST /validate` | SHACL validation of the graph |
| `POST /reason` | Datalog inference over the graph |
| `GET /openapi.json` | Schema, used to generate the Lucent client |

`/health` returns **503** when the graph is unreachable, so a load balancer
stops routing to a process whose dependency is down. With no AGE database
running, a 503 naming a connection error is the expected response.

### /reason

Facts come from the request, or from the graph when `load_from_graph` is set.
Rules use semantica's textual Datalog syntax, including inequalities:

```jsonc
{
  "load_from_graph": true,
  "rules": [
    {"rule": "shares_target(X, Y) :- targets(X, P), targets(Y, P), X != Y."}
  ],
  "query": "shares_target(db00945, ?Y)"
}
```

Facts are keyed by each node's canonical identifier (`drugbank_id`,
`uniprot_id`), not AGE's row id — row ids would make every derived fact read
`shares_target(844424930131970, ...)`. `add_fact` lowercases constants, so
results are ids rather than display names.

### /validate

Supply **exactly one** of `shacl` (Turtle shapes) or `ontology` (shapes are
derived from it); semantica rejects both-or-neither, surfaced here as 422. The
graph is exported from AGE as Turtle first, so a graph with no nodes returns
422 rather than the vacuous "conforms".


## Development

```bash
uv run pytest            # tests
uv run ruff check .      # lint
uv run ruff format .     # format
uv run mypy src tests    # types
```

## Design constraints

Two constraints shape the code and should not be relaxed:

1. **Every handler is a synchronous `def`.** `psycopg2`, the Datalog fixpoint
   and pyshacl are blocking or CPU-bound. FastAPI runs synchronous handlers in
   a thread pool; an `async def` handler would put that work on the event loop
   and stall every concurrent request.
2. **Requests borrow a connection; there is no global store.** A single shared
   `ApacheAgeStore` holds one connection and measured 2.9x slower at 16
   concurrent callers.

Every pooled connection carries a `statement_timeout`. A variable-length Cypher
path on a dense graph can otherwise run for minutes.

## Layout

```
src/semantica_service/
├── main.py          application factory and lifespan
├── config.py        environment-backed settings
├── graph/           AGE connection pool
└── routes/          HTTP endpoints
```
