import { registerAs } from '@nestjs/config';
import type { LlmRole } from '../../common/llm/llm-runtime.port.js';
import { ConfigKey } from '../env/config-keys.enum.js';
import { EnvKey } from '../env/env-keys.enum.js';
import type { RuntimeConfigKey } from '../runtime/runtime-config.schema.js';

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

/**
 * Environment keys backing one LLM role.
 *
 * The runtime-tuning document deliberately reuses environment-variable names,
 * so these are also the keys the config center may override — with two
 * exceptions that are typed as plain {@link EnvKey} because they are *not*
 * tuning knobs:
 *
 * - `apiKey` is a secret: it only ever comes from `.env`.
 * - `dimension` is a schema invariant (pgvector column width), not a knob.
 */
export interface LlmRoleKeys {
  /** Secret; read from `.env` only, never from the config center. */
  readonly apiKey: EnvKey;
  readonly baseUrl: RuntimeConfigKey;
  readonly model: RuntimeConfigKey;
  /** Role-level override; omitted for roles with no chat model. */
  readonly thinking?: RuntimeConfigKey;
  readonly temperature?: RuntimeConfigKey;
  readonly maxRetries?: RuntimeConfigKey;
  readonly timeout?: RuntimeConfigKey;
  readonly dimension?: EnvKey;
}

/**
 * Declares the env-key wiring for every role exactly once.
 *
 * `LlmRuntimeService` reads the non-secret half of this map when it resolves a
 * model call against the runtime snapshot, so a rename here cannot silently
 * disconnect a tuning key.
 */
export const LLM_ROLE_KEYS = {
  analysis: {
    apiKey: EnvKey.AI_ANALYSIS_API_KEY,
    baseUrl: EnvKey.AI_ANALYSIS_BASE_URL,
    model: EnvKey.AI_ANALYSIS_MODEL,
    thinking: EnvKey.AI_ANALYSIS_THINKING,
    temperature: EnvKey.AI_ANALYSIS_TEMPERATURE,
    maxRetries: EnvKey.AI_ANALYSIS_MAX_RETRIES,
    timeout: EnvKey.AI_ANALYSIS_TIMEOUT_MS,
  },
  vision: {
    apiKey: EnvKey.AI_VISION_API_KEY,
    baseUrl: EnvKey.AI_VISION_BASE_URL,
    model: EnvKey.AI_VISION_MODEL,
    thinking: EnvKey.AI_VISION_THINKING,
    temperature: EnvKey.AI_VISION_TEMPERATURE,
    maxRetries: EnvKey.AI_VISION_MAX_RETRIES,
    timeout: EnvKey.AI_VISION_TIMEOUT_MS,
  },
  language: {
    apiKey: EnvKey.AI_LANGUAGE_API_KEY,
    baseUrl: EnvKey.AI_LANGUAGE_BASE_URL,
    model: EnvKey.AI_LANGUAGE_MODEL,
    thinking: EnvKey.AI_LANGUAGE_THINKING,
    temperature: EnvKey.AI_LANGUAGE_TEMPERATURE,
    maxRetries: EnvKey.AI_LANGUAGE_MAX_RETRIES,
    timeout: EnvKey.AI_LANGUAGE_TIMEOUT_MS,
  },
  chat: {
    apiKey: EnvKey.AI_CHAT_API_KEY,
    baseUrl: EnvKey.AI_CHAT_BASE_URL,
    model: EnvKey.AI_CHAT_MODEL,
    thinking: EnvKey.AI_CHAT_THINKING,
    temperature: EnvKey.AI_CHAT_TEMPERATURE,
    maxRetries: EnvKey.AI_CHAT_MAX_RETRIES,
    timeout: EnvKey.AI_CHAT_TIMEOUT_MS,
  },
  chatCompression: {
    apiKey: EnvKey.AI_CHAT_COMPRESSION_API_KEY,
    baseUrl: EnvKey.AI_CHAT_COMPRESSION_BASE_URL,
    model: EnvKey.AI_CHAT_COMPRESSION_MODEL,
    thinking: EnvKey.AI_CHAT_COMPRESSION_THINKING,
    temperature: EnvKey.AI_CHAT_COMPRESSION_TEMPERATURE,
    maxRetries: EnvKey.AI_CHAT_COMPRESSION_MAX_RETRIES,
    timeout: EnvKey.AI_CHAT_COMPRESSION_TIMEOUT_MS,
  },
  embedding: {
    apiKey: EnvKey.AI_EMBEDDING_API_KEY,
    baseUrl: EnvKey.AI_EMBEDDING_BASE_URL,
    model: EnvKey.AI_EMBEDDING_MODEL,
    dimension: EnvKey.AI_EMBEDDING_DIMENSION,
  },
} satisfies Record<LlmRole, LlmRoleKeys>;

function buildRoleConfig(
  keys: LlmRoleKeys,
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
    analysis: buildRoleConfig(LLM_ROLE_KEYS.analysis, thinking),
    vision: buildRoleConfig(LLM_ROLE_KEYS.vision, thinking),
    language: buildRoleConfig(LLM_ROLE_KEYS.language, thinking),
    chat: buildRoleConfig(LLM_ROLE_KEYS.chat, thinking),
    chatCompression: buildRoleConfig(LLM_ROLE_KEYS.chatCompression, thinking),
    embedding: buildRoleConfig(LLM_ROLE_KEYS.embedding, thinking),
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
