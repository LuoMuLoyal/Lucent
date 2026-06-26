import { registerAs } from '@nestjs/config';
import { ConfigKey } from './config-keys.enum';
import { EnvKey } from './env-keys.enum';

function readOptionalEnv(key: EnvKey): string | null {
  const value = process.env[key]?.trim();
  return value ? value : null;
}

interface AiRoleConfig {
  apiKey: string | null;
  baseUrl: string | null;
  model: string | null;
}

export interface AiConfig {
  provider: string | null;
  analysis: AiRoleConfig;
  vision: AiRoleConfig;
  language: AiRoleConfig;
  chat: AiRoleConfig;
  chatCompression: AiRoleConfig;
  embedding: AiRoleConfig;
  safety: {
    /** Regex strings used by the AI safety policy. */
    forbiddenPatterns: string[];
  };
}

function buildRoleConfig(keys: {
  apiKey: EnvKey;
  baseUrl: EnvKey;
  model: EnvKey;
}): AiRoleConfig {
  return {
    apiKey: readOptionalEnv(keys.apiKey),
    baseUrl: readOptionalEnv(keys.baseUrl),
    model: readOptionalEnv(keys.model),
  };
}

export const aiConfig = registerAs(
  ConfigKey.Ai,
  (): AiConfig => ({
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
    }),
    safety: {
      forbiddenPatterns: readForbiddenPatterns(),
    },
  }),
);

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
