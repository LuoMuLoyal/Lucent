/**
 * Nest wiring for the MCP endpoint (ADR-0024 `adapters/mcp`).
 *
 * ## Why it is a separate module and not part of `AssistantModule`
 *
 * The MCP endpoint is an **outbound protocol surface**, not part of the
 * assistant's conversation flow. Keeping it separate buys three things:
 *
 * - it can be disabled without touching the assistant (`MCP_ENABLED`);
 * - its dependencies are exactly `AssistantToolService` plus configuration, so
 *   the wiring states the coupling instead of hiding it in a 40-provider module;
 * - the route registration happens in `onModuleInit`, which only runs when this
 *   module is imported — a disabled endpoint is genuinely absent rather than
 *   present-and-returning-404.
 *
 * ## Import direction
 *
 * `adapters/mcp → adapters/acl` is allowed (same layer, sibling concern): the
 * MCP layer runs tools through the assistant's executor. What is forbidden is
 * `adapters → infrastructure` (`ddd-adapters-no-infrastructure`), and this module
 * respects that — it never reaches for Prisma, Redis or the sidecar clients.
 */
import {
  Inject,
  Injectable,
  Logger,
  Module,
  type OnModuleDestroy,
  type OnModuleInit,
  Optional,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { FastifyInstance } from 'fastify';
import { HttpAdapterHost } from '@nestjs/core';
import { AssistantModule } from '../../assistant.module.js';
import { EnvKey } from '../../../../config/env/env-keys.enum.js';
import type { ToolLimitBudgets } from '../acl/tools/shared/tool-definitions.js';
import { CODE_TOOL_LIMIT_BUDGETS } from '../acl/tools/shared/tool-definitions.js';
import { createMcpAuthenticator, MCP_API_KEY_ENV } from './auth.js';
import { McpToolExecutionAdapter } from './execution.js';
import { MCP_ROUTE_PATH, registerMcpRoute } from './routes.js';
import { McpSessionRegistry, type McpServerFactoryOptions } from './server.js';

/** Environment key gating the whole endpoint. */
export const MCP_ENABLED_ENV = EnvKey.MCP_ENABLED;

/** Environment key listing permitted origins (comma separated). */
export const MCP_ALLOWED_ORIGINS_ENV = EnvKey.MCP_ALLOWED_ORIGINS;

/**
 * Builds the session registry with its dependencies resolved.
 *
 * Separated from the module so tests can construct a registry without a Nest
 * container — the transport plumbing is the interesting part, and it does not
 * need DI to be exercised.
 */
export function createMcpSessionRegistry(options: {
  budgets: ToolLimitBudgets;
  executionAdapter: McpToolExecutionAdapter;
  apiKey: string | undefined;
  allowedOrigins: readonly string[];
  logger: Logger;
}): McpSessionRegistry {
  const factoryOptions: McpServerFactoryOptions = {
    budgets: options.budgets,
    executor: options.executionAdapter,
    authenticate: createMcpAuthenticator({ expectedToken: options.apiKey }),
    allowedOrigins: options.allowedOrigins,
    logger: options.logger,
  };
  return new McpSessionRegistry(factoryOptions);
}

@Injectable()
export class McpRegistrationService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(McpRegistrationService.name);
  private registry: McpSessionRegistry | null = null;

  constructor(
    private readonly adapterHost: HttpAdapterHost,
    private readonly executionAdapter: McpToolExecutionAdapter,
    @Optional()
    @Inject(ConfigService)
    private readonly configService?: ConfigService,
  ) {}

  onModuleInit(): void {
    const enabled = this.readEnv(MCP_ENABLED_ENV)?.toLowerCase() === 'true';
    if (!enabled) {
      this.logger.log(
        `MCP endpoint disabled (${MCP_ENABLED_ENV} is not "true").`,
      );
      return;
    }

    const apiKey = this.readEnv(MCP_API_KEY_ENV);
    if (apiKey == null || apiKey.length === 0) {
      // Loud on purpose: an endpoint that answers JSON-RPC without auth is one
      // nginx location away from being public, and silence is how that happens.
      this.logger.warn(
        `${MCP_API_KEY_ENV} is unset — the MCP endpoint is running WITHOUT authentication.`,
      );
    }

    const allowedOrigins = (this.readEnv(MCP_ALLOWED_ORIGINS_ENV) ?? '')
      .split(',')
      .map((origin) => origin.trim())
      .filter((origin) => origin.length > 0);

    this.registry = createMcpSessionRegistry({
      budgets: CODE_TOOL_LIMIT_BUDGETS,
      executionAdapter: this.executionAdapter,
      apiKey,
      allowedOrigins,
      logger: this.logger,
    });

    // `HttpAdapterHost.httpAdapter` is typed non-optional, but it is genuinely
    // absent when the app is built without an HTTP server (the contract-export
    // path). The check stays because that path really does run this module.
    const adapter = this.adapterHost.httpAdapter as
      { getInstance: () => FastifyInstance } | undefined;
    if (adapter == null) {
      this.logger.log('MCP endpoint not registered: no HTTP adapter.');
      return;
    }

    registerMcpRoute({
      fastify: adapter.getInstance(),
      registry: this.registry,
      logger: this.logger,
    });
    this.logger.log(`MCP endpoint listening on ${MCP_ROUTE_PATH}.`);
  }

  async onModuleDestroy(): Promise<void> {
    await this.registry?.closeAll();
  }

  /**
   * Reads a setting from `ConfigService` when present, else `process.env`.
   *
   * Both paths exist because the contract-export process builds the app without
   * a full config module; reading only `ConfigService` would make the endpoint
   * silently skip registration there.
   */
  private readEnv(key: string): string | undefined {
    const fromConfig = this.configService?.get<string>(key);
    if (fromConfig != null) {
      return fromConfig;
    }
    return process.env[key];
  }
}

@Module({
  imports: [AssistantModule],
  providers: [McpToolExecutionAdapter, McpRegistrationService],
  exports: [McpToolExecutionAdapter],
})
export class McpModule {}
