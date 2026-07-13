import type { INestApplication, ValidationError } from '@nestjs/common';
import {
  BadRequestException,
  ValidationPipe,
  VersioningType,
} from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { Request, Response } from 'express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { apiReference } from '@scalar/nestjs-api-reference';
import helmet from 'helmet';
import { timingSafeEqual } from 'node:crypto';
import { ConfigKey } from './config/config-keys.enum';
import { ResultCode } from './common/api';
import { ApiExceptionFilter } from './common/filters/api-exception.filter';
import { ApiEnvelopeInterceptor } from './common/interceptors/api-envelope.interceptor';
import { SlowRequestInterceptor } from './common/interceptors/slow-request.interceptor';
import { requestIdMiddleware } from './common/middleware/request-id.middleware';
import { bindRequestContextMiddleware } from './common/logger/request-context.middleware';
import { RequestContextService } from './common/logger/request-context.service';
import { MetricsService } from './common/metrics/metrics.service';
import { createMetricsMiddleware } from './common/metrics/metrics.middleware';

/**
 * Configures the NestJS application with global middleware, pipes, filters,
 * interceptors, API versioning, CORS, and OpenAPI documentation.
 */
export function setupApp(
  app: INestApplication,
  configService: ConfigService,
): void {
  // ── Helmet security headers ─────────────────────────────────────
  app.use(helmet());

  app.use(requestIdMiddleware);
  app.use(bindRequestContextMiddleware(app.get(RequestContextService)));

  // ── Prometheus metrics (with optional Basic Auth) ───────────────
  const metricsService = app.get(MetricsService);
  const appConfig = configService.get<{
    metricsUser?: string;
    metricsPassword?: string;
  }>(ConfigKey.App);
  const metricsUser = appConfig?.metricsUser;
  const metricsPassword = appConfig?.metricsPassword;

  app.use(createMetricsMiddleware(metricsService));
  app.use(
    '/metrics',
    (req: Request, res: Response, next: () => void) => {
      if (metricsUser && metricsPassword) {
        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith('Basic ')) {
          res.setHeader('WWW-Authenticate', 'Basic realm="Metrics"');
          res.status(401).send('Unauthorized');
          return;
        }
        const decoded = Buffer.from(authHeader.slice(6), 'base64').toString();
        const colonIndex = decoded.indexOf(':');
        const user = colonIndex >= 0 ? decoded.slice(0, colonIndex) : '';
        const pass = colonIndex >= 0 ? decoded.slice(colonIndex + 1) : '';
        if (
          !safeEqual(user, metricsUser) ||
          !safeEqual(pass, metricsPassword)
        ) {
          res.setHeader('WWW-Authenticate', 'Basic realm="Metrics"');
          res.status(401).send('Unauthorized');
          return;
        }
      }
      next();
    },
    async (_req: Request, res: Response) => {
      res.type(metricsService.getContentType());
      res.send(await metricsService.getMetrics());
    },
  );

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

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

function collectValidationMessages(error: ValidationError): string[] {
  const currentMessages = Object.values(error.constraints ?? {});
  const childMessages = (error.children ?? []).flatMap(
    collectValidationMessages,
  );
  return [...currentMessages, ...childMessages];
}
