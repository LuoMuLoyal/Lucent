import { plainToInstance } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Min,
  validateSync,
} from 'class-validator';

enum NodeEnvironment {
  Development = 'development',
  Test = 'test',
  Production = 'production',
}

class EnvironmentVariables {
  @IsEnum(NodeEnvironment)
  NODE_ENV: NodeEnvironment = NodeEnvironment.Development;

  @IsString()
  HOST = '0.0.0.0';

  @IsInt()
  @Min(1)
  PORT = 3000;

  @IsString()
  CORS_ORIGIN = '*';

  @IsOptional()
  @IsString()
  DATABASE_URL?: string;

  @IsOptional()
  @IsString()
  REDIS_URL?: string;

  @IsOptional()
  @IsString()
  JWT_ACCESS_SECRET?: string;

  @IsOptional()
  @IsString()
  JWT_REFRESH_SECRET?: string;

  @IsOptional()
  @IsString()
  JWT_ACCESS_TTL?: string;

  @IsOptional()
  @IsString()
  JWT_REFRESH_TTL?: string;

  @IsOptional()
  @IsString()
  AI_PROVIDER?: string;

  @IsOptional()
  @IsString()
  AI_API_KEY?: string;

  @IsOptional()
  @IsString()
  AI_BASE_URL?: string;

  @IsOptional()
  @IsString()
  AI_TEXT_MODEL?: string;

  @IsOptional()
  @IsString()
  AI_VISION_MODEL?: string;
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
    'DATABASE_URL',
    'REDIS_URL',
    'JWT_ACCESS_SECRET',
    'JWT_REFRESH_SECRET',
  ].filter((key) => !config[key as keyof EnvironmentVariables]);

  if (missingKeys.length > 0) {
    throw new Error(
      `Missing required production environment variables: ${missingKeys.join(', ')}`,
    );
  }

  if (!config.CORS_ORIGIN || config.CORS_ORIGIN.trim() === '*') {
    throw new Error('CORS_ORIGIN must be explicit in production');
  }
}
