import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import type { ValidationError } from '@nestjs/common';
import {
  BadRequestException,
  ValidationPipe,
  VersioningType,
} from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import type { FastifyRequest, FastifyReply } from 'fastify';
import type { ServerResponse } from 'node:http';
import fastifyHelmet from '@fastify/helmet';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { apiReference } from '@scalar/nestjs-api-reference';
import { WINSTON_MODULE_PROVIDER } from 'nest-winston';
import type { Logger as WinstonLogger } from 'winston';
import { safeCompare } from './common/helpers/crypto.utils';
import { ConfigKey } from './config/config-keys.enum';
import { ResultCode } from './common/api';
import { ApiExceptionFilter } from './common/filters/api-exception.filter';
import { ApiEnvelopeInterceptor } from './common/interceptors/api-envelope.interceptor';
import { SlowRequestInterceptor } from './common/interceptors/slow-request.interceptor';
import {
  REQUEST_ID_HEADER,
  type FastifyRequestWithId,
} from './common/middleware/request-id.types';
import { RequestContextService } from './common/logger/request-context.service';
import { buildAccessLogEntry } from './common/logger/access-log.utils';
import { MetricsService } from './common/metrics/metrics.service';
import { normalizeRoute, shouldSkip } from './common/metrics/metrics.utils';

/**
 * Configures the NestJS application with global middleware, pipes, filters,
 * interceptors, API versioning, CORS, and OpenAPI documentation.
 */
export async function setupApp(
  app: NestFastifyApplication,
  configService: ConfigService,
): Promise<void> {
  const fastify = app.getHttpAdapter().getInstance();
  const requestContextService = app.get(RequestContextService);

  // ── JSON body parser ───────────────────────────────────────────
  // NestJS's default body parser is disabled (bodyParser: false in
  // main.ts) because AdminJS's @fastify/formbody registers the
  // urlencoded parser and NestJS's built-in would conflict with it.
  // We register the JSON parser manually here.
  fastify.addContentTypeParser(
    'application/json',
    { parseAs: 'string' },
    (_req, body, done) => {
      try {
        done(null, JSON.parse(body as string));
      } catch (err) {
        done(err as Error, undefined);
      }
    },
  );

  // ── Helmet security headers ─────────────────────────────────────
  await app.register(fastifyHelmet);

  // ── Request ID ──────────────────────────────────────────────────
  void fastify.addHook('preHandler', (request, reply, done) => {
    const incoming = request.headers[REQUEST_ID_HEADER.toLowerCase()];
    const requestId =
      typeof incoming === 'string' && incoming.trim()
        ? incoming.trim()
        : randomUUID();
    (request as FastifyRequestWithId).requestId = requestId;
    reply.header(REQUEST_ID_HEADER, requestId);
    done();
  });

  // ── Request context (AsyncLocalStorage) ─────────────────────────
  void fastify.addHook('preHandler', (request, _reply, done) => {
    requestContextService.run(
      { requestId: (request as FastifyRequestWithId).requestId },
      done,
    );
  });

  // ── Prometheus metrics ──────────────────────────────────────────
  const metricsService = app.get(MetricsService);
  const appConfig = configService.get<{
    metricsUser?: string;
    metricsPassword?: string;
  }>(ConfigKey.App);
  const metricsUser = appConfig?.metricsUser;
  const metricsPassword = appConfig?.metricsPassword;

  void fastify.addHook('preHandler', (request, _reply, done) => {
    if (!metricsService.is_enabled() || shouldSkip(request.url)) {
      done();
      return;
    }
    (request as FastifyRequestWithId).__metricsStart = performance.now();
    done();
  });

  void fastify.addHook('onResponse', (request, reply, done) => {
    const req = request as FastifyRequestWithId;
    if (!req.__metricsStart) {
      done();
      return;
    }
    const durationSeconds = (performance.now() - req.__metricsStart) / 1000;
    const route = normalizeRoute(request.url);
    metricsService.recordHttpRequest(
      request.method,
      route,
      reply.statusCode,
      durationSeconds,
    );
    done();
  });

  // ── HTTP access log (one structured entry per completed request) ──
  const winstonLogger = app.get<WinstonLogger>(WINSTON_MODULE_PROVIDER);

  void fastify.addHook('onResponse', (request, reply, done) => {
    // Skip high-frequency probes (/api/v1/health*, /metrics) to avoid noise.
    if (shouldSkip(request.url)) {
      done();
      return;
    }
    const entry = buildAccessLogEntry({
      requestId: (request as FastifyRequestWithId).requestId,
      method: request.method,
      routeUrl: request.routeOptions.url,
      rawUrl: request.url,
      statusCode: reply.statusCode,
      elapsedMs: reply.elapsedTime,
    });
    const { level, message, ...meta } = entry;
    winstonLogger.log(level, message, meta);
    done();
  });

  // ── Metrics endpoint (with optional Basic Auth) ─────────────────
  void fastify.get('/metrics', async (request, reply) => {
    if (metricsUser && metricsPassword) {
      const authHeader = request.headers.authorization;
      if (!authHeader || !authHeader.startsWith('Basic ')) {
        reply.header('WWW-Authenticate', 'Basic realm="Metrics"');
        reply.code(401).send('Unauthorized');
        return;
      }
      const decoded = Buffer.from(authHeader.slice(6), 'base64').toString();
      const colonIndex = decoded.indexOf(':');
      const user = colonIndex >= 0 ? decoded.slice(0, colonIndex) : '';
      const pass = colonIndex >= 0 ? decoded.slice(colonIndex + 1) : '';
      if (
        !safeCompare(user, metricsUser) ||
        !safeCompare(pass, metricsPassword)
      ) {
        reply.header('WWW-Authenticate', 'Basic realm="Metrics"');
        reply.code(401).send('Unauthorized');
        return;
      }
    }
    reply.type(metricsService.getContentType());
    reply.send(await metricsService.getMetrics());
  });

  // ── NestJS global configuration ─────────────────────────────────
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

  // `withFastify: true` makes apiReference return a function that expects
  // (FastifyRequest, ServerResponse). The Scalar type definition incorrectly
  // intersects with Express Request, so we use @ts-expect-error to suppress
  // the assignment error — when Scalar fixes their types this directive will
  // become unused and TS will alert us.
  // @ts-expect-error — Scalar 类型定义未正确区分 Fastify/Express 集成
  const docsHandler: (req: FastifyRequest, res: ServerResponse) => void =
    apiReference({
      spec: { content: document },
      theme: 'purple',
      _integration: 'nestjs',
      withFastify: true,
    });
  void fastify.get(
    '/api/docs',
    (request: FastifyRequest, reply: FastifyReply) => {
      docsHandler(request, reply.raw);
    },
  );
}

export function formatValidationErrors(errors: ValidationError[]): string {
  return errors.flatMap(collectValidationMessages).join('; ');
}

export function collectValidationMessages(error: ValidationError): string[] {
  const currentMessages = Object.values(error.constraints ?? {});
  const childMessages = (error.children ?? []).flatMap(
    collectValidationMessages,
  );
  return [...currentMessages, ...childMessages];
}
