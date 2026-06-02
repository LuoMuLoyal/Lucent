import type { Request, Response, NextFunction } from 'express';
import type { INestApplication, ValidationError } from '@nestjs/common';
import {
  BadRequestException,
  Logger,
  ValidationPipe,
  VersioningType,
} from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { ConfigKey } from './config/config-keys.enum';
import { ResultCode } from './common/api-envelope';
import { ApiExceptionFilter } from './common/filters/api-exception.filter';
import { ApiEnvelopeInterceptor } from './common/interceptors/api-envelope.interceptor';
import { requestIdMiddleware } from './common/middleware/request-id.middleware';

export function setupApp(
  app: INestApplication,
  configService: ConfigService,
): void {
  app.use(requestIdMiddleware);

  const logger = new Logger('HTTP');
  app.use((req: Request, res: Response, next: NextFunction) => {
    const start = Date.now();
    res.on('finish', () => {
      const duration = Date.now() - start;
      logger.log(
        `${req.method} ${req.originalUrl || req.url} ${String(res.statusCode)} ${String(duration)}ms`,
      );
    });
    next();
  });

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
  app.useGlobalInterceptors(new ApiEnvelopeInterceptor());
  app.useGlobalFilters(new ApiExceptionFilter());

  app.enableCors({
    origin: configService.get<boolean | string[]>(
      `${ConfigKey.App}.corsOrigin`,
      false,
    ),
  });

  // ── Swagger / OpenAPI ──────────────────────────────────────────
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
  SwaggerModule.setup('api/docs', app, document);
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
