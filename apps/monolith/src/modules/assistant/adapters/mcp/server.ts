/**
 * MCP server over Streamable HTTP.
 *
 * ## Protocol basis
 *
 * Implements the transport from [MCP 2025-06-18 ·
 * Transports](https://modelcontextprotocol.io/specification/2025-06-18/basic/transports)
 * through the official SDK. The spec points that matter here:
 *
 * - **One endpoint** accepts both `POST` (client → server messages) and `GET`
 *   (server → client stream). `DELETE` terminates a session.
 * - **Every POST is a new request**; the body is exactly one JSON-RPC request,
 *   notification or response. Notifications and responses get `202 Accepted`
 *   with no body.
 * - **Session id** travels in `Mcp-Session-Id`. A non-initialization request
 *   without one is `400`; a request carrying an unknown one is `404`.
 * - **`MCP-Protocol-Version`** header is honoured; a missing one falls back to
 *   the SDK default rather than being rejected.
 *
 * ## Security (spec §Security Warning — mandatory, not optional)
 *
 * 1. **`Origin` is validated** on every request. Without it, a remote site can
 *    drive a locally running server through DNS rebinding.
 * 2. **Loopback binding is the caller's job** (see `mcp.routes.ts`): the HTTP
 *    listener is whatever Nest's Fastify instance already binds to, so the
 *    deployment decides — never `0.0.0.0` by default.
 * 3. **Every connection is authenticated** (`auth.ts`); an unauthenticated
 *    request is rejected before it reaches the transport.
 *
 * ## Stateless vs stateful
 *
 * One transport instance per session, tracked in a map keyed by session id. The
 * SDK's stateful mode keeps per-session connection state (SSE streams, pending
 * requests); sharing one transport across sessions would mix them up.
 *
 * ## Why the executor is injected rather than rebuilt
 *
 * Every exposed tool runs through `McpToolExecutionPort`, which the module binds
 * to the same `executeMany` the in-process agent uses. Re-implementing execution
 * here would duplicate the proposal envelopes and the per-tool timeouts, and the
 * copy would drift.
 */
import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import type { Logger } from '@nestjs/common';
import type { McpToolExecutionPort } from '../../application/ports/mcp.js';
import type {
  McpCallerIdentity,
  McpToolCallRequest,
} from '../../application/ports/mcp.js';
import { MCP_TOOL_NAMES } from '../../domain/mcp/exposure.js';
import type { ToolLimitBudgets } from '../acl/tools/shared/tool-definitions.js';
import { buildMcpToolDescriptors } from './tool-schema.js';

/** Response body the spec prescribes for an unknown/expired session. */
const SESSION_NOT_FOUND = {
  jsonrpc: '2.0' as const,
  error: { code: -32001, message: 'Session not found' },
  id: null,
};

/** Response body for a request that carried no session id when one was required. */
const SESSION_REQUIRED = {
  jsonrpc: '2.0' as const,
  error: {
    code: -32000,
    message: 'Bad Request: Mcp-Session-Id header is required',
  },
  id: null,
};

/**
 * HTTP statuses this endpoint returns itself.
 *
 * Named because the JSON-RPC layer's status codes are part of the protocol
 * contract (the spec prescribes 400 / 404 / 202 for specific situations), not
 * incidental numbers — and because a magic-number lint rule is right to object
 * to them inline.
 */
const HTTP_STATUS = {
  ok: 200,
  accepted: 202,
  badRequest: 400,
  unauthorized: 401,
  forbidden: 403,
  notFound: 404,
  methodNotAllowed: 405,
  internalError: 500,
} as const;

/** Everything the server needs from its host. */
export interface McpServerFactoryOptions {
  /** Live tool budgets, so advertised ranges match what the server accepts. */
  budgets: ToolLimitBudgets;
  /** The executor port. In production this wraps the assistant's own executor. */
  executor: McpToolExecutionPort;
  /** Resolves the caller from the request's authorization material. */
  authenticate: (request: IncomingMessage) => Promise<McpCallerIdentity | null>;
  /** Origins permitted to call this endpoint. Empty means "loopback only". */
  allowedOrigins: readonly string[];
  logger: Logger;
}

/** A live MCP session. */
interface McpSession {
  server: McpServer;
  transport: StreamableHTTPServerTransport;
}

