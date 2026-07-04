import type { ChatOpenAI } from '@langchain/openai';

/**
 * Supported AI model roles. Kept as an explicit union so that `common/ai`
 * does not need to know about the concrete `AiConfig` shape defined in
 * `src/config/ai.config.ts`.
 */
export type AiRole =
  | 'analysis'
  | 'vision'
  | 'language'
  | 'chat'
  | 'chatCompression'
  | 'embedding';

/**
 * Port abstraction for the LLM runtime. Defined in `common/ai` so that
 * `BaseAiGeneratorService` depends on an interface rather than the concrete
 * `LlmRuntimeService` living under `modules/llm-runtime`.
 */
export interface LlmRuntimePort {
  hasRoleConfig(role: AiRole): boolean;
  createChatModel(
    role: AiRole,
    options?: {
      timeout?: number;
      temperature?: number;
      maxRetries?: number;
    },
  ): ChatOpenAI;
}
