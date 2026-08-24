import { registerAs } from '@nestjs/config';
import { ConfigKey } from '../env/config-keys.enum';
import { EnvKey } from '../env/env-keys.enum';
import { loadYamlConfig } from '../yaml/yaml-loader';

function readOptionalEnv(key: EnvKey): string | null {
  const value = process.env[key]?.trim();
  return value ? value : null;
}

interface LlmRoleConfig {
  apiKey: string | null;
  baseUrl: string | null;
  model: string | null;
  dimension?: number;
}

export interface LlmConfig {
  provider: string | null;
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

function buildRoleConfig(keys: {
  apiKey: EnvKey;
  baseUrl: EnvKey;
  model: EnvKey;
  dimension?: EnvKey;
  yamlDefaultDimension?: number;
}): LlmRoleConfig {
  const config: LlmRoleConfig = {
    apiKey: readOptionalEnv(keys.apiKey),
    baseUrl: readOptionalEnv(keys.baseUrl),
    model: readOptionalEnv(keys.model),
  };
  if (keys.dimension) {
    const envVal = readOptionalNumericEnv(keys.dimension);
    if (envVal !== undefined) {
      config.dimension = envVal;
    } else if (keys.yamlDefaultDimension !== undefined) {
      config.dimension = keys.yamlDefaultDimension;
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
  const yaml = loadYamlConfig();

  return {
    provider: readOptionalEnv(EnvKey.AI_PROVIDER),
    analysis: buildRoleConfig({
      apiKey: EnvKey.AI_ANALYSIS_API_KEY,
      baseUrl: EnvKey.AI_ANALYSIS_BASE_URL,
      model: EnvKey.AI_ANALYSIS_MODEL,
    }),
    vision: buildRoleConfig({
      apiKey: EnvKey.AI_VISION_API_KEY,
      baseUrl: EnvKey.AI_VISION_BASE_URL,
      model: EnvKey.AI_VISION_MODEL,
    }),
    language: buildRoleConfig({
      apiKey: EnvKey.AI_LANGUAGE_API_KEY,
      baseUrl: EnvKey.AI_LANGUAGE_BASE_URL,
      model: EnvKey.AI_LANGUAGE_MODEL,
    }),
    chat: buildRoleConfig({
      apiKey: EnvKey.AI_CHAT_API_KEY,
      baseUrl: EnvKey.AI_CHAT_BASE_URL,
      model: EnvKey.AI_CHAT_MODEL,
    }),
    chatCompression: buildRoleConfig({
      apiKey: EnvKey.AI_CHAT_COMPRESSION_API_KEY,
      baseUrl: EnvKey.AI_CHAT_COMPRESSION_BASE_URL,
      model: EnvKey.AI_CHAT_COMPRESSION_MODEL,
    }),
    embedding: buildRoleConfig({
      apiKey: EnvKey.AI_EMBEDDING_API_KEY,
      baseUrl: EnvKey.AI_EMBEDDING_BASE_URL,
      model: EnvKey.AI_EMBEDDING_MODEL,
      dimension: EnvKey.AI_EMBEDDING_DIMENSION,
      yamlDefaultDimension: yaml.ai.embeddingDimension,
    }),
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
