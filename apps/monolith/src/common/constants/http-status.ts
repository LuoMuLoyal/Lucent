/**
 * HTTP status codes used for classification rather than for responding.
 *
 * Two upstream clients (the LightRAG sidecar and the Semantica sidecar) and the
 * LLM provider classifier all bucket failures by status, and each had grown its
 * own private `const HTTP_STATUS_*` block — with slightly different sets. Adding
 * a category, or deciding that one status means something new, then meant
 * editing every copy and noticing the ones that were missed. The names live here
 * once.
 *
 * Codes are spelled out by name because the classifier reads better as
 * `status === HTTP_STATUS_TOO_MANY_REQUESTS` than as `status === 429`, and
 * because a bare literal in a comparison is not greppable.
 */

export const HTTP_STATUS_BAD_REQUEST = 400;

export const HTTP_STATUS_UNAUTHORIZED = 401;

export const HTTP_STATUS_FORBIDDEN = 403;

export const HTTP_STATUS_NOT_FOUND = 404;

export const HTTP_STATUS_REQUEST_TIMEOUT = 408;

export const HTTP_STATUS_UNPROCESSABLE_ENTITY = 422;

export const HTTP_STATUS_TOO_MANY_REQUESTS = 429;

/** Start of the server-error range: a broken upstream, not a rejected request. */
export const HTTP_STATUS_INTERNAL_SERVER_ERROR = 500;

export const HTTP_STATUS_GATEWAY_TIMEOUT = 504;
