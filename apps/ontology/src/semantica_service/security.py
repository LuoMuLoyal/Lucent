"""Bearer-token authentication.

The service holds one shared token rather than per-caller identities: the only
caller is Lucent, and a second identity would not buy an authorization decision
that anything here makes. What the token buys is that reaching the port is no
longer the same as being allowed to use it — ``/query`` runs read-only Cypher on
the caller's behalf.

Enforced as a FastAPI dependency on each router rather than as middleware, so:

- ``/health`` can stay open (the compose healthcheck and any load balancer need
  it, and neither can carry a credential) without a path allowlist that would
  silently stop matching if the route were renamed;
- the generated OpenAPI schema advertises the security scheme instead of leaving
  callers to discover it from a 401.

``security.py`` rather than ``auth.py``: this module never authenticates a
*person*, and the name should not imply it does.
"""

from __future__ import annotations

import secrets

from fastapi import Depends, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

# ``auto_error=False`` so a missing header reaches our own check: FastAPI's
# built-in error is a 403 with a plain string detail, which would look to the
# Lucent client like an authorization decision rather than a missing credential,
# and would not match the structured error body the other routes use.
_bearer_scheme = HTTPBearer(auto_error=False)

# The error body mirrors the shape the reasoning routes already return
# (``{"detail": {"kind", "message"}}``): Lucent branches on ``kind``, and a bare
# string here would make the one *transport* failure the only one it cannot
# classify.
_UNAUTHORIZED_DETAIL = {
    "kind": "unauthorized",
    "message": "A valid bearer token is required.",
}


def require_api_token(
    request: Request,
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer_scheme),
) -> None:
    """Reject the request unless it carries the configured bearer token.

    The comparison is constant-time: a token is a secret, and ``==`` on strings
    leaks its prefix through timing. The expected value is read from the app's
    settings rather than from a module global so a test can supply its own.
    """
    expected: str = request.app.state.settings.api_token
    presented = credentials.credentials if credentials is not None else ""

    if not presented or not secrets.compare_digest(presented, expected):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=_UNAUTHORIZED_DETAIL,
            # RFC 6750: a 401 on a bearer-protected resource must say which
            # scheme to use, otherwise the client cannot tell whether to
            # retry with a token or give up.
            headers={"WWW-Authenticate": "Bearer"},
        )
