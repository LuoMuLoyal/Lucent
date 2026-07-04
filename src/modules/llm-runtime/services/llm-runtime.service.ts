import { Inject, Injectable } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { ChatOpenAI, OpenAIEmbeddings } from '@langchain/openai';
import type {
  AiRole,
  LlmRuntimePort,
} from '../../../common/ai/llm-runtime.port';
import { aiConfig } from '../../../config/ai.config';

@Injectable()
export class LlmRuntimeService implements LlmRuntimePort {
  constructor(
    @Inject(aiConfig.KEY)
    private readonly config: ConfigType<typeof aiConfig>,
  ) {}

  hasRoleConfig(role: AiRole): boolean {
    const roleConfig = this.config[role];
    return (
      this.config.provider === 'openai-compatible' &&
      roleConfig.apiKey != null &&
      roleConfig.baseUrl != null &&
      roleConfig.model != null
    );
  }

  createChatModel(
    role: AiRole,
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

    if (
      this.config.provider === 'openai-compatible' &&
      roleConfig.baseUrl?.includes('api.deepseek.com')
    ) {
      fields.modelKwargs = {
        thinking: {
          type: 'disabled',
        },
      };
    }

    if (options?.timeout !== undefined) {
      fields.timeout = options.timeout;
    }
    if (options?.temperature !== undefined) {
      fields.temperature = options.temperature;
    }
    if (options?.maxRetries !== undefined) {
      fields.maxRetries = options.maxRetries;
    }

    return new ChatOpenAI(fields);
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

    return new OpenAIEmbeddings({
      apiKey: roleConfig.apiKey,
      configuration: { baseURL: roleConfig.baseUrl },
      model: roleConfig.model,
      ...(roleConfig.dimension != null
        ? { dimensions: roleConfig.dimension }
        : {}),
    });
  }
}
