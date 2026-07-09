import {
  Inject,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { ChatOpenAI, OpenAIEmbeddings } from '@langchain/openai';
import type {
  LlmRole,
  LlmRuntimePort,
} from '../../common/llm/llm-runtime.port';
import { aiConfig } from '../../config/ai.config';

/**
 * Concrete LLM runtime service.
 *
 * Creates LangChain model instances (ChatOpenAI / OpenAIEmbeddings) from
 * the application's AI configuration. Consumers should generally use
 * `requireChatModel()` when a model is mandatory, or `hasRoleConfig()`
 * to check availability before calling `createChatModel()`.
 */
@Injectable()
export class LlmRuntimeService implements LlmRuntimePort {
  private readonly logger = new Logger(LlmRuntimeService.name);

  constructor(
    @Inject(aiConfig.KEY)
    private readonly config: ConfigType<typeof aiConfig>,
  ) {}

  // ─── Availability ────────────────────────────────────────────────────────

  hasRoleConfig(role: LlmRole): boolean {
    const roleConfig = this.config[role];
    return (
      this.config.provider === 'openai-compatible' &&
      roleConfig.apiKey != null &&
      roleConfig.baseUrl != null &&
      roleConfig.model != null
    );
  }

  /** Returns all roles that are currently configured. */
  getConfiguredRoles(): LlmRole[] {
    const roles: LlmRole[] = [
      'analysis',
      'vision',
      'language',
      'chat',
      'chatCompression',
      'embedding',
    ];
    return roles.filter((role) => this.hasRoleConfig(role));
  }

  /** Returns true when at least one role is configured. */
  isHealthy(): boolean {
    return this.getConfiguredRoles().length > 0;
  }

  // ─── Chat model ──────────────────────────────────────────────────────────

  createChatModel(
    role: LlmRole,
    options?: {
      timeout?: number;
      temperature?: number;
      maxRetries?: number;
    },
  ): ChatOpenAI {
    const roleConfig = this.config[role];
    const fields: ConstructorParameters<typeof ChatOpenAI>[0] = {
      model: roleConfig.model ?? '',
      apiKey: roleConfig.apiKey ?? '',
      configuration: {
        baseURL: roleConfig.baseUrl ?? '',
      },
    };

    this.applyProviderQuirks(fields, roleConfig);

    if (options?.timeout !== undefined) {
      fields.timeout = options.timeout;
    }
    if (options?.temperature !== undefined) {
      fields.temperature = options.temperature;
    }
    if (options?.maxRetries !== undefined) {
      fields.maxRetries = options.maxRetries;
    }

    this.logger.debug(
      `Created ChatOpenAI for role "${role}" (model=${roleConfig.model ?? 'n/a'}, baseUrl=${roleConfig.baseUrl ?? 'n/a'})`,
    );

    return new ChatOpenAI(fields);
  }

  /**
   * Creates a chat model for the given role, throwing a
   * `ServiceUnavailableException` if the role is not configured.
   *
   * Use this instead of `createChatModel` when the model is mandatory
   * and a missing configuration should surface as a clear error rather
   * than silently producing a broken model with empty-string credentials.
   */
  requireChatModel(
    role: LlmRole,
    options?: {
      timeout?: number;
      temperature?: number;
      maxRetries?: number;
    },
  ): ChatOpenAI {
    if (!this.hasRoleConfig(role)) {
      this.logger.warn(
        `requireChatModel called for unconfigured role "${role}" — throwing`,
      );
      throw new ServiceUnavailableException(
        `LLM role "${role}" is not configured. Set the corresponding environment variables to enable this feature.`,
      );
    }

    return this.createChatModel(role, options);
  }

  // ─── Embedding model ─────────────────────────────────────────────────────

  createEmbeddingModel(): OpenAIEmbeddings | null {
    const roleConfig = this.config.embedding;
    if (
      this.config.provider !== 'openai-compatible' ||
      !roleConfig.apiKey ||
      !roleConfig.baseUrl ||
      !roleConfig.model
    ) {
      return null;
    }

    this.logger.debug(
      `Created OpenAIEmbeddings (model=${roleConfig.model}, baseUrl=${roleConfig.baseUrl})`,
    );

    return new OpenAIEmbeddings({
      apiKey: roleConfig.apiKey,
      configuration: { baseURL: roleConfig.baseUrl },
      model: roleConfig.model,
      ...(roleConfig.dimension != null
        ? { dimensions: roleConfig.dimension }
        : {}),
    });
  }

  // ─── Provider quirks ─────────────────────────────────────────────────────

  /**
   * Applies provider-specific adjustments to the ChatOpenAI constructor fields.
   *
   * Currently handles:
   * - DeepSeek: disables the "thinking" response mode to get direct answers.
   *
   * Extend this method when adding support for other providers with
   * non-standard behaviour.
   */
  private applyProviderQuirks(
    fields: NonNullable<ConstructorParameters<typeof ChatOpenAI>[0]>,
    roleConfig: {
      baseUrl: string | null;
      apiKey: string | null;
      model: string | null;
      dimension?: number;
    },
  ): void {
    if (
      this.config.provider === 'openai-compatible' &&
      roleConfig.baseUrl?.includes('api.deepseek.com')
    ) {
      fields.modelKwargs = {
        thinking: {
          type: 'disabled',
        },
      };
      this.logger.debug('Applied DeepSeek quirk: thinking mode disabled');
    }
  }
}
