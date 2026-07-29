import { z } from 'zod';
import {
  DEFAULT_COS_MAX_UPLOAD_BYTES,
  DEFAULT_COS_UPLOAD_EXPIRY_SECONDS,
  DEFAULT_EMBEDDING_DIMENSION,
  DEFAULT_FUZZY_ACCEPT_SCORE,
  DEFAULT_FUZZY_MIN_LEAD,
  DEFAULT_FUZZY_QUERY_PREFIX_LENGTH,
  DEFAULT_SLOW_REQUEST_THRESHOLD_MS,
  DEFAULT_SLOW_QUERY_THRESHOLD_MS,
  DEFAULT_MAIL_QUEUE_BACKOFF_DELAY_MS,
  DEFAULT_MAIL_QUEUE_COMPLETE_AGE_SECONDS,
  DEFAULT_MAIL_QUEUE_COMPLETE_MAX_COUNT,
  DEFAULT_MAIL_QUEUE_FAIL_AGE_SECONDS,
  DEFAULT_MAIL_QUEUE_FAIL_MAX_COUNT,
  DEFAULT_MAIL_QUEUE_MAX_ATTEMPTS,
  DEFAULT_MAIL_QUEUE_WORKER_CONCURRENCY,
  DEFAULT_MEAL_HIGH_FAT_THRESHOLD_G,
  DEFAULT_MEAL_HIGH_PROTEIN_THRESHOLD_G,
  DEFAULT_MEAL_LOW_CARBOHYDRATE_THRESHOLD_G,
  DEFAULT_MEAL_PORTION_GRAMS,
  DEFAULT_MEAL_SMALL_PORTION_GRAMS,
  DEFAULT_OAUTH_STATE_TTL_MS,
  DEFAULT_VERIFICATION_CODE_LENGTH,
  DEFAULT_VERIFICATION_CODE_TTL_MS,
  DEFAULT_VERIFICATION_COOLDOWN_MS,
  DEFAULT_VERIFICATION_RATE_LIMIT_MAX,
  DEFAULT_VERIFICATION_RATE_LIMIT_WINDOW_MS,
  MAX_COS_MAX_UPLOAD_BYTES,
  MAX_COS_UPLOAD_EXPIRY_SECONDS,
  MAX_EMBEDDING_DIMENSION,
} from '../constants';
import { EnvKey } from './env-keys.enum';

/** Supported runtime environments. */
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