/**
 * Owns every MCP session for one process.
 *
 * Registered as a Nest singleton so the transports outlive individual requests —
 * an SSE stream opened by `GET` is tied to the transport, not to that one HTTP
 * call.
 */
export class McpSessionRegistry {
  private readonly sessions = new Map<string, McpSession>();

  constructor(private readonly options: McpServerFactoryOptions) {}

  /**
   * Handles one inbound HTTP request.
   *
   * Returns without writing when the transport owns the response (it streams).
   */
  async handleRequest(
    request: IncomingMessage,
    response: ServerResponse,
    parsedBody?: unknown,
  ): Promise<void> {
    const caller = await this.options.authenticate(request);
    if (caller == null) {
      // Spec §Security Warning item 3: authenticate every connection. Rejecting
      // here keeps unauthenticated traffic out of the JSON-RPC layer entirely.
      writeJson(response, HTTP_STATUS.unauthorized, {
        jsonrpc: '2.0',
        error: { code: -32001, message: 'Unauthorized' },
        id: null,
      });
      return;
    }

    if (!this.isOriginAllowed(request)) {
      // Spec §Security Warning item 1. A missing Origin is allowed: non-browser
      // clients (CLI, another service) do not send one, and rejecting them would
      // break the primary use case this server exists for.
      this.options.logger.warn(
        `MCP request rejected: Origin "${String(request.headers.origin)}" is not allowed.`,
      );
      writeJson(response, HTTP_STATUS.forbidden, {
        jsonrpc: '2.0',
        error: { code: -32001, message: 'Forbidden: origin not allowed' },
        id: null,
      });
      return;
    }

    const sessionId = readSessionId(request);

    if (request.method === 'POST') {
      await this.handlePost(request, response, parsedBody, sessionId, caller);
      return;
    }

    if (request.method === 'GET' || request.method === 'DELETE') {
      const session =
        sessionId != null ? this.sessions.get(sessionId) : undefined;
      if (session == null) {
        writeJson(response, HTTP_STATUS.notFound, SESSION_NOT_FOUND);
        return;
      }
      await session.transport.handleRequest(request, response);
      if (request.method === 'DELETE') {
        // The transport reports the close through `onsessionclosed`, which is
        // where the map entry is dropped; nothing to do here.
      }
      return;
    }

    // Any other verb is outside the transport's contract.
    writeJson(response, HTTP_STATUS.methodNotAllowed, {
      jsonrpc: '2.0',
      error: { code: -32001, message: 'Method Not Allowed' },
      id: null,
    });
  }

  /** Closes every session. Called from `onModuleDestroy`. */
  async closeAll(): Promise<void> {
    for (const [id, session] of this.sessions) {
      await session.transport.close();
      this.sessions.delete(id);
    }
  }

  private async handlePost(
    request: IncomingMessage,
    response: ServerResponse,
    parsedBody: unknown,
    sessionId: string | undefined,
    caller: McpCallerIdentity,
  ): Promise<void> {
    if (sessionId != null) {
      const existing = this.sessions.get(sessionId);
      if (existing == null) {
        writeJson(response, HTTP_STATUS.notFound, SESSION_NOT_FOUND);
        return;
      }
      await existing.transport.handleRequest(request, response, parsedBody);
      return;
    }

    // No session id: only an `initialize` may start one.
    if (!isInitializeRequest(parsedBody)) {
      writeJson(response, HTTP_STATUS.badRequest, SESSION_REQUIRED);
      return;
    }

    const session = await this.createSession(caller);
    await session.transport.handleRequest(request, response, parsedBody);
  }

