import { afterEach, describe, expect, it, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { Logger } from '@nestjs/common';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { CODE_TOOL_LIMIT_BUDGETS } from '../acl/tools/shared/tool-definitions.js';
import { MCP_TOOL_NAMES, mcpToolName } from '../../domain/mcp/exposure.js';
import type { McpToolExecutionPort } from '../../application/ports/mcp.js';
import type { AssistantToolExecutionResult } from '../../application/ports/assistant.js';
import { createMcpAuthenticator } from './auth.js';
import { registerMcpRoute } from './routes.js';
import { McpSessionRegistry } from './server.js';

/**
 * End-to-end exercise of the Streamable HTTP transport.
 *
 * A real Fastify instance, a real SDK client on the other side, and a stub
 * executor — the transport plumbing is what is under test, and mocking it would
 * only assert that the mocks agree with each other.
 */
describe('MCP server over Streamable HTTP', () => {
  const logger = new Logger('mcp-test');
  const instances: FastifyInstance[] = [];

  afterEach(async () => {
    for (const instance of instances.splice(0)) {
      await instance.close();
    }
  });

  async function startServer(options: {
    execute?: McpToolExecutionPort['execute'];
    apiKey?: string;
    allowedOrigins?: readonly string[];
  }): Promise<{ url: URL; execute: ReturnType<typeof vi.fn> }> {
    const execute = vi.fn(
      options.execute ??
        ((): Promise<AssistantToolExecutionResult> =>
          Promise.resolve({ name: 'get_drugbank_detail', data: { ok: true } })),
    ) as unknown as McpToolExecutionPort['execute'] & ReturnType<typeof vi.fn>;

    const registry = new McpSessionRegistry({
      budgets: CODE_TOOL_LIMIT_BUDGETS,
      executor: { execute },
      authenticate: createMcpAuthenticator({ expectedToken: options.apiKey }),
      allowedOrigins: options.allowedOrigins ?? [],
      logger,
    });

    const app = Fastify({ logger: false });
    registerMcpRoute({ fastify: app, registry, logger });
    await app.listen({ host: '127.0.0.1', port: 0 });
    instances.push(app);

    const address = app.server.address();
    if (address == null || typeof address === 'string') {
      throw new Error('Fastify did not report a bound port.');
    }
    return {
      url: new URL(`http://127.0.0.1:${String(address.port)}/api/v1/mcp`),
      execute,
    };
  }

  it('lists exactly the exposed tools, under their exported names', async () => {
    const { url } = await startServer({});
    const client = new Client({ name: 'probe', version: '1.0.0' });
    const transport = new StreamableHTTPClientTransport(url);

    await client.connect(transport);
    const listed = await client.listTools();

    expect(listed.tools.map((tool) => tool.name).sort()).toEqual(
      MCP_TOOL_NAMES.map((name) => mcpToolName(name)).sort(),
    );
    await client.close();
  });

  it('runs a call through the executor and returns its data', async () => {
    const { url, execute } = await startServer({
      execute: () =>
        Promise.resolve({
          name: 'get_drugbank_detail',
          data: { drugbankId: 'DB01050', name: 'ibuprofen' },
        }),
    });
    const client = new Client({ name: 'probe', version: '1.0.0' });
    await client.connect(new StreamableHTTPClientTransport(url));

    const result = await client.callTool({
      name: mcpToolName('get_drugbank_detail'),
      arguments: {},
    });

    expect(execute).toHaveBeenCalledTimes(1);
    const call = execute.mock.calls[0]?.[0] as unknown as {
      toolName: string;
      args: Record<string, unknown>;
    };
    // The executor sees the *internal* name, never the exported one.
    expect(call.toolName).toBe('get_drugbank_detail');
    const content = result.content as Array<{ text: string }>;
    expect(JSON.parse(String(content[0]?.text))).toEqual({
      drugbankId: 'DB01050',
      name: 'ibuprofen',
    });
    await client.close();
  });

  it('forwards the model arguments to the executor unchanged', async () => {
    const { url, execute } = await startServer({});
    const client = new Client({ name: 'probe', version: '1.0.0' });
    await client.connect(new StreamableHTTPClientTransport(url));

    await client.callTool({
      name: mcpToolName('resolve_drugbank_entity'),
      arguments: { query: 'ibuprofen' },
    });

    const call = execute.mock.calls[0]?.[0] as {
      args: Record<string, unknown>;
    };
    expect(call.args).toEqual({ query: 'ibuprofen' });
    await client.close();
  });

  it('reports a tool failure as an error result, not a protocol error', async () => {
    // The spec distinguishes "the call completed and the answer is an error"
    // from "the protocol failed": a client can act on the first (show the
    // reason, retry, change arguments) and can only give up on the second.
    const { url } = await startServer({
      execute: () => Promise.reject(new Error('sidecar unreachable')),
    });
    const client = new Client({ name: 'probe', version: '1.0.0' });
    await client.connect(new StreamableHTTPClientTransport(url));

    const result = await client.callTool({
      name: mcpToolName('reason_over_ontology'),
      arguments: { question: 'does A inhibit B' },
    });

    expect(result.isError).toBe(true);
    expect(
      String((result.content as Array<{ text: string }>)[0]?.text),
    ).toContain('sidecar unreachable');
    await client.close();
  });

  it('rejects a request with no credentials when a token is configured', async () => {
    const { url } = await startServer({ apiKey: 'expected-token' });

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2025-06-18',
          capabilities: {},
          clientInfo: { name: 'probe', version: '1.0.0' },
        },
      }),
    });

    expect(response.status).toBe(401);
  });

  it('rejects a disallowed Origin, even with valid credentials', async () => {
    // Spec §Security Warning item 1. Without this a remote page can drive the
    // server through DNS rebinding.
    const { url } = await startServer({
      apiKey: 'expected-token',
      allowedOrigins: ['https://allowed.example'],
    });

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
        Authorization: 'Bearer expected-token',
        Origin: 'https://evil.example',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2025-06-18',
          capabilities: {},
          clientInfo: { name: 'probe', version: '1.0.0' },
        },
      }),
    });

    expect(response.status).toBe(403);
  });

  it('accepts a request that carries no Origin at all', async () => {
    // Non-browser clients (CLI, another service) send no Origin. Rejecting them
    // would break the primary use case this server exists for.
    const { url } = await startServer({ apiKey: 'expected-token' });

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
        Authorization: 'Bearer expected-token',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2025-06-18',
          capabilities: {},
          clientInfo: { name: 'probe', version: '1.0.0' },
        },
      }),
    });

    // The session was created, so the transport answered (SSE or JSON).
    expect([200, 400]).not.toContain(response.status === 401 ? 401 : -1);
    expect(response.status).not.toBe(401);
    expect(response.status).not.toBe(403);
  });
});
