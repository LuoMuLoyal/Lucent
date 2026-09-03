import { z } from 'zod';
import type { core } from 'zod';
import { EnvKey } from './env-keys.enum.js';

/**
 * Supported runtime environments.
 */
export const NodeEnvironment = {
  Development: 'development',
  Test: 'test',
  Production: 'production',
} as const;

export type NodeEnvironment =
  (typeof NodeEnvironment)[keyof typeof NodeEnvironment];

// ── Shared building blocks ──────────────────────────────────────────

const optionalString = z.string().optional();
const optionalUri = z.url().optional();
const optionalEmptyUri = z.union([z.literal(''), z.url()]).optional();

const postgresUrl = z
  .string()
  .refine(
    (v) => v.startsWith('postgres://') || v.startsWith('postgresql://'),
    'must be a postgres or postgresql URL',
  )
  .optional();

const redisUrl = z
  .string()
  .refine(
    (v) => v.startsWith('redis://') || v.startsWith('rediss://'),
    'must be a redis or rediss URL',
  )
  .optional();

const httpUrl = z
  .union([
    z.literal(''),
    z
      .string()
      .refine(
        (v) => v.startsWith('http://') || v.startsWith('https://'),
        'must be an http or https URL',
      ),
  ])
  .optional();

// ── Schema ──────────────────────────────────────────────────────────
//
// Only sensitive values, start selectors, and values that must be in
// process.env are validated here. Non-sensitive runtime configuration
// is validated by the YAML loader's Zod schema (yaml-loader.ts).
//
// Keys that have been migrated to YAML but might still appear in .env
// during the compatibility period are allowed as optional strings —
// they are ignored by the application and will be removed in Phase 3.

