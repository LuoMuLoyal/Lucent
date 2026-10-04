import { Inject, Injectable, Logger } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { ChatOpenAI, OpenAIEmbeddings } from '@langchain/openai';
import type {
  LlmRole,
  LlmRuntimePort,
} from '../common/llm/llm-runtime.port.js';
import { LlmNotConfiguredException } from '../common/llm/safety/llm-not-configured.exception.js';
import { llmConfig, type ThinkingMode } from '../config/services/llm.config.js';

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
    @Inject(llmConfig.KEY)
    private readonly config: ConfigType<typeof llmConfig>,
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

  // ─── Model info ────────────────────────────────────────────────────────

  getModelName(role: LlmRole): string | null {
    return this.config[role].model ?? null;
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
   * Creates a chat model for the given role, throwing
   * `LlmNotConfiguredException` if the role is not configured.
   *
   * Use this instead of `createChatModel` when the model is mandatory
   * and a missing configuration should surface as a clear error rather
   * than silently producing a broken model with empty-string credentials.
   *
   * The exception carries the stable `LLM_NOT_CONFIGURED` code so clients can
   * distinguish a deployment that lacks the model from a runtime dependency
   * failure — a distinction that used to be impossible, because both surfaced
   * as `DEPENDENCY_UNAVAILABLE`.
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
      throw new LlmNotConfiguredException(role);
    }

    return this.createChatModel(role, options);
  }

  // ─── Embedding model ─────────────────────────────────────────────────────

  /**
   * Embedding vector dimension from `AI_EMBEDDING_DIMENSION`, or `null` when
   * the embedding role is not configured.
   *
   * Exposed so pgvector stores can declare a typed `vector(n)` column and
   * build an HNSW index — an untyped `vector` column cannot back either.
   */
  get embeddingDimension(): number | null {
    if (this.config.provider !== 'openai-compatible') {
      return null;
    }
    return this.config.embedding.dimension ?? null;
  }

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
   * Two concerns live here and they are deliberately separated:
   *
   * 1. **Thinking mode** — driven by the role's `thinking` setting
   *    (`AI_<ROLE>_THINKING`, falling back to `AI_THINKING`). `disabled` /
   *    `enabled` are honoured on every provider that exposes a switch;
   *    `auto` keeps the legacy detection so existing deployments are unchanged.
   * 2. **Provider quirks** — adjustments required for a provider to work at
   *    all, independent of what the operator asked for.
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
      thinking?: ThinkingMode;
      dimension?: number;
    },
  ): void {
    if (this.config.provider !== 'openai-compatible') {
      return;
    }

    this.applyThinkingMode(fields, roleConfig);
  }

  /**
   * Translates the semantic thinking mode into the provider's own payload.
   *
   * Two rules keep this safe to deploy:
   *
   * - **`auto` never changes existing behaviour.** It reproduces exactly the
   *   legacy detection (DeepSeek host, or an Aliyun-compatible host serving a
   *   `qwen3*` model) and emits nothing anywhere else, so upgrading without
   *   setting the new variables cannot alter a single outbound request.
   * - **An explicit `enabled` / `disabled` is honoured on the recognized
   *   families even when `auto` would have stayed quiet** — e.g. a DeepSeek
   *   model served through an Aliyun-compatible gateway, which is precisely
   *   the case the old detection missed. An unrecognized gateway still gets
   *   nothing, because sending an unknown reasoning field is a
   *   request-validation error on strict OpenAI-compatible servers; the
   *   operator sees no effect instead of a broken request.
   */
  private applyThinkingMode(
    fields: NonNullable<ConstructorParameters<typeof ChatOpenAI>[0]>,
    roleConfig: {
      baseUrl: string | null;
      model: string | null;
      thinking?: ThinkingMode;
    },
  ): void {
    const isDeepSeek =
      roleConfig.baseUrl?.includes('api.deepseek.com') === true;
    const isAliyunCompat =
      roleConfig.baseUrl?.includes('aliyuncs.com') === true;
    const explicit =
      roleConfig.thinking === 'enabled' || roleConfig.thinking === 'disabled';

    if (isDeepSeek) {
      const mode: ThinkingMode = explicit
        ? (roleConfig.thinking as ThinkingMode)
        : 'disabled';
      fields.modelKwargs = {
        thinking: { type: mode === 'enabled' ? 'enabled' : 'disabled' },
      };
      this.logger.debug(`Applied DeepSeek thinking mode: ${mode}`);
      return;
    }

    if (isAliyunCompat) {
      const legacyQwen3 =
        roleConfig.model?.toLowerCase().startsWith('qwen3') === true;
      if (!explicit && !legacyQwen3) {
        return;
      }
      const mode: ThinkingMode = explicit
        ? (roleConfig.thinking as ThinkingMode)
        : 'disabled';
      fields.modelKwargs = { enable_thinking: mode === 'enabled' };
      this.logger.debug(
        `Applied Aliyun-compatible thinking mode: ${mode} (enable_thinking=${
          mode === 'enabled' ? 'true' : 'false'
        })`,
      );
    }
  }
}
