/**
 * Lucent as an MCP **client** for the map/weather tools.
 *
 * ## Why these tools are not in `TOOL_REQUIRED_SOURCES`
 *
 * The exposed-tool table (`domain/policies/tool-permission.ts`) is exhaustive
 * over `TOOL_NAMES` and answers "which of the user's data sources does this tool
 * read". A remote map server reads *none* of them. Adding Amap's tools there
 * would force a fake answer for every one of them ("needs nothing") and would
 * quietly widen the table's meaning from "user-data permissions" to "every tool
 * that exists".
 *
 * So the split is the one the plan already drew (§5.5): built-in tools keep the
 * static exhaustive check; external tools are a separate noun, and the type
 * system is what keeps them out of the permission table rather than a comment.
 *
 * ## Why a fresh client per call
 *
 * The SDK's client owns a session (`Mcp-Session-Id`) and a streaming response
 * body. Pooling those across concurrent turns means sharing cancellation and
 * reconnect state between unrelated requests — a hanging route-planning call
 * would then hold a session another turn is waiting on. A per-call connect is
 * one extra round trip against a service whose latency is dominated by the map
 * query itself.
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EnvKey } from '../../../../config/env/env-keys.enum.js';
import { RuntimeConfigService } from '../../../../config/runtime/runtime-config.service.js';
import type { RuntimeConfigPort } from '../../../../config/runtime/runtime-config.types.js';
import {
  AMAP_MCP_DEFAULT_TIMEOUT_MS,
  AMAP_MCP_DEFAULT_URL,
} from '../../../../config/env/sidecar-defaults.js';
import {
  ExternalMcpPort,
  type RemoteToolCallResult,
  type RemoteToolDescriptor,
} from '../../application/ports/external-mcp.js';

/**
 * One tool the remote server advertises.
 *
 * Re-exported from the port so callers that only need the shape never import
 * the port directly — same arrangement as the Mem0 client.
 */
export type ExternalToolDescriptor = RemoteToolDescriptor;

/** Discriminated outcome for a remote call. */
export type ExternalToolCallResult = RemoteToolCallResult;

/**
 * Resolved per call so an operator can flip the client off, move the endpoint
 * or widen the timeout without a restart.
 *
 * The API key is NOT part of this: it is a secret, read once from `.env`, and
 * appended to the request URL at call time so it never reaches a log line.
 */
interface AmapSettings {
  readonly enabled: boolean;
  readonly baseUrl: string;
  readonly timeoutMs: number;
}

/** Logged instead of the raw body when the call fails; bodies can be long. */
const MAX_ERROR_BODY_LOG_CHARS = 300;

@Injectable()
export class AmapMcpClientService extends ExternalMcpPort {
  private readonly logger = new Logger(AmapMcpClientService.name);

  private readonly apiKey: string | null;
  private readonly configService: ConfigService;
  private readonly runtimeConfig: RuntimeConfigPort | undefined;

  /** Descriptors are stable per process; the remote list changes rarely. */
  private cachedTools: readonly ExternalToolDescriptor[] | null = null;

  constructor(
    configService: ConfigService,
    @Optional()
    @Inject(RuntimeConfigService)
    runtimeConfig?: RuntimeConfigPort,
  ) {
    super();
    this.configService = configService;
    this.runtimeConfig = runtimeConfig;
    const key =
      this.configService.get<string>(EnvKey.AMAP_MCP_KEY)?.trim() ?? '';
    this.apiKey = key.length > 0 ? key : null;
  }

  private readSettings(): AmapSettings {
    const values = this.runtimeConfig?.getSnapshot().values;
    return {
      enabled:
        values?.[EnvKey.AMAP_MCP_ENABLED] ??
        this.configService.get<string>(EnvKey.AMAP_MCP_ENABLED) === 'true',
      baseUrl: (
        values?.[EnvKey.AMAP_MCP_URL] ??
        this.configService.get<string>(EnvKey.AMAP_MCP_URL) ??
        AMAP_MCP_DEFAULT_URL
      ).replace(/\/+$/, ''),
      timeoutMs:
        values?.[EnvKey.AMAP_MCP_TIMEOUT_MS] ??
        this.configService.get<number>(EnvKey.AMAP_MCP_TIMEOUT_MS) ??
        AMAP_MCP_DEFAULT_TIMEOUT_MS,
    };
  }