const envSchema = z.object({
  // ── Start selectors (read before Nest/ConfigService) ────────────
  [EnvKey.NODE_ENV]: z
    .enum([
      NodeEnvironment.Development,
      NodeEnvironment.Test,
      NodeEnvironment.Production,
    ])
    .default(NodeEnvironment.Development),
  [EnvKey.TRUST_PROXY]: z.enum(['true', 'false']).optional(),
  [EnvKey.OPENAPI_EXPORT_SKIP_DB_CONNECT]: z.enum(['true', 'false']).optional(),
  [EnvKey.OTEL_ENABLED]: z.enum(['true', 'false']).optional(),
  [EnvKey.OTEL_EXPORTER_OTLP_ENDPOINT]: optionalEmptyUri,
  [EnvKey.VICTORIALOGS_URL]: optionalEmptyUri,

  // ── Database / Redis (sensitive, in .env) ────────────────────────
  [EnvKey.DATABASE_URL]: postgresUrl,
  [EnvKey.REDIS_URL]: redisUrl,

  // ── JWT secrets (sensitive, in .env) ─────────────────────────────
  [EnvKey.JWT_ACCESS_SECRET]: z.string().min(32),
  [EnvKey.JWT_REFRESH_SECRET]: z.string().min(32),
  [EnvKey.JWT_ISSUER]: optionalString,
  [EnvKey.JWT_AUDIENCE]: optionalString,

  // ── Better Auth (sensitive, in .env) ─────────────────────────────
  [EnvKey.BETTER_AUTH_SECRET]: z.string().min(32),
  [EnvKey.BETTER_AUTH_URL]: optionalUri,
  [EnvKey.BETTER_AUTH_EMAIL_CALLBACK_URL]: optionalString,

  // ── Admin (sensitive, in .env) ───────────────────────────────────
  [EnvKey.ADMIN_EMAIL]: z.email(),
  [EnvKey.ADMIN_PASSWORD]: z.string().min(8),
  [EnvKey.ADMIN_COOKIE_SECRET]: z.string().min(32),

  // ── AI provider (secrets in .env, non-sensitive in YAML) ─────────
  [EnvKey.AI_PROVIDER]: z.enum(['openai-compatible', '']).optional(),
  [EnvKey.AI_ANALYSIS_API_KEY]: optionalString,
  [EnvKey.AI_ANALYSIS_BASE_URL]: optionalUri,
  [EnvKey.AI_ANALYSIS_MODEL]: optionalString,
  [EnvKey.AI_VISION_API_KEY]: optionalString,
  [EnvKey.AI_VISION_BASE_URL]: optionalUri,
  [EnvKey.AI_VISION_MODEL]: optionalString,
  [EnvKey.AI_LANGUAGE_API_KEY]: optionalString,
  [EnvKey.AI_LANGUAGE_BASE_URL]: optionalUri,
  [EnvKey.AI_LANGUAGE_MODEL]: optionalString,
  [EnvKey.AI_CHAT_API_KEY]: optionalString,
  [EnvKey.AI_CHAT_BASE_URL]: optionalUri,
  [EnvKey.AI_CHAT_MODEL]: optionalString,
  [EnvKey.AI_CHAT_COMPRESSION_API_KEY]: optionalString,
  [EnvKey.AI_CHAT_COMPRESSION_BASE_URL]: optionalUri,
  [EnvKey.AI_CHAT_COMPRESSION_MODEL]: optionalString,
  [EnvKey.AI_EMBEDDING_API_KEY]: optionalString,
  [EnvKey.AI_EMBEDDING_BASE_URL]: optionalUri,
  [EnvKey.AI_EMBEDDING_MODEL]: optionalString,
  [EnvKey.AI_SAFETY_FORBIDDEN_PATTERNS]: optionalString,

  // ── Mail credentials (sensitive, in .env) ───────────────────────
  [EnvKey.MAIL_USER]: optionalString,
  [EnvKey.MAIL_PASS]: optionalString,

  // ── OAuth provider credentials (sensitive, in .env) ─────────────
  [EnvKey.WECHAT_WEB_APP_ID]: optionalString,
  [EnvKey.WECHAT_WEB_APP_SECRET]: optionalString,
  [EnvKey.WECHAT_WEB_REDIRECT_URI]: optionalEmptyUri,
  [EnvKey.WECHAT_MOBILE_APP_ID]: optionalString,
  [EnvKey.WECHAT_MOBILE_APP_SECRET]: optionalString,

  [EnvKey.APPLE_APP_ID]: optionalString,
  [EnvKey.APPLE_CLIENT_SECRET]: optionalString,
  [EnvKey.QQ_APP_ID]: optionalString,
  [EnvKey.QQ_APP_SECRET]: optionalString,
  [EnvKey.QQ_REDIRECT_URI]: optionalUri,

  [EnvKey.WEIBO_APP_ID]: optionalString,
  [EnvKey.WEIBO_APP_SECRET]: optionalString,
  [EnvKey.WEIBO_REDIRECT_URI]: optionalUri,

  [EnvKey.GOOGLE_CLIENT_ID]: optionalString,
  [EnvKey.GOOGLE_CLIENT_SECRET]: optionalString,
  [EnvKey.GOOGLE_REDIRECT_URI]: optionalUri,

  // ── Tencent COS credentials (sensitive, in .env) ────────────────
  [EnvKey.TENCENT_COS_SECRET_ID]: optionalString,
  [EnvKey.TENCENT_COS_SECRET_KEY]: optionalString,
  [EnvKey.TENCENT_COS_BUCKET]: optionalString,
  [EnvKey.TENCENT_COS_PUBLIC_BASE_URL]: httpUrl,

  // ── S3 storage credentials (sensitive, in .env) ─────────────────
  [EnvKey.STORAGE_S3_ACCESS_KEY]: optionalString,
  [EnvKey.STORAGE_S3_SECRET_KEY]: optionalString,

  // ── JPush credentials (sensitive, in .env) ──────────────────────
  [EnvKey.JPUSH_APP_KEY]: optionalString,
  [EnvKey.JPUSH_MASTER_SECRET]: optionalString,

  // ── Metrics auth (sensitive, in .env) ────────────────────────────
  [EnvKey.METRICS_USER]: optionalString,
  [EnvKey.METRICS_PASSWORD]: optionalString,

  // ── Testing (sensitive, in .env) ────────────────────────────────
  [EnvKey.TESTING_SHARED_SECRET]: optionalString,

  // ── Client operations (in .env, will migrate to YAML in Phase 2) ─
  [EnvKey.SUPPORT_EMAIL]: z.email().optional(),
  [EnvKey.MIN_CLIENT_VERSION]: optionalString,
  [EnvKey.LATEST_VERSION]: optionalString,
  [EnvKey.DOWNLOAD_URL]: optionalString,
});