const envSchema = z.object({
  [EnvKey.NODE_ENV]: z
    .enum([
      NodeEnvironment.Development,
      NodeEnvironment.Test,
      NodeEnvironment.Production,
    ])
    .default(NodeEnvironment.Development),

  // HOST is resolved in validateEnvironment based on NODE_ENV.
  [EnvKey.HOST]: z.string().optional(),

  [EnvKey.PORT]: z.coerce.number().int().min(1).default(3000),
  [EnvKey.CORS_ORIGIN]: z.string().default(''),
  [EnvKey.TRUST_PROXY]: z.enum(['true', 'false']).optional(),
  [EnvKey.DATABASE_URL]: postgresUrl,
  [EnvKey.PUBLIC_BASE_URL]: optionalUri,
  [EnvKey.REDIS_URL]: redisUrl,

  [EnvKey.JWT_ACCESS_SECRET]: z.string().min(32),
  [EnvKey.JWT_REFRESH_SECRET]: z.string().min(32),
  [EnvKey.JWT_ACCESS_TTL]: optionalString,
  [EnvKey.JWT_REFRESH_TTL]: optionalString,
  [EnvKey.JWT_ISSUER]: optionalString,
  [EnvKey.JWT_AUDIENCE]: optionalString,

  [EnvKey.ADMIN_EMAIL]: z.email(),
  [EnvKey.ADMIN_PASSWORD]: z.string().min(8),
  [EnvKey.ADMIN_COOKIE_SECRET]: z.string().min(32),

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
    .max(MAX_EMBEDDING_DIMENSION)
    .default(DEFAULT_EMBEDDING_DIMENSION),
  [EnvKey.AI_SAFETY_FORBIDDEN_PATTERNS]: optionalString,

  [EnvKey.LOG_LEVEL]: z
    .enum(['error', 'warn', 'info', 'debug', 'verbose'])
    .default('debug'),
  [EnvKey.LOG_FORMAT]: z.enum(['pretty', 'json']).optional(),

  [EnvKey.MAIL_DRIVER]: z.enum(['log', 'smtp']).default('log'),
  [EnvKey.MAIL_HOST]: optionalString,
  [EnvKey.MAIL_PORT]: z.coerce.number().int().min(1).optional(),
  [EnvKey.MAIL_USER]: optionalString,
  [EnvKey.MAIL_PASS]: optionalString,
  [EnvKey.MAIL_FROM]: optionalString,

  [EnvKey.WECHAT_WEB_APP_ID]: optionalString,
  [EnvKey.WECHAT_WEB_APP_SECRET]: optionalString,
  [EnvKey.WECHAT_WEB_REDIRECT_URI]: optionalEmptyUri,
  [EnvKey.WECHAT_MOBILE_APP_ID]: optionalString,
  [EnvKey.WECHAT_MOBILE_APP_SECRET]: optionalString,

  [EnvKey.APPLE_APP_ID]: optionalString,
  [EnvKey.QQ_APP_ID]: optionalString,
  [EnvKey.QQ_APP_SECRET]: optionalString,
  [EnvKey.QQ_REDIRECT_URI]: optionalUri,

  [EnvKey.TENCENT_COS_SECRET_ID]: optionalString,
  [EnvKey.TENCENT_COS_SECRET_KEY]: optionalString,
  [EnvKey.TENCENT_COS_BUCKET]: optionalString,
  [EnvKey.TENCENT_COS_REGION]: optionalString,
  [EnvKey.TENCENT_COS_PUBLIC_BASE_URL]: httpUrl,
  [EnvKey.TENCENT_COS_UPLOAD_EXPIRES_SECONDS]: z.coerce
    .number()
    .int()
    .min(60)
    .max(MAX_COS_UPLOAD_EXPIRY_SECONDS)
    .default(DEFAULT_COS_UPLOAD_EXPIRY_SECONDS),
  [EnvKey.TENCENT_COS_MAX_UPLOAD_BYTES]: z.coerce
    .number()
    .int()
    .min(1)
    .max(MAX_COS_MAX_UPLOAD_BYTES)
    .default(DEFAULT_COS_MAX_UPLOAD_BYTES),
  [EnvKey.TENCENT_COS_DOWNLOAD_EXPIRES_SECONDS]: z.coerce
    .number()
    .int()
    .min(60)
    .max(MAX_COS_UPLOAD_EXPIRY_SECONDS)
    .default(DEFAULT_COS_UPLOAD_EXPIRY_SECONDS),

  [EnvKey.OPENAPI_EXPORT_SKIP_DB_CONNECT]: z.enum(['true', 'false']).optional(),

  [EnvKey.MEAL_DEFAULT_PORTION_GRAMS]: z.coerce
    .number()
    .int()
    .min(1)
    .max(10000)
    .default(DEFAULT_MEAL_PORTION_GRAMS),
  [EnvKey.MEAL_SMALL_PORTION_GRAMS]: z.coerce
    .number()
    .int()
    .min(1)
    .max(10000)
    .default(DEFAULT_MEAL_SMALL_PORTION_GRAMS),
  [EnvKey.MEAL_HIGH_PROTEIN_THRESHOLD_G]: z.coerce
    .number()
    .int()
    .min(0)
    .max(500)
    .default(DEFAULT_MEAL_HIGH_PROTEIN_THRESHOLD_G),
  [EnvKey.MEAL_LOW_CARBOHYDRATE_THRESHOLD_G]: z.coerce
    .number()
    .int()
    .min(0)
    .max(500)
    .default(DEFAULT_MEAL_LOW_CARBOHYDRATE_THRESHOLD_G),
  [EnvKey.MEAL_HIGH_FAT_THRESHOLD_G]: z.coerce
    .number()
    .int()
    .min(0)
    .max(500)
    .default(DEFAULT_MEAL_HIGH_FAT_THRESHOLD_G),

  [EnvKey.FUZZY_ACCEPT_SCORE]: z.coerce
    .number()
    .min(0)
    .max(1)
    .default(DEFAULT_FUZZY_ACCEPT_SCORE),
  [EnvKey.FUZZY_MIN_LEAD]: z.coerce
    .number()
    .min(0)
    .max(1)
    .default(DEFAULT_FUZZY_MIN_LEAD),
  [EnvKey.FUZZY_QUERY_PREFIX_LENGTH]: z.coerce
    .number()
    .int()
    .min(1)
    .max(10)
    .default(DEFAULT_FUZZY_QUERY_PREFIX_LENGTH),

  [EnvKey.VERIFICATION_CODE_TTL_MS]: z.coerce
    .number()
    .int()
    .min(10_000)
    .max(3_600_000)
    .default(DEFAULT_VERIFICATION_CODE_TTL_MS),
  [EnvKey.VERIFICATION_COOLDOWN_MS]: z.coerce
    .number()
    .int()
    .min(0)
    .max(3_600_000)
    .default(DEFAULT_VERIFICATION_COOLDOWN_MS),
  [EnvKey.VERIFICATION_RATE_LIMIT_WINDOW_MS]: z.coerce
    .number()
    .int()
    .min(60_000)
    .max(86_400_000)
    .default(DEFAULT_VERIFICATION_RATE_LIMIT_WINDOW_MS),
  [EnvKey.VERIFICATION_RATE_LIMIT_MAX]: z.coerce
    .number()
    .int()
    .min(1)
    .max(1_000)
    .default(DEFAULT_VERIFICATION_RATE_LIMIT_MAX),
  [EnvKey.VERIFICATION_CODE_LENGTH]: z.coerce
    .number()
    .int()
    .min(4)
    .max(10)
    .default(DEFAULT_VERIFICATION_CODE_LENGTH),
  [EnvKey.OAUTH_STATE_TTL_MS]: z.coerce
    .number()
    .int()
    .min(60_000)
    .max(3_600_000)
    .default(DEFAULT_OAUTH_STATE_TTL_MS),

  [EnvKey.MAIL_QUEUE_MAX_ATTEMPTS]: z.coerce
    .number()
    .int()
    .min(1)
    .max(20)
    .default(DEFAULT_MAIL_QUEUE_MAX_ATTEMPTS),
  [EnvKey.MAIL_QUEUE_BACKOFF_DELAY_MS]: z.coerce
    .number()
    .int()
    .min(100)
    .max(300_000)
    .default(DEFAULT_MAIL_QUEUE_BACKOFF_DELAY_MS),
  [EnvKey.MAIL_QUEUE_WORKER_CONCURRENCY]: z.coerce
    .number()
    .int()
    .min(1)
    .max(50)
    .default(DEFAULT_MAIL_QUEUE_WORKER_CONCURRENCY),
  [EnvKey.MAIL_QUEUE_COMPLETE_AGE_SECONDS]: z.coerce
    .number()
    .int()
    .min(60)
    .max(2_592_000)
    .default(DEFAULT_MAIL_QUEUE_COMPLETE_AGE_SECONDS),
  [EnvKey.MAIL_QUEUE_FAIL_AGE_SECONDS]: z.coerce
    .number()
    .int()
    .min(60)
    .max(2_592_000)
    .default(DEFAULT_MAIL_QUEUE_FAIL_AGE_SECONDS),
  [EnvKey.MAIL_QUEUE_COMPLETE_MAX_COUNT]: z.coerce
    .number()
    .int()
    .min(1)
    .max(1_000_000)
    .default(DEFAULT_MAIL_QUEUE_COMPLETE_MAX_COUNT),
  [EnvKey.MAIL_QUEUE_FAIL_MAX_COUNT]: z.coerce
    .number()
    .int()
    .min(1)
    .max(1_000_000)
    .default(DEFAULT_MAIL_QUEUE_FAIL_MAX_COUNT),

  [EnvKey.SLOW_REQUEST_THRESHOLD_MS]: z.coerce
    .number()
    .int()
    .min(10)
    .max(300_000)
    .default(DEFAULT_SLOW_REQUEST_THRESHOLD_MS),

  [EnvKey.SLOW_QUERY_THRESHOLD_MS]: z.coerce
    .number()
    .int()
    .min(10)
    .max(60_000)
    .default(DEFAULT_SLOW_QUERY_THRESHOLD_MS),

  [EnvKey.METRICS_ENABLED]: z.enum(['true', 'false']).default('true'),
  [EnvKey.METRICS_USER]: optionalString,
  [EnvKey.METRICS_PASSWORD]: optionalString,
  [EnvKey.TESTING_SHARED_SECRET]: optionalString,

  [EnvKey.SUPPORT_EMAIL]: z.email().optional(),
  [EnvKey.MIN_CLIENT_VERSION]: optionalString,
  [EnvKey.LATEST_VERSION]: optionalString,
  [EnvKey.DOWNLOAD_URL]: optionalString,
});

