import type { ChatOpenAI } from '@langchain/openai';

/**
 * Supported LLM model roles. Kept as an explicit union so that `common/llm`
 * does not need to know about the concrete `LlmConfig` shape defined in
 * `src/config/llm.config.ts`.
 */
export type LlmRole =
  | 'analysis'
  | 'vision'
  | 'language'
  | 'chat'
  | 'chatCompression'
  | 'embedding';

/**
 * Port abstraction for the LLM runtime. Defined in `common/llm` so that
 * `BaseLlmGeneratorService` depends on an interface rather than the concrete
 * `LlmRuntimeService` living under `src/llm-runtime/`.
 */
export interface LlmRuntimePort {
  hasRoleConfig(role: LlmRole): boolean;
  createChatModel(
    role: LlmRole,
    options?: {
      timeout?: number;
      temperature?: number;
      maxRetries?: number;
    },
  ): ChatOpenAI;
  /** Returns the configured model name for the given role, or `null`. */
  getModelName(role: LlmRole): string | null;
}
