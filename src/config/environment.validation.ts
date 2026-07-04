import Joi from 'joi';
import {
  DEFAULT_COS_MAX_UPLOAD_BYTES,
  DEFAULT_COS_UPLOAD_EXPIRY_SECONDS,
  DEFAULT_EMBEDDING_DIMENSION,
  MAX_COS_MAX_UPLOAD_BYTES,
  MAX_COS_UPLOAD_EXPIRY_SECONDS,
  MAX_EMBEDDING_DIMENSION,
} from './constants';
import { EnvKey } from './env-keys.enum';

export enum NodeEnvironment {
  Development = 'development',
  Test = 'test',
  Production = 'production',
}

export interface EnvironmentVariables {
  [EnvKey.NODE_ENV]: NodeEnvironment;
  [EnvKey.HOST]: string;
  [EnvKey.PORT]: number;
  [EnvKey.CORS_ORIGIN]: string;
  [EnvKey.TRUST_PROXY]?: string;
  [EnvKey.DATABASE_URL]?: string;
  [EnvKey.PUBLIC_BASE_URL]?: string;
  [EnvKey.REDIS_URL]?: string;
  [EnvKey.JWT_ACCESS_SECRET]: string;
  [EnvKey.JWT_REFRESH_SECRET]: string;
  [EnvKey.JWT_ACCESS_TTL]?: string;
  [EnvKey.JWT_REFRESH_TTL]?: string;
  [EnvKey.JWT_ISSUER]?: string;
  [EnvKey.JWT_AUDIENCE]?: string;
  [EnvKey.ADMIN_EMAIL]: string;
  [EnvKey.ADMIN_PASSWORD]: string;
  [EnvKey.ADMIN_COOKIE_SECRET]: string;
  [EnvKey.AI_PROVIDER]?: string;
  [EnvKey.AI_ANALYSIS_API_KEY]?: string;
  [EnvKey.AI_ANALYSIS_BASE_URL]?: string;
  [EnvKey.AI_ANALYSIS_MODEL]?: string;
  [EnvKey.AI_VISION_API_KEY]?: string;
  [EnvKey.AI_VISION_BASE_URL]?: string;
  [EnvKey.AI_VISION_MODEL]?: string;
  [EnvKey.AI_LANGUAGE_API_KEY]?: string;
  [EnvKey.AI_LANGUAGE_BASE_URL]?: string;
  [EnvKey.AI_LANGUAGE_MODEL]?: string;
  [EnvKey.AI_CHAT_API_KEY]?: string;
  [EnvKey.AI_CHAT_BASE_URL]?: string;
  [EnvKey.AI_CHAT_MODEL]?: string;
  [EnvKey.AI_CHAT_COMPRESSION_API_KEY]?: string;
  [EnvKey.AI_CHAT_COMPRESSION_BASE_URL]?: string;
  [EnvKey.AI_CHAT_COMPRESSION_MODEL]?: string;
  [EnvKey.AI_EMBEDDING_API_KEY]?: string;
  [EnvKey.AI_EMBEDDING_BASE_URL]?: string;
  [EnvKey.AI_EMBEDDING_MODEL]?: string;
  [EnvKey.AI_EMBEDDING_DIMENSION]?: number;
  [EnvKey.AI_SAFETY_FORBIDDEN_PATTERNS]?: string;
  [EnvKey.LOG_LEVEL]?: string;

  [EnvKey.MAIL_DRIVER]?: string;
  [EnvKey.MAIL_HOST]?: string;
  [EnvKey.MAIL_PORT]?: number;
  [EnvKey.MAIL_USER]?: string;
  [EnvKey.MAIL_PASS]?: string;
  [EnvKey.MAIL_FROM]?: string;

  [EnvKey.WECHAT_WEB_APP_ID]?: string;
  [EnvKey.WECHAT_WEB_APP_SECRET]?: string;
  [EnvKey.WECHAT_WEB_REDIRECT_URI]?: string;
  [EnvKey.WECHAT_MOBILE_APP_ID]?: string;
  [EnvKey.WECHAT_MOBILE_APP_SECRET]?: string;

  [EnvKey.APPLE_APP_ID]?: string;
  [EnvKey.QQ_APP_ID]?: string;
  [EnvKey.QQ_APP_SECRET]?: string;
  [EnvKey.QQ_REDIRECT_URI]?: string;

  [EnvKey.TENCENT_COS_SECRET_ID]?: string;
  [EnvKey.TENCENT_COS_SECRET_KEY]?: string;
  [EnvKey.TENCENT_COS_BUCKET]?: string;
  [EnvKey.TENCENT_COS_REGION]?: string;
  [EnvKey.TENCENT_COS_PUBLIC_BASE_URL]?: string;
  [EnvKey.TENCENT_COS_UPLOAD_EXPIRES_SECONDS]?: number;
  [EnvKey.TENCENT_COS_MAX_UPLOAD_BYTES]?: number;
  [EnvKey.TENCENT_COS_DOWNLOAD_EXPIRES_SECONDS]?: number;
  [EnvKey.OPENAPI_EXPORT_SKIP_DB_CONNECT]?: string;
}

const optionalString = Joi.string().allow('').optional();
const optionalUri = Joi.string().uri().allow('').optional();

