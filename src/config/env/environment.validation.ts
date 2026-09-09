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
// This schema is the single source of truth for every environment key:
// type coercion (z.coerce), validation, and — for non-sensitive keys —
// the runtime default via `.default()`. Sensitive values stay in
// `process.env` / `.env.*` and are validated without defaults.
//
// `ConfigModule.forRoot({ validationSchema: validatedEnvSchema })` runs
// this schema at startup; @nestjs/config writes the validated result
// (including applied defaults) back into `process.env`, so config
// services and business consumers read defaults through
// `configService.get(EnvKey.X)` with no inline fallback needed.
//
// Keys that might still appear in .env are allowed as optional strings —
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
  [EnvKey.OPENAPI_EXPORT_SKIP_REDIS]: z.enum(['true', 'false']).optional(),
  [EnvKey.OTEL_ENABLED]: z.enum(['true', 'false']).optional(),
  [EnvKey.OTEL_EXPORTER_OTLP_ENDPOINT]: optionalEmptyUri,
  [EnvKey.VICTORIALOGS_URL]: optionalEmptyUri,

  // ── App (non-sensitive, defaults below) ─────────────────────────
  [EnvKey.HOST]: z.string().default('0.0.0.0'),
  [EnvKey.PORT]: z.coerce.number().int().min(1).default(3000),
  [EnvKey.CORS_ORIGIN]: z.string().default(''),
  [EnvKey.PUBLIC_BASE_URL]: z.string().default('http://localhost:3000'),

  // ── Logging / observability (non-sensitive, defaults below) ────
  [EnvKey.LOG_LEVEL]: z
    .enum(['error', 'warn', 'info', 'debug', 'verbose'])
    .default('debug'),
  [EnvKey.LOG_FORMAT]: z.enum(['pretty', 'json']).default('pretty'),
  [EnvKey.SLOW_REQUEST_THRESHOLD_MS]: z.coerce
    .number()
    .int()
    .min(10)
    .default(2000),
  [EnvKey.SLOW_QUERY_THRESHOLD_MS]: z.coerce
    .number()
    .int()
    .min(10)
    .default(500),
  [EnvKey.METRICS_ENABLED]: z.enum(['true', 'false']).default('true'),

  // ── Database / Redis (sensitive, in .env) ────────────────────────
  [EnvKey.DATABASE_URL]: postgresUrl,
  [EnvKey.REDIS_URL]: redisUrl,

  // ── JWT (secrets in .env; TTLs non-sensitive with defaults) ─────
  [EnvKey.JWT_ACCESS_SECRET]: z.string().min(32),
  [EnvKey.JWT_REFRESH_SECRET]: z.string().min(32),
  [EnvKey.JWT_ACCESS_TTL]: z.string().default('7200'),
  [EnvKey.JWT_REFRESH_TTL]: z.string().default('2592000'),
  [EnvKey.JWT_ISSUER]: z.string().default('lucent-api'),
  [EnvKey.JWT_AUDIENCE]: z.string().default('luminous-app'),

  // ── Better Auth (sensitive, in .env) ─────────────────────────────
  [EnvKey.BETTER_AUTH_SECRET]: z.string().min(32),
  [EnvKey.BETTER_AUTH_URL]: optionalUri,

  // ── Admin (sensitive, in .env) ───────────────────────────────────
  [EnvKey.ADMIN_EMAIL]: z.email(),
  [EnvKey.ADMIN_PASSWORD]: z.string().min(8),
  [EnvKey.ADMIN_COOKIE_SECRET]: z.string().min(32),

  // ── AI provider (secrets in .env; base URL/model also via env) ────
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
  [EnvKey.AI_EMBEDDING_DIMENSION]: z.coerce
    .number()
    .int()
    .min(1)
    .max(4096)
    .default(1536),
  [EnvKey.AI_SAFETY_FORBIDDEN_PATTERNS]: optionalString,

  // ── Mail (driver/host/port/from non-sensitive; user/pass sensitive) ──
  [EnvKey.MAIL_DRIVER]: z.enum(['log', 'smtp']).default('log'),
  [EnvKey.MAIL_HOST]: z.string().default('smtp.example.com'),
  [EnvKey.MAIL_PORT]: z.coerce.number().int().min(1).default(587),
  [EnvKey.MAIL_FROM]: z.string().default('noreply@example.com'),
  [EnvKey.MAIL_USER]: optionalString,
  [EnvKey.MAIL_PASS]: optionalString,
  [EnvKey.MAIL_QUEUE_MAX_ATTEMPTS]: z.coerce
    .number()
    .int()
    .min(1)
    .max(20)
    .default(3),
  [EnvKey.MAIL_QUEUE_BACKOFF_DELAY_MS]: z.coerce
    .number()
    .int()
    .min(100)
    .default(5000),
  [EnvKey.MAIL_QUEUE_WORKER_CONCURRENCY]: z.coerce
    .number()
    .int()
    .min(1)
    .max(50)
    .default(3),
  [EnvKey.MAIL_QUEUE_COMPLETE_AGE_SECONDS]: z.coerce
    .number()
    .int()
    .min(60)
    .default(86400),
  [EnvKey.MAIL_QUEUE_FAIL_AGE_SECONDS]: z.coerce
    .number()
    .int()
    .min(60)
    .default(604800),
  [EnvKey.MAIL_QUEUE_COMPLETE_MAX_COUNT]: z.coerce
    .number()
    .int()
    .min(1)
    .default(1000),
  [EnvKey.MAIL_QUEUE_FAIL_MAX_COUNT]: z.coerce
    .number()
    .int()
    .min(1)
    .default(5000),

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

  // ── Tencent COS (secrets in .env; region/expiry non-sensitive defaults) ──
  [EnvKey.TENCENT_COS_SECRET_ID]: optionalString,
  [EnvKey.TENCENT_COS_SECRET_KEY]: optionalString,
  [EnvKey.TENCENT_COS_BUCKET]: optionalString,
  [EnvKey.TENCENT_COS_PUBLIC_BASE_URL]: httpUrl,
  [EnvKey.TENCENT_COS_REGION]: z.string().default('ap-guangzhou'),
  [EnvKey.TENCENT_COS_UPLOAD_EXPIRES_SECONDS]: z.coerce
    .number()
    .int()
    .min(60)
    .default(600),
  [EnvKey.TENCENT_COS_MAX_UPLOAD_BYTES]: z.coerce
    .number()
    .int()
    .min(1)
    .default(10485760),
  [EnvKey.TENCENT_COS_DOWNLOAD_EXPIRES_SECONDS]: z.coerce
    .number()
    .int()
    .min(60)
    .default(600),

  // ── Storage provider selection ──────────────────────────────────
  [EnvKey.STORAGE_PROVIDER]: z
    .enum(['s3', 'tencent-cos', 'ali-oss'])
    .default('s3'),

  // ── Aliyun OSS dedicated SDK (secrets in .env; defaults inline) ──
  [EnvKey.ALIYUN_OSS_ACCESS_KEY_ID]: optionalString,
  [EnvKey.ALIYUN_OSS_ACCESS_KEY_SECRET]: optionalString,
  [EnvKey.ALIYUN_OSS_BUCKET]: z.string().default(''),
  [EnvKey.ALIYUN_OSS_REGION]: z.string().default('oss-cn-hangzhou'),
  [EnvKey.ALIYUN_OSS_ENDPOINT]: z.string().default(''),
  [EnvKey.ALIYUN_OSS_PUBLIC_BASE_URL]: httpUrl,
  [EnvKey.ALIYUN_OSS_UPLOAD_EXPIRES_SECONDS]: z.coerce
    .number()
    .int()
    .min(60)
    .default(600),
  [EnvKey.ALIYUN_OSS_MAX_UPLOAD_BYTES]: z.coerce
    .number()
    .int()
    .min(1)
    .default(10485760),
  [EnvKey.ALIYUN_OSS_DOWNLOAD_EXPIRES_SECONDS]: z.coerce
    .number()
    .int()
    .min(60)
    .default(600),

  // ── S3 storage (secrets in .env; endpoint/region/expiry defaults) ──
  [EnvKey.STORAGE_S3_ENDPOINT]: z.string().default(''),
  [EnvKey.STORAGE_S3_CLIENT_ENDPOINT]: z.string().default(''),
  [EnvKey.STORAGE_S3_EXTERNAL_ENDPOINT]: z.string().default(''),
  [EnvKey.STORAGE_S3_PUBLIC_BASE_URL]: z.string().default(''),
  [EnvKey.STORAGE_S3_ACCESS_KEY]: optionalString,
  [EnvKey.STORAGE_S3_SECRET_KEY]: optionalString,
  [EnvKey.STORAGE_S3_BUCKET]: z.string().default(''),
  [EnvKey.STORAGE_S3_REGION]: z.string().default('us-east-1'),
  [EnvKey.STORAGE_S3_UPLOAD_EXPIRES_SECONDS]: z.coerce
    .number()
    .int()
    .min(60)
    .default(600),
  [EnvKey.STORAGE_S3_MAX_UPLOAD_BYTES]: z.coerce
    .number()
    .int()
    .min(1)
    .default(10485760),
  [EnvKey.STORAGE_S3_DOWNLOAD_EXPIRES_SECONDS]: z.coerce
    .number()
    .int()
    .min(60)
    .default(600),

  // ── JPush (secrets in .env; apns/apiBaseUrl non-sensitive defaults) ──
  [EnvKey.JPUSH_APP_KEY]: optionalString,
  [EnvKey.JPUSH_MASTER_SECRET]: optionalString,
  [EnvKey.JPUSH_APNS_PRODUCTION]: z.enum(['true', 'false']).default('false'),
  [EnvKey.JPUSH_API_BASE_URL]: z.string().default('https://api.jpush.cn'),

  // ── Metrics auth (sensitive, in .env) ────────────────────────────
  [EnvKey.METRICS_USER]: optionalString,
  [EnvKey.METRICS_PASSWORD]: optionalString,

  // ── Testing (sensitive, in .env) ────────────────────────────────
  [EnvKey.TESTING_SHARED_SECRET]: optionalString,

  // ── Client operations (in .env) ─────────────────────────────────
  [EnvKey.SUPPORT_EMAIL]: z.email().optional(),
  [EnvKey.MIN_CLIENT_VERSION]: optionalString,
  [EnvKey.LATEST_VERSION]: optionalString,
  [EnvKey.DOWNLOAD_URL]: optionalString,

  // ── Meal analysis thresholds (non-sensitive, defaults) ──────────
  [EnvKey.MEAL_DEFAULT_PORTION_GRAMS]: z.coerce
    .number()
    .int()
    .min(1)
    .max(10000)
    .default(100),
  [EnvKey.MEAL_SMALL_PORTION_GRAMS]: z.coerce
    .number()
    .int()
    .min(1)
    .max(10000)
    .default(30),
  [EnvKey.MEAL_HIGH_PROTEIN_THRESHOLD_G]: z.coerce
    .number()
    .int()
    .min(0)
    .max(500)
    .default(20),
  [EnvKey.MEAL_LOW_CARBOHYDRATE_THRESHOLD_G]: z.coerce
    .number()
    .int()
    .min(0)
    .max(500)
    .default(20),
  [EnvKey.MEAL_HIGH_FAT_THRESHOLD_G]: z.coerce
    .number()
    .int()
    .min(0)
    .max(500)
    .default(20),

  // ── Fuzzy matching (non-sensitive, defaults) ────────────────────
  [EnvKey.FUZZY_ACCEPT_SCORE]: z.coerce.number().min(0).max(1).default(0.7),
  [EnvKey.FUZZY_MIN_LEAD]: z.coerce.number().min(0).max(1).default(0.1),
  [EnvKey.FUZZY_QUERY_PREFIX_LENGTH]: z.coerce
    .number()
    .int()
    .min(1)
    .max(10)
    .default(1),

  // ── Verification codes (non-sensitive, defaults) ────────────────
  [EnvKey.VERIFICATION_CODE_TTL_MS]: z.coerce
    .number()
    .int()
    .min(1)
    .default(300000),
  [EnvKey.VERIFICATION_COOLDOWN_MS]: z.coerce
    .number()
    .int()
    .min(0)
    .default(60000),
  [EnvKey.VERIFICATION_RATE_LIMIT_WINDOW_MS]: z.coerce
    .number()
    .int()
    .min(1)
    .default(600000),
  [EnvKey.VERIFICATION_RATE_LIMIT_MAX]: z.coerce
    .number()
    .int()
    .min(1)
    .default(20),
  [EnvKey.VERIFICATION_CODE_LENGTH]: z.coerce
    .number()
    .int()
    .min(4)
    .max(10)
    .default(6),

  // ── OAuth state TTL (non-sensitive, default) ────────────────────
  [EnvKey.OAUTH_STATE_TTL_MS]: z.coerce.number().int().min(1).default(600000),
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
 * `process.env`. Non-sensitive runtime configuration is read directly
 * from `process.env` by the config services with hardcoded defaults.
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
  ].filter((key) => !config[key]);

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
