/**
 * Fastify route for the MCP endpoint.
 *
 * ## Why a raw Fastify route and not a Nest controller
 *
 * The MCP endpoint is not a Nest resource: it speaks JSON-RPC over a session
 * transport that owns its own response stream, and its validation is the
 * protocol's, not zod-over-DTO. Expressing it as a controller would mean fighting
 * the interceptor/serializer chain that exists to shape REST resources.
 *
 * `reply.hijack()` is the enabling piece: it tells Fastify that the handler has
 * taken ownership of the raw `ServerResponse`, which is exactly what the
 * transport needs in order to stream SSE. Without it Fastify would try to send
 * its own response after the stream has already started.
 *
 * ## Where the path comes from
 *
 * `/api/v1/mcp`, consistent with the rest of the API surface. MCP itself does not
 * care about the path — the spec only requires *a single endpoint* that accepts
 * both `POST` and `GET` — so matching the existing prefix keeps the operational
 * surface uniform (one nginx location, one auth story).
 */
import type { FastifyInstance } from 'fastify';
import type { Logger } from '@nestjs/common';
import type { McpSessionRegistry } from './server.js';

/** Path the MCP endpoint answers on. */
export const MCP_ROUTE_PATH = '/api/v1/mcp';

/**
 * Registers the MCP route.
 *
 * The body is parsed by Fastify's JSON parser, so the raw stream has already been
 * consumed by the time the handler runs — hence the parsed body is handed to the
 * transport explicitly instead of letting it read the stream itself.
 */
export function registerMcpRoute(options: {
  fastify: FastifyInstance;
  registry: McpSessionRegistry;
  logger: Logger;
}): void {
  const { fastify, registry, logger } = options;

  const handler = async (
    request: Parameters<Parameters<FastifyInstance['route']>[0]['handler']>[0],
    reply: Parameters<Parameters<FastifyInstance['route']>[0]['handler']>[1],
  ): Promise<void> => {
    // From here on the transport owns the response. Anything Fastify would do
    // afterwards (serialization, the `onSend` hook) must not run.
    reply.hijack();
    try {
      await registry.handleRequest(request.raw, reply.raw, request.body);
    } catch (error) {
      logger.error(
        `MCP request failed: ${error instanceof Error ? error.message : String(error)}`,
        error instanceof Error ? (error.stack ?? '') : '',
      );
      if (!reply.raw.headersSent) {
        reply.raw.statusCode = 500;
        reply.raw.setHeader('Content-Type', 'application/json');
        reply.raw.end(
          JSON.stringify({
            jsonrpc: '2.0',
            error: { code: -32603, message: 'Internal error' },
            id: null,
          }),
        );
      }
    }
  };

  // One route, three verbs: POST sends messages, GET opens the server→client
  // stream, DELETE terminates the session. The spec requires a single endpoint.
  fastify.route({
    method: ['POST', 'GET', 'DELETE'],
    url: MCP_ROUTE_PATH,
    // The transport negotiates its own content types and status codes; letting
    // Fastify attach a schema here would double-validate JSON-RPC envelopes.
    handler,
  });
}