/** Strongly typed shape of validated environment variables. */
export type EnvironmentVariables = z.infer<typeof envSchema>;

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
 * @throws {Error} When a required or invalid value is detected.
 */
export function validateEnvironment(
  config: Record<string, unknown>,
): EnvironmentVariables {
  const parsed = envSchema.safeParse(config);

  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `${i.path.join('.')}: ${i.message}`)
      .join('; ');
    throw new Error(`Environment validation failed: ${issues}`);
  }

  const validated = parsed.data;

  // Resolve HOST default based on NODE_ENV (replaces Joi.when).
  if (validated[EnvKey.HOST] == null) {
    validated[EnvKey.HOST] =
      validated[EnvKey.NODE_ENV] === NodeEnvironment.Production
        ? '127.0.0.1'
        : '0.0.0.0';
  }

  assertProductionEnvironment(validated);
  assertTencentCosEnvironment(validated);
  assertAiEnvironment(validated);

  return validated;
}

function assertProductionEnvironment(config: EnvironmentVariables): void {
  if (config[EnvKey.NODE_ENV] !== NodeEnvironment.Production) {
    return;
  }

  const missingKeys = [
    EnvKey.DATABASE_URL,
    EnvKey.REDIS_URL,
    EnvKey.JWT_ACCESS_SECRET,
    EnvKey.JWT_REFRESH_SECRET,
    EnvKey.ADMIN_EMAIL,
    EnvKey.ADMIN_PASSWORD,
    EnvKey.ADMIN_COOKIE_SECRET,
  ].filter((key) => !config[key]);

  if (missingKeys.length > 0) {
    throw new Error(
      `Missing required production environment variables: ${missingKeys.join(', ')}`,
    );
  }

  const corsOrigin = config[EnvKey.CORS_ORIGIN].trim();
  if (corsOrigin === '*') {
    throw new Error('CORS_ORIGIN must not be * in production');
  }

  // NOTE: REDIS_URL is required in production (checked above) for the BullMQ
  // queues, not for rate limiting. Rate limiting (ThrottlerModule in
  // app.module.ts) intentionally uses in-process memory storage, which is
  // sufficient for the single-instance deployment; counters reset on restart.
}

function assertTencentCosEnvironment(config: EnvironmentVariables): void {
  const requiredKeys = [
    EnvKey.TENCENT_COS_SECRET_ID,
    EnvKey.TENCENT_COS_SECRET_KEY,
    EnvKey.TENCENT_COS_BUCKET,
    EnvKey.TENCENT_COS_REGION,
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
    throw new Error(
      `Incomplete Tencent COS environment variables: ${missingKeys.join(', ')}`,
    );
  }
}

function assertAiEnvironment(config: EnvironmentVariables): void {
  const provider = (config[EnvKey.AI_PROVIDER] ?? '').trim();
  const hasAnyAiRoleConfig = AI_ROLE_GROUPS.some((group) =>
    group.keys.some((key) => (config[key] ?? '').trim()),
  );

  if (!provider && !hasAnyAiRoleConfig) {
    return;
  }

  if (!provider) {
    throw new Error(
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
      throw new Error(
        `Incomplete AI ${group.name} configuration: ${missingKeys.join(', ')}`,
      );
    }
  }
}
