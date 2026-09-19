# semantica-service

English-side OAG sidecar: an HTTP wrapper over Apache AGE that exposes
ontology-grounded reasoning to Lucent.

The graph itself is built deterministically from DrugBank's structured fields —
no LLM extraction happens here. This service validates and executes Cypher that
Lucent generated, and it runs ontology (SHACL) checks and Datalog inference over
the graph. It therefore holds **no LLM credentials**.

## Status

The service skeleton, configuration, AGE connection pool and `/health` are in
place. The reasoning endpoints (`/reason`, `/schema`, `/validate`) are not built
yet.

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
| `GET /openapi.json` | Schema, used to generate the Lucent client |

`/health` returns **503** when the graph is unreachable, so a load balancer
stops routing to a process whose dependency is down. With no AGE database
running, a 503 naming a connection error is the expected response.

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