/** Strongly typed shape of validated environment variables. */
export type EnvironmentVariables = z.infer<typeof envSchema>;

// ── Cross-field validation (schema-level refinements) ───────────────
//
// The cross-field assertions below are attached to the schema itself so
// that `ConfigModule.forRoot({ validationSchema })` (NestJS 12 Standard
// Schema option) carries the full validation in one declarative unit.
// `validateEnvironment` remains a thin wrapper for direct callers and
// tests, preserving the historical error format.

function addIssue(ctx: { issues: core.$ZodRawIssue[] }, message: string): void {
  ctx.issues.push({ code: 'custom', input: undefined, message });
}

/**
 * Full env schema (field validation + cross-field refinements) exposed
 * for `ConfigModule.forRoot({ validationSchema })` — NestJS 12 accepts
 * any Standard Schema compatible validator, and zod 4 implements the
 * spec natively.
 */
export const validatedEnvSchema = envSchema.check((ctx) => {
  const config = ctx.value;
  const report = (message: string): void => {
    addIssue(ctx, message);
  };
  assertProductionEnvironment(config, report);
  assertTencentCosEnvironment(config, report);
  assertS3StorageEnvironment(config);
  assertJpushEnvironment(config, report);
  assertAiEnvironment(config, report);
});

// ── Cross-field validation helpers ──────────────────────────────────

const AI_ROLE_GROUPS = [
  {
    name: 'analysis',
    keys: [
      EnvKey.AI_ANALYSIS_API_KEY,
      EnvKey.AI_ANALYSIS_BASE_URL,
      EnvKey.AI_ANALYSIS_MODEL,
    ],
  },
  {
    name: 'vision',
    keys: [
      EnvKey.AI_VISION_API_KEY,
      EnvKey.AI_VISION_BASE_URL,
      EnvKey.AI_VISION_MODEL,
    ],
  },
  {
    name: 'language',
    keys: [
      EnvKey.AI_LANGUAGE_API_KEY,
      EnvKey.AI_LANGUAGE_BASE_URL,
      EnvKey.AI_LANGUAGE_MODEL,
    ],
  },
  {
    name: 'chat',
    keys: [
      EnvKey.AI_CHAT_API_KEY,
      EnvKey.AI_CHAT_BASE_URL,
      EnvKey.AI_CHAT_MODEL,
    ],
  },
  {
    name: 'chatCompression',
    keys: [
      EnvKey.AI_CHAT_COMPRESSION_API_KEY,
      EnvKey.AI_CHAT_COMPRESSION_BASE_URL,
      EnvKey.AI_CHAT_COMPRESSION_MODEL,
    ],
  },
  {
    name: 'embedding',
    keys: [
      EnvKey.AI_EMBEDDING_API_KEY,
      EnvKey.AI_EMBEDDING_BASE_URL,
      EnvKey.AI_EMBEDDING_MODEL,
    ],
  },
] as const;

/**
 * Validates a raw environment object against the project schema.
 *
 * Only validates sensitive values and start selectors that remain in
 * `process.env`. Non-sensitive runtime configuration is validated by
 * the YAML loader.
 *
 * Thin wrapper around {@link validatedEnvSchema} that keeps the
 * historical `Environment validation failed: ...` error format for
 * direct callers and tests. The application itself uses the schema
 * through `ConfigModule.forRoot({ validationSchema })`.
 *
 * @throws {Error} When a required or invalid value is detected.
 */
export function validateEnvironment(
  config: Record<string, unknown>,
): EnvironmentVariables {
  const parsed = validatedEnvSchema.safeParse(config);

  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `${i.path.join('.')}: ${i.message}`)
      .join('; ');
    throw new Error(`Environment validation failed: ${issues}`);
  }

  return parsed.data;
}

