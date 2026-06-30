import { Inject, Injectable } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { ChatOpenAI } from '@langchain/openai';
import { aiConfig, type AiConfig } from '../../../config/ai.config';

type AiRole = keyof Omit<AiConfig, 'provider' | 'safety'>;

@Injectable()
export class LlmRuntimeService {
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
}
