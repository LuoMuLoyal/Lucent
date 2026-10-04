import { registerAs } from '@nestjs/config';
import { ConfigKey } from '../env/config-keys.enum.js';
import { EnvKey } from '../env/env-keys.enum.js';

function readOptionalEnv(key: EnvKey): string | null {
  const value = process.env[key]?.trim();
  return value || null;
}

interface LlmRoleConfig {
  apiKey: string | null;
  baseUrl: string | null;
  model: string | null;
  dimension?: number;
  /**
   * Effective thinking mode for this role, already resolved against the global
   * `AI_THINKING` default — consumers never need to re-apply the fallback.
   *
   * Optional for the same reason as `dimension`: hand-built role literals in
   * tests and ports may omit it. `undefined` is treated as `auto`, i.e. the
   * legacy provider detection, which is what an old fixture should mean.
   */
  thinking?: ThinkingMode;
}

/**
 * Semantic control over the provider's reasoning/"thinking" mode.
 *
 * The value is deliberately provider-agnostic: how it reaches the wire (e.g.
 * DeepSeek's `thinking: { type }` versus the `enable_thinking` boolean used by
 * Aliyun-compatible gateways) is decided by the runtime from the role's
 * `baseUrl`, so operators configure intent rather than a vendor payload shape.
 *
 * - `auto`     — no explicit intent: keep the built-in provider detection.
 * - `disabled` — ask the provider for a direct answer with no reasoning trace.
 * - `enabled`  — ask the provider to reason before answering.
 */
export type ThinkingMode = 'auto' | 'enabled' | 'disabled';

export interface LlmConfig {
  provider: string | null;
  /**
   * Global default applied to every role that has no role-level override.
   *
   * Optional so hand-built config literals (tests, ports) can omit it;
   * `undefined` means `auto`, the legacy provider detection.
   */
  thinking?: ThinkingMode;
  analysis: LlmRoleConfig;
  vision: LlmRoleConfig;
  language: LlmRoleConfig;
  chat: LlmRoleConfig;
  chatCompression: LlmRoleConfig;
  embedding: LlmRoleConfig;
  safety: {
    /** Regex strings used by the LLM safety policy. */
    forbiddenPatterns: string[];
  };
}

const THINKING_MODES: readonly ThinkingMode[] = ['auto', 'enabled', 'disabled'];

/** Reads a thinking mode, returning null when unset or unrecognized. */
function readThinkingMode(key: EnvKey): ThinkingMode | null {
  const value = readOptionalEnv(key)?.toLowerCase();
  if (value == null) return null;
  return THINKING_MODES.find((mode) => mode === value) ?? null;
}

function buildRoleConfig(
  keys: {
    apiKey: EnvKey;
    baseUrl: EnvKey;
    model: EnvKey;
    /** Role-level override; omitted for roles with no chat model. */
    thinking?: EnvKey;
    dimension?: EnvKey;
  },
  defaultThinking: ThinkingMode,
): LlmRoleConfig {
  const config: LlmRoleConfig = {
    apiKey: readOptionalEnv(keys.apiKey),
    baseUrl: readOptionalEnv(keys.baseUrl),
    model: readOptionalEnv(keys.model),
    // Role-level override wins; otherwise inherit the global default.
    thinking:
      (keys.thinking == null ? null : readThinkingMode(keys.thinking)) ??
      defaultThinking,
  };
  if (keys.dimension) {
    const envVal = readOptionalNumericEnv(keys.dimension);
    if (envVal !== undefined) {
      config.dimension = envVal;
    }
  }
  return config;
}

function readOptionalNumericEnv(key: EnvKey): number | undefined {
  const value = readOptionalEnv(key);
  if (value == null) return undefined;
  const parsed = parseInt(value, 10);
  return Number.isNaN(parsed) ? undefined : parsed;
}

export const llmConfig = registerAs(ConfigKey.Llm, (): LlmConfig => {
  const thinking = readThinkingMode(EnvKey.AI_THINKING) ?? 'auto';
  return {
    provider: readOptionalEnv(EnvKey.AI_PROVIDER),
    thinking,
    analysis: buildRoleConfig(
      {
        apiKey: EnvKey.AI_ANALYSIS_API_KEY,
        baseUrl: EnvKey.AI_ANALYSIS_BASE_URL,
        model: EnvKey.AI_ANALYSIS_MODEL,
        thinking: EnvKey.AI_ANALYSIS_THINKING,
      },
      thinking,
    ),
    vision: buildRoleConfig(
      {
        apiKey: EnvKey.AI_VISION_API_KEY,
        baseUrl: EnvKey.AI_VISION_BASE_URL,
        model: EnvKey.AI_VISION_MODEL,
        thinking: EnvKey.AI_VISION_THINKING,
      },
      thinking,
    ),
    language: buildRoleConfig(
      {
        apiKey: EnvKey.AI_LANGUAGE_API_KEY,
        baseUrl: EnvKey.AI_LANGUAGE_BASE_URL,
        model: EnvKey.AI_LANGUAGE_MODEL,
        thinking: EnvKey.AI_LANGUAGE_THINKING,
      },
      thinking,
    ),
    chat: buildRoleConfig(
      {
        apiKey: EnvKey.AI_CHAT_API_KEY,
        baseUrl: EnvKey.AI_CHAT_BASE_URL,
        model: EnvKey.AI_CHAT_MODEL,
        thinking: EnvKey.AI_CHAT_THINKING,
      },
      thinking,
    ),
    chatCompression: buildRoleConfig(
      {
        apiKey: EnvKey.AI_CHAT_COMPRESSION_API_KEY,
        baseUrl: EnvKey.AI_CHAT_COMPRESSION_BASE_URL,
        model: EnvKey.AI_CHAT_COMPRESSION_MODEL,
        thinking: EnvKey.AI_CHAT_COMPRESSION_THINKING,
      },
      thinking,
    ),
    embedding: buildRoleConfig(
      {
        apiKey: EnvKey.AI_EMBEDDING_API_KEY,
        baseUrl: EnvKey.AI_EMBEDDING_BASE_URL,
        model: EnvKey.AI_EMBEDDING_MODEL,
        dimension: EnvKey.AI_EMBEDDING_DIMENSION,
      },
      thinking,
    ),
    safety: {
      forbiddenPatterns: readForbiddenPatterns(),
    },
  };
});

function readForbiddenPatterns(): string[] {
  const raw = readOptionalEnv(EnvKey.AI_SAFETY_FORBIDDEN_PATTERNS);
  if (raw == null) {
    return [];
  }
  return raw
    .split(/[,\n]/u)
    .map((pattern) => pattern.trim())
    .filter((pattern) => pattern.length > 0);
}
