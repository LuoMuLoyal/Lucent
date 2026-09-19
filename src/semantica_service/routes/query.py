"""POST /query — execute a caller-generated, read-only Cypher statement.

Lucent turns natural language into Cypher with its own model; this endpoint is
the "validate and execute" half of that loop. It refuses anything that is not a
single read-only statement (see :mod:`semantica_service.cypher`), runs the rest
on a pooled connection whose ``statement_timeout`` bounds the database work, and
reports failures as one of a fixed set of error kinds so the caller can hand an
actionable message back to its model for a retry.

The statement is executed as written — it is never rewritten — so ``limit``
bounds the *response*, not the work. A statement with no LIMIT of its own can
still make the database produce every matching row; ``statement_timeout`` is
what stops it from doing so forever.

The handler is a plain ``def``: psycopg2 is blocking and FastAPI runs
synchronous handlers in its thread pool, so an ``async def`` here would stall
every concurrent request.
"""

from __future__ import annotations

import math
import time
from typing import Any

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import JSONResponse

from ..cypher import (
    QueryErrorKind,
    check_read_only,
    classify_error,
    classify_message,
    normalize_statement,
)
from ..graph import StorePool
from .schemas import QueryRequest, QueryResponse

router = APIRouter(tags=["query"])


def _json_safe(value: Any) -> Any:
    """Make an AGE value safe for ``json.dumps``.

    AGE returns agtype, which the store parses into Python objects; a path or a
    vertex can therefore carry something a JSON encoder refuses (a temporal
    object, a custom class, bytes). Anything that is not a JSON scalar, list or
    object is stringified rather than dropped, so a caller still sees that a
    value existed.
    """
    if value is None or isinstance(value, (bool, int, str)):
        return value
    if isinstance(value, float):
        # NaN and infinity are floats but not JSON; Starlette's encoder refuses them.
        return value if math.isfinite(value) else str(value)
    if isinstance(value, dict):
        return {str(key): _json_safe(item) for key, item in value.items()}
    if isinstance(value, (list, tuple, set, frozenset)):
        return [_json_safe(item) for item in value]
    return str(value)


def _columns(keys: Any, rows: list[dict[str, Any]]) -> list[str]:
    """Column names: AGE's own keys, or the row keys when it reported none."""
    if isinstance(keys, (list, tuple)) and keys:
        return [str(key) for key in keys]
    seen: dict[str, None] = {}
    for row in rows:
        for key in row:
            seen.setdefault(key, None)
    return list(seen)


def _refusal(kind: QueryErrorKind, message: str, cypher: str) -> HTTPException:
    """Build the 422 a caller can feed back to its model.

    The submitted Cypher is echoed so the retry prompt can quote the exact
    statement that was refused, rather than a copy the caller has to reconstruct.
    """
    return HTTPException(
        status_code=422,
        detail={"kind": kind, "message": message, "cypher": cypher},
    )


@router.post("/query", response_model=QueryResponse)
def query(request: Request, body: QueryRequest) -> JSONResponse:
    """Run one read-only Cypher statement and return its rows.

    Rejections are 422 with ``{"detail": {"kind", "message", "cypher"}}``: the
    caller's model gets a machine-readable kind and a message saying what to
    change. A blank statement, a limit outside 1..500 and a malformed body are
    ordinary request-validation 422s, since they never became a statement.
    """
    if not body.cypher.strip():
        raise HTTPException(status_code=422, detail="cypher must not be blank")

    problem = check_read_only(body.cypher)
    if problem is not None:
        kind, message = problem
        raise _refusal(kind, message, body.cypher)

    pool: StorePool = request.app.state.pool
    started = time.perf_counter()
    try:
        with pool.borrow() as store:
            result = store.execute_query(normalize_statement(body.cypher), body.params)
    except Exception as exc:
        kind, message = classify_error(exc)
        raise _refusal(kind, message, body.cypher) from exc
    elapsed_ms = int((time.perf_counter() - started) * 1000)

    if not result.get("success", True):
        # Defensive: this store reports failures by raising, but a payload that
        # says otherwise must not be returned as if it held rows.
        kind, message = classify_message(str(result.get("error") or "AGE query failed"))
        raise _refusal(kind, message, body.cypher)

    records = result.get("records") or []
    # The statement is not rewritten, so AGE may have produced more rows than
    # the caller asked for; only the first `limit` are handed back.
    truncated = len(records) > body.limit
    rows = [
        {str(key): _json_safe(value) for key, value in record.items()}
        for record in records[: body.limit]
        if isinstance(record, dict)
    ]

    payload = QueryResponse(
        columns=_columns(result.get("keys"), rows),
        rows=rows,
        row_count=len(rows),
        truncated=truncated,
        elapsed_ms=elapsed_ms,
    )
    return JSONResponse(content=payload.model_dump())