  /** Whether the client is enabled *and* has a key to authenticate with. */
  isEnabled(): boolean {
    const settings = this.readSettings();
    if (!settings.enabled) return false;
    if (this.apiKey == null) return false;
    return true;
  }

  /**
   * Lists the remote tools.
   *
   * Returns an empty list (not an error) when the client is disabled: the
   * caller's job is then simply to bind no extra tools. A *failure* while
   * enabled is also swallowed to an empty list — map access is an extra, and a
   * turn must not fail because the map server is down.
   */
  async listTools(): Promise<readonly RemoteToolDescriptor[]> {
    if (!this.isEnabled()) return [];
    if (this.cachedTools != null) return this.cachedTools;

    const outcome = await this.withClient(async (client) => {
      const result = await client.listTools();
      return result.tools.map((tool) => ({
        name: tool.name,
        description: tool.description ?? '',
        // The port wants a plain record and the SDK already types this as one;
        // a tool that takes no arguments publishes `{}`, which is valid here.
        inputSchema: tool.inputSchema,
      }));
    });
    if (!outcome.ok) {
      this.logger.warn(`Amap MCP tools/list failed: ${outcome.reason}`);
      return [];
    }
    this.cachedTools = outcome.value;
    return outcome.value;
  }

  /**
   * Calls one remote tool.
   *
   * The arguments go through verbatim: the remote server validates them, and
   * re-validating here would mean maintaining a second copy of its schema.
   */
  async callTool(
    name: string,
    args: Record<string, unknown>,
  ): Promise<ExternalToolCallResult> {
    if (!this.isEnabled()) {
      return { ok: false, reason: 'not_configured' };
    }

    const outcome = await this.withClient(async (client) => {
      const result = await client.callTool({ name, arguments: args });
      return result;
    });
    if (!outcome.ok) return outcome;

    const result = outcome.value as {
      isError?: boolean;
      content?: unknown;
    };
    if (result.isError === true) {
      // The server reported a *tool-level* failure (bad city name, out of
      // range coordinates). That is a normal outcome the model should read and
      // react to, so it rides back as data rather than as a thrown error.
      return { ok: true, content: { isError: true, content: result.content } };
    }
    return { ok: true, content: result.content };
  }

  /**
   * Connects, runs `run`, and always closes.
   *
   * Every failure — network, auth, protocol, timeout — becomes a discriminated
   * `{ ok: false }`. Nothing here throws: the caller surfaces map problems to
   * the model as an unavailable envelope, never as a failed turn.
   */
  private async withClient<T>(
    run: (client: Client) => Promise<T>,
  ): Promise<{ ok: true; value: T } | { ok: false; reason: string }> {
    const settings = this.readSettings();
    if (!this.isEnabled()) return { ok: false, reason: 'not_configured' };

    const controller = new AbortController();
    const timer = setTimeout(() => {
      controller.abort();
    }, settings.timeoutMs);
    timer.unref();

    const client = new Client({ name: 'lucent', version: '1.0.0' });
    try {
      // The key rides as a query parameter because that is Amap's documented
      // shape; it is appended here (not stored in the snapshot) so the secret
      // stays out of anything an operator can read back.
      const url = new URL(settings.baseUrl);
      url.searchParams.set('key', this.apiKey ?? '');
      const transport = new StreamableHTTPClientTransport(url, {
        requestInit: { signal: controller.signal },
      });
      await client.connect(transport);
      const value = await run(client);
      return { ok: true, value };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const detail =
        message.length > MAX_ERROR_BODY_LOG_CHARS
          ? `${message.slice(0, MAX_ERROR_BODY_LOG_CHARS)}…`
          : message;
      this.logger.warn(`Amap MCP call failed: ${detail}`);
      return { ok: false, reason: detail };
    } finally {
      clearTimeout(timer);
      // Closing can itself fail (the transport may already be gone); that is
      // not worth surfacing on top of the real error.
      await client.close().catch(() => undefined);
    }
  }
}
