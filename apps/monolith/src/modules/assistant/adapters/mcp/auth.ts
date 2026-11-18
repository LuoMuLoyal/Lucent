/**
 * Caller authentication for the MCP endpoint.
 *
 * ## What this protects
 *
 * The exposed tools read no user data, so this is not a row-level filter. It is
 * the spec's §Security Warning item 3 — *every connection must be
 * authenticated* — and its purpose here is narrower and honest:
 *
 * - a caller that cannot prove who it is must not be able to consume a
 *   knowledge-base query (the retrievals cost real sidecar and LLM work);
 * - every call is attributable in the logs.
 *
 * ## Why a bearer token and not the existing session cookie
 *
 * The MCP endpoint is machine-to-machine. A browser session cookie would mean
 * the endpoint is only usable by a logged-in browser, and it would put a
 * cookie-authenticated surface next to a JSON-RPC handler that accepts
 * arbitrary tool names. A dedicated bearer token keeps the two identities
 * separate: revoking the MCP token cannot log a user out, and vice versa.
 *
 * ## Why it does not reuse `SEMANTICA_API_KEY`
 *
 * That shared token protects the Semantica sidecar and is already flagged in
 * `docs/TODO.md` for having no TLS on its channel. Adding a second consumer
 * would multiply the blast radius of the same weak secret.
 */
import type { IncomingMessage } from 'node:http';
import { randomUUID } from 'node:crypto';
import type { McpCallerIdentity } from '../../application/ports/mcp.js';
import { EnvKey } from '../../../../config/env/env-keys.enum.js';

/** Environment key carrying the bearer token. Absent means "no auth required". */
export const MCP_API_KEY_ENV = EnvKey.MCP_API_KEY;

/**
 * Resolves the caller from the request.
 *
 * Returns `null` when authentication fails. When `MCP_API_KEY` is unset the
 * endpoint runs unauthenticated **and says so once at startup** (see
 * `mcp.module.ts`): a silent no-auth mode is how an internal endpoint ends up on
 * a public listener without anyone noticing.
 */
export function createMcpAuthenticator(options: {
  /** The configured token, or `undefined` to run without auth. */
  expectedToken: string | undefined;
}): (request: IncomingMessage) => Promise<McpCallerIdentity | null> {
  const { expectedToken } = options;

  return (request) => {
    const requestId = randomUUID();

    if (expectedToken == null || expectedToken.length === 0) {
      return Promise.resolve({ subject: 'anonymous', requestId });
    }

    // `IncomingMessage['headers']` types as `any` in the Node typings, so the
    // shape is asserted here the same way the rest of the codebase reads raw
    // request headers (see `testing-shared-secret.guard.ts`).
    const headers = request.headers as Record<
      string,
      string | string[] | undefined
    >;
    const header = headers['authorization'];
    const raw = Array.isArray(header) ? header[0] : header;
    if (raw == null || !raw.startsWith('Bearer ')) {
      return Promise.resolve(null);
    }

    const provided = raw.slice('Bearer '.length).trim();
    // Constant-time comparison is the standard guard against token guessing by
    // timing. `timingSafeEqual` needs equal lengths, so length is compared first
    // — and that early return is itself not a meaningful timing oracle, because
    // the length of a secret is not secret.
    if (
      provided.length !== expectedToken.length ||
      !timingSafeEqualStrings(provided, expectedToken)
    ) {
      return Promise.resolve(null);
    }

    return Promise.resolve({ subject: 'mcp-client', requestId });
  };
}

/** Constant-time string comparison without pulling in a crypto dependency chain. */
function timingSafeEqualStrings(left: string, right: string): boolean {
  let mismatch = 0;
  for (let index = 0; index < left.length; index += 1) {
    mismatch |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return mismatch === 0;
}
