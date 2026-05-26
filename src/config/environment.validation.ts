import { plainToInstance } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Min,
  validateSync,
} from 'class-validator';
import { EnvKey } from './env-keys.enum';

export enum NodeEnvironment {
  Development = 'development',
  Test = 'test',
  Production = 'production',
}

class EnvironmentVariables {
  @IsEnum(NodeEnvironment)
  [EnvKey.NODE_ENV]: NodeEnvironment = NodeEnvironment.Development;

  @IsString()
  [EnvKey.HOST] = '0.0.0.0';

  @IsInt()
  @Min(1)
  [EnvKey.PORT] = 3000;

  @IsString()
  [EnvKey.CORS_ORIGIN] = '*';

  @IsOptional()
  @IsString()
  [EnvKey.DATABASE_URL]?: string;

  @IsOptional()
  @IsString()
  [EnvKey.REDIS_URL]?: string;

  @IsOptional()
  @IsString()
  [EnvKey.JWT_ACCESS_SECRET]?: string;

  @IsOptional()
  @IsString()
  [EnvKey.JWT_REFRESH_SECRET]?: string;

  @IsOptional()
  @IsString()
  [EnvKey.JWT_ACCESS_TTL]?: string;

  @IsOptional()
  @IsString()
  [EnvKey.JWT_REFRESH_TTL]?: string;

  @IsOptional()
  @IsString()
  [EnvKey.AI_PROVIDER]?: string;

  @IsOptional()
  @IsString()
  [EnvKey.AI_API_KEY]?: string;

  @IsOptional()
  @IsString()
  [EnvKey.AI_BASE_URL]?: string;

  @IsOptional()
  @IsString()
  [EnvKey.AI_TEXT_MODEL]?: string;

  @IsOptional()
  @IsString()
  [EnvKey.AI_VISION_MODEL]?: string;

  @IsOptional()
  @IsString()
  [EnvKey.LOG_LEVEL]?: string;
}

export function validateEnvironment(
  config: Record<string, unknown>,
): EnvironmentVariables {
  const validatedConfig = plainToInstance(EnvironmentVariables, config, {
    enableImplicitConversion: true,
  });
  const errors = validateSync(validatedConfig, {
    skipMissingProperties: false,
  });

  if (errors.length > 0) {
    throw new Error(errors.toString());
  }

  assertProductionEnvironment(validatedConfig);

  return validatedConfig;
}

function assertProductionEnvironment(config: EnvironmentVariables): void {
  if (config.NODE_ENV !== NodeEnvironment.Production) {
    return;
  }

  const missingKeys = [
    EnvKey.DATABASE_URL,
    EnvKey.REDIS_URL,
    EnvKey.JWT_ACCESS_SECRET,
    EnvKey.JWT_REFRESH_SECRET,
  ].filter((key) => !config[key as keyof EnvironmentVariables]);

  if (missingKeys.length > 0) {
    throw new Error(
      `Missing required production environment variables: ${missingKeys.join(', ')}`,
    );
  }

  const corsOrigin = config[EnvKey.CORS_ORIGIN] as string;
  if (!corsOrigin || corsOrigin.trim() === '*') {
    throw new Error('CORS_ORIGIN must be explicit in production');
  }
}