const envSchema = Joi.object<EnvironmentVariables>({
  [EnvKey.NODE_ENV]: Joi.string()
    .valid(...Object.values(NodeEnvironment))
    .default(NodeEnvironment.Development),
  [EnvKey.HOST]: Joi.string().default('0.0.0.0'),
  [EnvKey.PORT]: Joi.number().integer().min(1).default(3000),
  [EnvKey.CORS_ORIGIN]: Joi.string().allow('').default(''),
  [EnvKey.TRUST_PROXY]: Joi.string().valid('true', 'false').optional(),
  [EnvKey.DATABASE_URL]: Joi.string()
    .uri({ scheme: ['postgres', 'postgresql'] })
    .optional(),
  [EnvKey.PUBLIC_BASE_URL]: Joi.string().uri().optional(),
  [EnvKey.REDIS_URL]: Joi.string()
    .uri({ scheme: ['redis', 'rediss'] })
    .optional(),
  [EnvKey.JWT_ACCESS_SECRET]: Joi.string().required(),
  [EnvKey.JWT_REFRESH_SECRET]: Joi.string().required(),
  [EnvKey.JWT_ACCESS_TTL]: Joi.string().optional(),
  [EnvKey.JWT_REFRESH_TTL]: Joi.string().optional(),
  [EnvKey.JWT_ISSUER]: Joi.string().allow('').optional(),
  [EnvKey.JWT_AUDIENCE]: Joi.string().allow('').optional(),
  [EnvKey.ADMIN_EMAIL]: Joi.string()
    .email({ tlds: { allow: false } })
    .required(),
  [EnvKey.ADMIN_PASSWORD]: Joi.string().min(8).required(),
  [EnvKey.ADMIN_COOKIE_SECRET]: Joi.string().min(32).required(),
  [EnvKey.AI_PROVIDER]: Joi.string()
    .valid('openai-compatible')
    .allow('')
    .optional(),
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
  [EnvKey.AI_EMBEDDING_DIMENSION]: Joi.number()
    .integer()
    .min(1)
    .max(MAX_EMBEDDING_DIMENSION)
    .default(DEFAULT_EMBEDDING_DIMENSION),
  [EnvKey.AI_SAFETY_FORBIDDEN_PATTERNS]: optionalString,
  [EnvKey.LOG_LEVEL]: Joi.string()
    .valid('debug', 'info', 'warn', 'error')
    .default('debug'),
  [EnvKey.MAIL_DRIVER]: Joi.string().valid('log', 'smtp').default('log'),
  [EnvKey.MAIL_HOST]: Joi.string().optional(),
  [EnvKey.MAIL_PORT]: Joi.number().integer().min(1).optional(),
  [EnvKey.MAIL_USER]: Joi.string().allow('').optional(),
  [EnvKey.MAIL_PASS]: Joi.string().allow('').optional(),
  [EnvKey.MAIL_FROM]: Joi.string().allow('').optional(),
  [EnvKey.WECHAT_WEB_APP_ID]: Joi.string().allow('').optional(),
  [EnvKey.WECHAT_WEB_APP_SECRET]: Joi.string().allow('').optional(),
  [EnvKey.WECHAT_WEB_REDIRECT_URI]: Joi.string().uri().allow('').optional(),
  [EnvKey.WECHAT_MOBILE_APP_ID]: Joi.string().allow('').optional(),
  [EnvKey.WECHAT_MOBILE_APP_SECRET]: Joi.string().allow('').optional(),
  [EnvKey.TENCENT_COS_SECRET_ID]: Joi.string().allow('').optional(),
  [EnvKey.TENCENT_COS_SECRET_KEY]: Joi.string().allow('').optional(),
  [EnvKey.TENCENT_COS_BUCKET]: Joi.string().allow('').optional(),
  [EnvKey.TENCENT_COS_REGION]: Joi.string().allow('').optional(),
  [EnvKey.TENCENT_COS_PUBLIC_BASE_URL]: Joi.string()
    .uri({ scheme: ['http', 'https'] })
    .allow('')
    .optional(),
  [EnvKey.TENCENT_COS_UPLOAD_EXPIRES_SECONDS]: Joi.number()
    .integer()
    .min(60)
    .max(MAX_COS_UPLOAD_EXPIRY_SECONDS)
    .default(DEFAULT_COS_UPLOAD_EXPIRY_SECONDS),
  [EnvKey.TENCENT_COS_MAX_UPLOAD_BYTES]: Joi.number()
    .integer()
    .min(1)
    .max(MAX_COS_MAX_UPLOAD_BYTES)
    .default(DEFAULT_COS_MAX_UPLOAD_BYTES),
  [EnvKey.TENCENT_COS_DOWNLOAD_EXPIRES_SECONDS]: Joi.number()
    .integer()
    .min(60)
    .max(MAX_COS_UPLOAD_EXPIRY_SECONDS)
    .default(DEFAULT_COS_UPLOAD_EXPIRY_SECONDS),
  [EnvKey.OPENAPI_EXPORT_SKIP_DB_CONNECT]: Joi.string()
    .valid('true', 'false')
    .optional(),
});

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

export function validateEnvironment(
  config: Record<string, unknown>,
): EnvironmentVariables {
  const { value, error } = envSchema.validate(config, {
    allowUnknown: true,
    stripUnknown: false,
  }) as { value: EnvironmentVariables; error: Joi.ValidationError | undefined };

  if (error) {
    throw new Error(`Environment validation failed: ${error.message}`);
  }

  const validated = value;

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
