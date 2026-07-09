import type { INestApplication, ValidationError } from '@nestjs/common';
import {
  BadRequestException,
  ValidationPipe,
  VersioningType,
} from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { apiReference } from '@scalar/nestjs-api-reference';
import { LoggerErrorInterceptor } from 'nestjs-pino';
import { ConfigKey } from './config/config-keys.enum';
import { ResultCode } from './common/api';
import { ApiExceptionFilter } from './common/filters/api-exception.filter';
import { ApiEnvelopeInterceptor } from './common/interceptors/api-envelope.interceptor';
import { SlowRequestInterceptor } from './common/interceptors/slow-request.interceptor';
import { requestIdMiddleware } from './common/middleware/request-id.middleware';
import { bindRequestContextMiddleware } from './common/logger/request-context.middleware';
import { RequestContextService } from './common/logger/request-context.service';

/**
 * Configures the NestJS application with global middleware, pipes, filters,
 * interceptors, API versioning, CORS, and OpenAPI documentation.
 */
export function setupApp(
  app: INestApplication,
  configService: ConfigService,
): void {
  app.use(requestIdMiddleware);
  app.use(bindRequestContextMiddleware(app.get(RequestContextService)));

  app.setGlobalPrefix('api');
  app.enableVersioning({
    type: VersioningType.URI,
    defaultVersion: '1',
  });
  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
      exceptionFactory: (errors: ValidationError[]) =>
        new BadRequestException({
          code: ResultCode.VALIDATION_FAILED,
          message: formatValidationErrors(errors),
        }),
    }),
  );
  app.useGlobalInterceptors(
    new LoggerErrorInterceptor(),
    app.get(SlowRequestInterceptor),
    new ApiEnvelopeInterceptor(),
  );
  app.useGlobalFilters(app.get(ApiExceptionFilter));

  app.enableCors({
    origin: configService.get<boolean | string[]>(
      `${ConfigKey.App}.corsOrigin`,
      false,
    ),
  });

  // ── Scalar API Reference ───────────────────────────────────────
  const swaggerConfig = new DocumentBuilder()
    .setTitle('Lucent API')
    .setDescription('Lucent 后端 API 文档')
    .setVersion('1.0')
    .addBearerAuth(
      {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        description: '输入 accessToken',
      },
      'access-token',
    )
    .build();

  const document = SwaggerModule.createDocument(app, swaggerConfig);
  app.use(
    '/api/docs',
    apiReference({
      spec: { content: document },
      theme: 'purple',
      _integration: 'nestjs',
    }),
  );
}

function formatValidationErrors(errors: ValidationError[]): string {
  return errors.flatMap(collectValidationMessages).join('; ');
}

function collectValidationMessages(error: ValidationError): string[] {
  const currentMessages = Object.values(error.constraints ?? {});
  const childMessages = (error.children ?? []).flatMap(
    collectValidationMessages,
  );
  return [...currentMessages, ...childMessages];
}
