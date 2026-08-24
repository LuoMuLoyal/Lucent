/**
 * YAML configuration loader.
 *
 * Loads and deep-merges `config/default.yaml` → `config/<NODE_ENV>.yaml` →
 * `config/<NODE_ENV>.local.yaml`, validates the result with a Zod schema,
 * and returns the merged object as a NestJS `ConfigModule` load factory.
 *
 * The returned object is registered under `ConfigKey.Yaml` and accessible
 * via `configService.get(ConfigKey.Yaml)` with full type inference.
 *
 * Priority (highest first):
 *   1. `process.env` / `.env` (sensitive values + start selectors — never read here)
 *   2. `config/<env>.local.yaml`
 *   3. `config/<env>.yaml`
 *   4. `config/default.yaml`
 *
 * Sensitive values (secrets, API keys, passwords) stay in `.env` and are
 * accessed via `process.env[EnvKey.XXX]` — they are NOT in YAML.
 */

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { z } from 'zod';
import { registerAs } from '@nestjs/config';

// ── YAML schema (non-sensitive config) ──────────────────────────────

const yamlSchema = z.object({
  app: z.object({
    host: z.string().default('0.0.0.0'),
    port: z.coerce.number().int().min(1).default(3000),
    corsOrigin: z.string().default(''),
    publicBaseUrl: z.string().default('http://localhost:3000'),
  }),
  log: z.object({
    level: z
      .enum(['error', 'warn', 'info', 'debug', 'verbose'])
      .default('debug'),
    format: z.enum(['pretty', 'json']).optional(),
    slowRequestThresholdMs: z.coerce.number().int().min(10).default(2000),
    slowQueryThresholdMs: z.coerce.number().int().min(10).default(500),
  }),
  mail: z.object({
    driver: z.enum(['log', 'smtp']).default('log'),
    host: z.string().default('smtp.example.com'),
    port: z.coerce.number().int().min(1).default(587),
    from: z.string().default('noreply@example.com'),
    queue: z.object({
      maxAttempts: z.coerce.number().int().min(1).max(20).default(3),
      backoffDelayMs: z.coerce.number().int().min(100).default(5000),
      workerConcurrency: z.coerce.number().int().min(1).max(50).default(3),
      completeAgeSeconds: z.coerce.number().int().min(60).default(86400),
      failAgeSeconds: z.coerce.number().int().min(60).default(604800),
      completeMaxCount: z.coerce.number().int().min(1).default(1000),
      failMaxCount: z.coerce.number().int().min(1).default(5000),
    }),
  }),
  storage: z.object({
    provider: z.enum(['tencent-cos', 's3']).default('tencent-cos'),
    tencentCos: z.object({
      region: z.string().default('ap-guangzhou'),
      uploadExpiresSeconds: z.coerce.number().int().min(60).default(600),
      maxUploadBytes: z.coerce.number().int().min(1).default(10485760),
      downloadExpiresSeconds: z.coerce.number().int().min(60).default(600),
    }),
    s3: z.object({
      endpoint: z.string().default(''),
      clientEndpoint: z.string().default(''),
      externalEndpoint: z.string().default(''),
      publicBaseUrl: z.string().default(''),
      bucket: z.string().default(''),
      region: z.string().default('us-east-1'),
      uploadExpiresSeconds: z.coerce.number().int().min(60).default(600),
      maxUploadBytes: z.coerce.number().int().min(1).default(10485760),
      downloadExpiresSeconds: z.coerce.number().int().min(60).default(600),
    }),
  }),
  ai: z.object({
    embeddingDimension: z.coerce.number().int().min(1).max(4096).default(1536),
  }),
  fuzzy: z.object({
    acceptScore: z.coerce.number().min(0).max(1).default(0.7),
    minLead: z.coerce.number().min(0).max(1).default(0.1),
    queryPrefixLength: z.coerce.number().int().min(1).max(10).default(1),
  }),
  meal: z.object({
    defaultPortionGrams: z.coerce.number().int().min(1).max(10000).default(100),
    smallPortionGrams: z.coerce.number().int().min(1).max(10000).default(30),
    highProteinThresholdG: z.coerce.number().int().min(0).max(500).default(20),
    lowCarbohydrateThresholdG: z.coerce
      .number()
      .int()
      .min(0)
      .max(500)
      .default(20),
    highFatThresholdG: z.coerce.number().int().min(0).max(500).default(20),
  }),
  verification: z.object({
    codeTtlMs: z.coerce.number().int().min(10000).max(3600000).default(300000),
    cooldownMs: z.coerce.number().int().min(0).max(3600000).default(60000),
    rateLimitWindowMs: z.coerce
      .number()
      .int()
      .min(60000)
      .max(86400000)
      .default(600000),
    rateLimitMax: z.coerce.number().int().min(1).max(1000).default(20),
    codeLength: z.coerce.number().int().min(4).max(10).default(6),
  }),
  oauth: z.object({
    stateTtlMs: z.coerce.number().int().min(60000).max(3600000).default(600000),
  }),
  jwt: z.object({
    accessTtl: z.coerce.number().int().min(1).default(7200),
    refreshTtl: z.coerce.number().int().min(1).default(2592000),
  }),
  metrics: z.object({
    enabled: z.coerce.boolean().default(true),
  }),
  jpush: z.object({
    apnsProduction: z.coerce.boolean().default(false),
    apiBaseUrl: z.string().default('https://api.jpush.cn'),
  }),
});

