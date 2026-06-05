import Joi from 'joi';
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
  [EnvKey.DATABASE_URL]?: string;
  [EnvKey.REDIS_URL]?: string;
  [EnvKey.JWT_ACCESS_SECRET]?: string;
  [EnvKey.JWT_REFRESH_SECRET]?: string;
  [EnvKey.JWT_ACCESS_TTL]?: string;
  [EnvKey.JWT_REFRESH_TTL]?: string;
  [EnvKey.AI_PROVIDER]?: string;
  [EnvKey.AI_API_KEY]?: string;
  [EnvKey.AI_BASE_URL]?: string;
  [EnvKey.AI_TEXT_MODEL]?: string;
  [EnvKey.AI_VISION_MODEL]?: string;
  [EnvKey.LOG_LEVEL]?: string;

  // ── Mail ─────────────────────────────────────────────────────
  [EnvKey.MAIL_DRIVER]?: string;
  [EnvKey.MAIL_HOST]?: string;
  [EnvKey.MAIL_PORT]?: number;
  [EnvKey.MAIL_USER]?: string;
  [EnvKey.MAIL_PASS]?: string;
  [EnvKey.MAIL_FROM]?: string;

  // ── OAuth ────────────────────────────────────────────────────
  [EnvKey.WECHAT_WEB_APP_ID]?: string;
  [EnvKey.WECHAT_WEB_APP_SECRET]?: string;
  [EnvKey.WECHAT_WEB_REDIRECT_URI]?: string;
  [EnvKey.WECHAT_MOBILE_APP_ID]?: string;
  [EnvKey.WECHAT_MOBILE_APP_SECRET]?: string;
}

const envSchema = Joi.object<EnvironmentVariables>({
  [EnvKey.NODE_ENV]: Joi.string()
    .valid(...Object.values(NodeEnvironment))
    .default(NodeEnvironment.Development),

  [EnvKey.HOST]: Joi.string().default('0.0.0.0'),

  [EnvKey.PORT]: Joi.number().integer().min(1).default(3000),

  [EnvKey.CORS_ORIGIN]: Joi.string().default('*'),

  [EnvKey.DATABASE_URL]: Joi.string()
    .uri({ scheme: ['postgres', 'postgresql'] })
    .optional(),

  [EnvKey.REDIS_URL]: Joi.string()
    .uri({ scheme: ['redis', 'rediss'] })
    .optional(),

  [EnvKey.JWT_ACCESS_SECRET]: Joi.string().optional(),

  [EnvKey.JWT_REFRESH_SECRET]: Joi.string().optional(),

  [EnvKey.JWT_ACCESS_TTL]: Joi.string().optional(),

  [EnvKey.JWT_REFRESH_TTL]: Joi.string().optional(),

  [EnvKey.AI_PROVIDER]: Joi.string().allow('').optional(),

  [EnvKey.AI_API_KEY]: Joi.string().allow('').optional(),

  [EnvKey.AI_BASE_URL]: Joi.string().uri().allow('').optional(),

  [EnvKey.AI_TEXT_MODEL]: Joi.string().allow('').optional(),

  [EnvKey.AI_VISION_MODEL]: Joi.string().allow('').optional(),

  [EnvKey.LOG_LEVEL]: Joi.string()
    .valid('debug', 'info', 'warn', 'error')
    .default('debug'),

  // ── Mail ─────────────────────────────────────────────────────
  [EnvKey.MAIL_DRIVER]: Joi.string().valid('log', 'smtp').default('log'),

  [EnvKey.MAIL_HOST]: Joi.string().optional(),

  [EnvKey.MAIL_PORT]: Joi.number().integer().min(1).optional(),

  [EnvKey.MAIL_USER]: Joi.string().allow('').optional(),

  [EnvKey.MAIL_PASS]: Joi.string().allow('').optional(),

  [EnvKey.MAIL_FROM]: Joi.string().allow('').optional(),

  // ── OAuth ────────────────────────────────────────────────────
  [EnvKey.WECHAT_WEB_APP_ID]: Joi.string().allow('').optional(),

  [EnvKey.WECHAT_WEB_APP_SECRET]: Joi.string().allow('').optional(),

  [EnvKey.WECHAT_WEB_REDIRECT_URI]: Joi.string().uri().allow('').optional(),

  [EnvKey.WECHAT_MOBILE_APP_ID]: Joi.string().allow('').optional(),

  [EnvKey.WECHAT_MOBILE_APP_SECRET]: Joi.string().allow('').optional(),
});

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
  ].filter((key) => !config[key]);

  if (missingKeys.length > 0) {
    throw new Error(
      `Missing required production environment variables: ${missingKeys.join(', ')}`,
    );
  }

  const corsOrigin = config[EnvKey.CORS_ORIGIN];
  if (!corsOrigin || corsOrigin.trim() === '*') {
    throw new Error('CORS_ORIGIN must be explicit in production (not *)');
  }
}