  private async createSession(caller: McpCallerIdentity): Promise<McpSession> {
    // Built before the transport: `onsessioninitialized` closes over the session
    // value, and it only fires while handling a request — by which time both
    // exist. A mutable holder lets the callbacks see the final pair without
    // making `server` reassignable.
    const session: { current?: McpSession } = {};

    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      onsessioninitialized: (id: string) => {
        if (session.current != null) {
          this.sessions.set(id, session.current);
        }
        this.options.logger.log(`MCP session opened: ${id}`);
      },
      onsessionclosed: (id: string) => {
        this.sessions.delete(id);
        this.options.logger.log(`MCP session closed: ${id}`);
      },
    });

    const server = this.buildServer(caller);
    await server.connect(transport);
    session.current = { server, transport };

    return { server, transport };
  }

  /**
   * Builds one `McpServer` with every exposed tool registered.
   *
   * Registration is **all-or-nothing**: a descriptor that fails to register
   * throws out of `createSession`, so the session is never published. Publishing
   * half a tool set would make `tools/list` disagree with what the server can
   * actually execute, and the client has no way to tell.
   */
  private buildServer(caller: McpCallerIdentity): McpServer {
    const server = new McpServer({ name: 'lucent', version: '1.0.0' });

    const descriptors = buildMcpToolDescriptors({
      toolNames: MCP_TOOL_NAMES,
      budgets: this.options.budgets,
    });

    for (const descriptor of descriptors) {
      server.registerTool(
        descriptor.name,
        {
          title: descriptor.annotations.title,
          description: descriptor.description,
          // The SDK wants a zod *raw shape* (`{ param: z.string() }`), which is
          // what `ZodObject.shape` exposes. The descriptors build a `ZodObject`
          // because the JSON Schema root is always `type: 'object'`.
          inputSchema: (descriptor.inputSchema as z.ZodObject<z.ZodRawShape>)
            .shape,
          annotations: {
            readOnlyHint: descriptor.annotations.readOnlyHint,
            destructiveHint: descriptor.annotations.destructiveHint,
            idempotentHint: descriptor.annotations.idempotentHint,
            openWorldHint: descriptor.annotations.openWorldHint,
          },
        },
        async (args: unknown) => this.invokeTool(descriptor.name, args, caller),
      );
    }

    return server;
  }

  /**
   * Runs one tool and shapes the result as MCP content.
   *
   * A tool failure is returned as an MCP error result (`isError`), not as a
   * thrown exception: the spec distinguishes "the call succeeded and the answer
   * is an error" from "the protocol failed", and a client can act on the former
   * (show the reason, retry, change arguments) but only on a protocol error by
   * giving up.
   */
  private async invokeTool(
    rawName: Parameters<McpToolExecutionPort['execute']>[0]['toolName'],
    args: unknown,
    caller: McpCallerIdentity,
  ): Promise<{
    content: Array<{ type: 'text'; text: string }>;
    isError?: boolean;
  }> {
    const request: McpToolCallRequest = {
      toolName: rawName,
      args: (args ?? {}) as Record<string, unknown>,
      caller,
    };

    try {
      const result = await this.options.executor.execute(request);
      if (result == null) {
        // The executor contracts exactly one result per call.
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                error: 'tool_result_missing',
                detail: 'The tool produced no result.',
              }),
            },
          ],
          isError: true,
        };
      }
      return {
        content: [{ type: 'text', text: JSON.stringify(result.data) }],
      };
      // The custom rule matches `this.logger.warn/error` literally, and this
      // class holds its logger behind `options` — hence the disable. The log
      // call is the second statement below, so the exemption states a naming
      // mismatch rather than a missing log.
      // eslint-disable-next-line error-handling/no-silent-catch -- logs via this.options.logger.error inside the block
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      this.options.logger.error(
        `MCP tool "${rawName}" failed: ${detail}\n${error instanceof Error ? (error.stack ?? '') : ''}`,
      );
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({ error: 'tool_failed', detail }),
          },
        ],
        isError: true,
      };
    }
  }

  /**
   * Applies the Origin rule.
   *
   * Allowed when: the header is absent (non-browser client), or it matches the
   * configured list. The SDK's own `allowedOrigins` option is deprecated in
   * favour of external middleware, and doing it here keeps the decision in one
   * readable place instead of split between transport options and a route hook.
   */
  private isOriginAllowed(request: IncomingMessage): boolean {
    const origin = request.headers.origin;
    if (origin == null) {
      return true;
    }
    return this.options.allowedOrigins.includes(origin);
  }
}

/** Reads `Mcp-Session-Id`, normalising the array form Node allows. */
function readSessionId(request: IncomingMessage): string | undefined {
  const raw = request.headers['mcp-session-id'];
  if (raw == null) return undefined;
  return Array.isArray(raw) ? raw[0] : raw;
}

/** Writes a JSON-RPC error body without going through the transport. */
function writeJson(
  response: ServerResponse,
  status: number,
  body: unknown,
): void {
  if (response.headersSent) return;
  response.statusCode = status;
  response.setHeader('Content-Type', 'application/json');
  response.end(JSON.stringify(body));
}