export type YamlConfig = z.infer<typeof yamlSchema>;

// ── Deep merge ──────────────────────────────────────────────────────

function deepMerge<T>(base: T, override: unknown): T {
  if (
    typeof base !== 'object' ||
    base === null ||
    Array.isArray(base) ||
    typeof override !== 'object' ||
    override === null ||
    Array.isArray(override)
  ) {
    return override === undefined ? base : (override as T);
  }

  const result: Record<string, unknown> = {
    ...(base as Record<string, unknown>),
  };
  for (const [key, value] of Object.entries(
    override as Record<string, unknown>,
  )) {
    result[key] = key in result ? deepMerge(result[key], value) : value;
  }
  return result as T;
}

// ── YAML file loading ──────────────────────────────────────────────

function getConfigDir(): string {
  return join(__dirname, '..', '..', '..');
}

function loadYamlFile(filePath: string): Record<string, unknown> {
  if (!existsSync(filePath)) {
    return {};
  }
  const text = readFileSync(filePath, 'utf-8');
  const parsed = parseYaml(text) as Record<string, unknown> | null;
  return parsed ?? {};
}

// ── Cached merged config ───────────────────────────────────────────

let cachedConfig: YamlConfig | null = null;
let cachedConfigNodeEnv: string | null = null;

/**
 * Loads, merges, and validates YAML configuration files.
 * The result is cached — subsequent calls return the same object.
 */
export function loadYamlConfig(): YamlConfig {
  const nodeEnv = process.env['NODE_ENV']?.trim() || 'development';
  if (cachedConfig && cachedConfigNodeEnv === nodeEnv) {
    return cachedConfig;
  }

  const configDir = getConfigDir();

  const files = [
    join(configDir, 'config', 'default.yaml'),
    join(configDir, 'config', `${nodeEnv}.yaml`),
    join(configDir, 'config', `${nodeEnv}.local.yaml`),
  ];

  const merged = files.reduce<Record<string, unknown>>(
    (acc, file) => deepMerge(acc, loadYamlFile(file)),
    {},
  );

  const parsed = yamlSchema.safeParse(merged);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `${i.path.join('.')}: ${i.message}`)
      .join('; ');
    throw new Error(`YAML configuration validation failed: ${issues}`);
  }

  cachedConfig = parsed.data;
  cachedConfigNodeEnv = nodeEnv;
  return cachedConfig;
}

/**
 * NestJS `ConfigModule` load factory.
 *
 * Usage in `app.module.ts`:
 * ```ts
 * ConfigModule.forRoot({
 *   load: [yamlConfigFactory, appConfig, ...],
 *   // validate still receives process.env (sensitive values only)
 * })
 * ```
 *
 * Access via `configService.get<YamlConfig>(ConfigKey.Yaml)`.
 */
export const yamlConfigFactory = registerAs('yaml', () => loadYamlConfig());
