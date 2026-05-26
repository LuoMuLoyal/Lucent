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
}

const envSchema = Joi.object<EnvironmentVariables>({
  [EnvKey.NODE_ENV]: Joi.string()
    .valid(...Object.values(NodeEnvironment))
    .default(NodeEnvironment.Development),

  [EnvKey.HOST]: Joi.string().default('0.0.0.0'),

  [EnvKey.PORT]: Joi.number().integer().min(1).default(3000),

  [EnvKey.CORS_ORIGIN]: Joi.string().default('*'),

  [EnvKey.DATABASE_URL]: Joi.string()
    .uri({ scheme: /^postgres/ })
    .optional(),

  [EnvKey.REDIS_URL]: Joi.string()
    .uri({ scheme: /^redis/ })
    .optional(),

  [EnvKey.JWT_ACCESS_SECRET]: Joi.string().optional(),

  [EnvKey.JWT_REFRESH_SECRET]: Joi.string().optional(),

  [EnvKey.JWT_ACCESS_TTL]: Joi.string().optional(),

  [EnvKey.JWT_REFRESH_TTL]: Joi.string().optional(),

  [EnvKey.AI_PROVIDER]: Joi.string().optional(),

  [EnvKey.AI_API_KEY]: Joi.string().optional(),

  [EnvKey.AI_BASE_URL]: Joi.string().uri().optional(),

  [EnvKey.AI_TEXT_MODEL]: Joi.string().optional(),

  [EnvKey.AI_VISION_MODEL]: Joi.string().optional(),

  [EnvKey.LOG_LEVEL]: Joi.string()
    .valid('debug', 'info', 'warn', 'error')
    .default('debug'),
});

export function validateEnvironment(
  config: Record<string, unknown>,
): EnvironmentVariables {
  const { value, error } = envSchema.validate(config, {
    allowUnknown: true,
    stripUnknown: false,
  });

  if (error) {
    throw new Error(`Environment validation failed: ${error.message}`);
  }

  const validated = value as EnvironmentVariables;

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