function assertProductionEnvironment(
  config: EnvironmentVariables,
  report: (message: string) => void,
): void {
  if (config[EnvKey.NODE_ENV] !== NodeEnvironment.Production) {
    return;
  }

  const missingKeys = [
    EnvKey.DATABASE_URL,
    EnvKey.REDIS_URL,
    EnvKey.JWT_ACCESS_SECRET,
    EnvKey.JWT_REFRESH_SECRET,
    EnvKey.BETTER_AUTH_SECRET,
    EnvKey.ADMIN_EMAIL,
    EnvKey.ADMIN_PASSWORD,
    EnvKey.ADMIN_COOKIE_SECRET,
  ].filter((key) => !config[key as keyof EnvironmentVariables]);

  if (missingKeys.length > 0) {
    report(
      `Missing required production environment variables: ${missingKeys.join(', ')}`,
    );
  }
}

function assertTencentCosEnvironment(
  config: EnvironmentVariables,
  report: (message: string) => void,
): void {
  const requiredKeys = [
    EnvKey.TENCENT_COS_SECRET_ID,
    EnvKey.TENCENT_COS_SECRET_KEY,
    EnvKey.TENCENT_COS_BUCKET,
  ] as const;
  const triggerKeys = [
    EnvKey.TENCENT_COS_SECRET_ID,
    EnvKey.TENCENT_COS_SECRET_KEY,
    EnvKey.TENCENT_COS_BUCKET,
  ] as const;
  const hasAnyTencentCosConfig = triggerKeys.some((key) =>
    (config[key] ?? '').trim(),
  );

  if (!hasAnyTencentCosConfig) {
    return;
  }

  const missingKeys = requiredKeys.filter((key) => !(config[key] ?? '').trim());

  if (missingKeys.length > 0) {
    report(
      `Incomplete Tencent COS environment variables: ${missingKeys.join(', ')}`,
    );
  }
}

function assertS3StorageEnvironment(_config: EnvironmentVariables): void {
  // STORAGE_PROVIDER is now in YAML; this check is deferred to the
  // storage module's useFactory which reads from ConfigKey.Yaml.
  // Sensitive S3 credentials are still checked here.
  // This function is kept as a no-op placeholder — the S3 credential
  // completeness check is handled at module instantiation time.
}

function assertJpushEnvironment(
  config: EnvironmentVariables,
  report: (message: string) => void,
): void {
  const credentialKeys = [
    EnvKey.JPUSH_APP_KEY,
    EnvKey.JPUSH_MASTER_SECRET,
  ] as const;
  const hasAnyCredentials = credentialKeys.some((key) =>
    (config[key] ?? '').trim(),
  );

  if (!hasAnyCredentials) {
    return;
  }

  const missingKeys = credentialKeys.filter(
    (key) => !(config[key] ?? '').trim(),
  );
  if (missingKeys.length > 0) {
    report(`Incomplete JPush environment variables: ${missingKeys.join(', ')}`);
  }
}

function assertAiEnvironment(
  config: EnvironmentVariables,
  report: (message: string) => void,
): void {
  const provider = (config[EnvKey.AI_PROVIDER] ?? '').trim();
  const hasAnyAiRoleConfig = AI_ROLE_GROUPS.some((group) =>
    group.keys.some((key) => (config[key] ?? '').trim()),
  );

  if (!provider && !hasAnyAiRoleConfig) {
    return;
  }

  if (!provider) {
    report(
      `AI_PROVIDER is required when any AI role is configured; expected openai-compatible`,
    );
  }

  for (const group of AI_ROLE_GROUPS) {
    const presentKeys = group.keys.filter((key) => (config[key] ?? '').trim());

    if (presentKeys.length === 0) {
      continue;
    }

    if (presentKeys.length !== group.keys.length) {
      const missingKeys = group.keys.filter(
        (key) => !(config[key] ?? '').trim(),
      );
      report(
        `Incomplete AI ${group.name} configuration: ${missingKeys.join(', ')}`,
      );
    }
  }
}
