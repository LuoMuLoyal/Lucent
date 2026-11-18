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
import { createMcpAuthenticator } from './auth.js';
import { RuntimeConfigService } from '../../../../config/runtime/runtime-config.service.js';
import type { RuntimeConfigPort } from '../../../../config/runtime/runtime-config.types.js';
import type { RuntimeConfigKey } from '../../../../config/runtime/runtime-config.schema.js';
import { McpToolExecutionAdapter } from './execution.js';
import { MCP_ROUTE_PATH, registerMcpRoute } from './routes.js';
import { McpSessionRegistry, type McpServerFactoryOptions } from './server.js';

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
    private readonly configService: ConfigService,
    @Optional()
    @Inject(RuntimeConfigService)
    private readonly runtimeConfigService?: RuntimeConfigPort,
  ) {}

  onModuleInit(): void {
    const enabled =
      this.readSetting(EnvKey.MCP_ENABLED, 'false').toLowerCase() === 'true';
    if (!enabled) {
      this.logger.log(
        `MCP endpoint disabled (${EnvKey.MCP_ENABLED} is not "true").`,
      );
      return;
    }

    const apiKey = this.readSetting(EnvKey.MCP_API_KEY, '');
    if (apiKey.length === 0) {
      // Loud on purpose: an endpoint that answers JSON-RPC without auth is one
      // nginx location away from being public, and silence is how that happens.
      this.logger.warn(
        `${EnvKey.MCP_API_KEY} is unset — the MCP endpoint is running WITHOUT authentication.`,
      );
    }

    const allowedOrigins = this.readSetting(EnvKey.MCP_ALLOWED_ORIGINS, '')
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
   * Reads a setting the way every other sidecar in this repo does:
   * **runtime snapshot → env baseline → caller-supplied default**.
   *
   * The snapshot layer is what makes `MCP_ENABLED` hot-switchable; skipping it
   * would have made the endpoint the only sidecar whose switch needs a restart.
   * `ConfigService` is always present (`ConfigModule.forRoot({ isGlobal: true })`),
   * so there is no third fallback to `process.env` — that would be a second
   * source of truth that silently wins when the config layer is misconfigured.
   */
  private readSetting(key: RuntimeConfigKey, fallback: string): string {
    const fromSnapshot = this.runtimeConfigService?.getSnapshot().values[key];
    if (fromSnapshot != null) {
      return String(fromSnapshot);
    }
    const fromEnv = this.configService.get<string>(key);
    return fromEnv ?? fallback;
  }
}

@Module({
  imports: [AssistantModule],
  providers: [McpToolExecutionAdapter, McpRegistrationService],
  exports: [McpToolExecutionAdapter],
})
export class McpModule {}
