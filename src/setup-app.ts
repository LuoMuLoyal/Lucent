import { performance } from 'node:perf_hooks';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { ValidationError } from '@nestjs/common';
import {
  BadRequestException,
  Logger,
  ValidationPipe,
  VersioningType,
} from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import type { FastifyRequest, FastifyReply } from 'fastify';
import fastifyHelmet from '@fastify/helmet';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { apiReference } from '@scalar/nestjs-api-reference';
import { WINSTON_MODULE_PROVIDER } from 'nest-winston';
import type { Logger as WinstonLogger } from 'winston';
import { safeCompare } from './common';
import { ProblemDetailsDto, SseProblemDetailsDto } from './common';
import { ConfigKey } from './config/env/config-keys.enum';
import { ApiExceptionFilter } from './common/filters/api-exception.filter';
import { SlowRequestInterceptor } from './common';
import type { FastifyRequestWithMetrics } from './common/types/metrics.types';
import { getActiveTraceIds } from './common/logger/trace-context.utils';
import { buildAccessLogEntry } from './common/logger/access-log.utils';
import { MetricsService } from './common/metrics/metrics.service';
import { normalizeRoute, shouldSkip } from './common/metrics/metrics.utils';

/**
 * Resolves the URL for the self-hosted Scalar standalone bundle. The bundle
 * only changes between @scalar/api-reference versions, so the `immutable` cache
 * header on the asset route is safe ONLY if the URL changes when the dependency
 * upgrades. Embedding the resolved version in a query string busts the cache on
 * upgrade; falls back to a bare URL if the version cannot be read.
 *
 * Resolution happens inside `setupApp` rather than at module load time so that
 * serverless / read-only filesystem deployments can set the version via the
 * `SCALAR_API_REFERENCE_VERSION` environment variable instead of relying on
 * a readable `package.json` at boot.
 */
async function resolveScalarStandaloneUrl(): Promise<string> {
  const envVersion = process.env['SCALAR_API_REFERENCE_VERSION']?.replace(
    /^[\^~]/,
    '',
  );
  if (envVersion) {
    return `/scalar/standalone.js?v=${envVersion}`;
  }

  try {
    const pkg = JSON.parse(
      await readFile(join(__dirname, '..', 'package.json'), 'utf-8'),
    ) as { dependencies?: Record<string, string> };
    const version = (pkg.dependencies?.['@scalar/api-reference'] ?? '').replace(
      /^[\^~]/,
      '',
    );
    return version
      ? `/scalar/standalone.js?v=${version}`
      : '/scalar/standalone.js';
  } catch (error) {
    Logger.warn(
      `Failed to resolve @scalar/api-reference version from package.json, falling back to bare URL: ${
        error instanceof Error ? error.message : String(error)
      }`,
      'resolveScalarStandaloneUrl',
    );
    return '/scalar/standalone.js';
  }
}

/**
 * Configures the NestJS application with global middleware, pipes, filters,
 * interceptors, API versioning, CORS, and OpenAPI documentation.
 */
export async function setupApp(
  app: NestFastifyApplication,
  configService: ConfigService,
): Promise<void> {
  const fastify = app.getHttpAdapter().getInstance();

  // ── JSON body parser ───────────────────────────────────────────
  // NestJS's default body parser is disabled (bodyParser: false in
  // main.ts) because AdminJS's @fastify/formbody registers the
  // urlencoded parser and NestJS's built-in would conflict with it.
  // We register the JSON parser manually here.
  fastify.addContentTypeParser(
    'application/json',
    { parseAs: 'string' },
    (_req, body, done) => {
      // Some clients (e.g. the generated OpenAPI/Dart client) send POSTs with
      // Content-Type: application/json but no body. JSON.parse('') would throw
      // "Unexpected end of JSON input", so treat an empty payload as an
      // absent body instead of failing the request.
      if (typeof body === 'string' && body.trim() === '') {
        done(null, undefined);
        return;
      }
      try {
        done(null, JSON.parse(body as string));
      } catch {
        // NestJS 12 reworked HTTP adapter error mapping: errors raised by a
        // content-type parser reach the global exception filter directly, and
        // the filter only maps `HttpException` instances — a plain error
        // (even one carrying `statusCode`) surfaces as a 500. Malformed JSON
        // must stay a client error (400), as asserted by the security fuzzing
        // e2e suite, so hand the adapter a BadRequestException.
        done(new BadRequestException('Malformed JSON payload'), undefined);
      }
    },
  );

  // ── Helmet security headers ─────────────────────────────────────
  // AdminJS and Scalar render inline bootstrap scripts, so CSP must allow
  // 'unsafe-inline' scripts — otherwise both admin panel and /api/docs
  // render blank (bundle scripts load, inline ones are blocked).
  await app.register(fastifyHelmet, {
    contentSecurityPolicy: {
      directives: {
        'script-src': ["'self'", "'unsafe-inline'"],
      },
    },
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
    (request as FastifyRequestWithMetrics).__metricsStart = performance.now();
    done();
  });

  // ── W3C trace context response header ─────────────────────────
  // onSend runs before the payload is serialized/sent, so the header can
  // still be set here (onResponse is too late — headers are already out).
  void fastify.addHook('onSend', (_request, reply, _payload, done) => {
    const { traceId, spanId } = getActiveTraceIds();
    if (traceId && spanId) {
      reply.header('traceresponse', `00-${traceId}-${spanId}-01`);
    }
    done();
  });

  void fastify.addHook('onResponse', (request, reply, done) => {
    const req = request as FastifyRequestWithMetrics;
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
          code: 'VALIDATION_FAILED',
          message: formatValidationErrors(errors),
        }),
    }),
  );
  app.useGlobalInterceptors(app.get(SlowRequestInterceptor));
  app.useGlobalFilters(app.get(ApiExceptionFilter));

  app.enableCors({
    origin: configService.get<boolean | string[]>(
      `${ConfigKey.App}.corsOrigin`,
      false,
    ),
  });

  // ── Scalar API Reference ───────────────────────────────────────
  const scalarStandaloneUrl = await resolveScalarStandaloneUrl();

  const swaggerConfig = new DocumentBuilder()
    .setTitle('Lucent API')
    .setDescription('Lucent backend API documentation')
    .setVersion('1.0')
    .addBearerAuth(
      {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        description: 'Enter accessToken',
      },
      'access-token',
    )
    .build();

  const document = SwaggerModule.createDocument(app, swaggerConfig, {
    extraModels: [ProblemDetailsDto, SseProblemDetailsDto],
  });

  // `withFastify: true` would make apiReference write to the raw response
  // (bypassing Fastify's onSend pipeline, so favicon injection below would
  // not run). Without it, apiReference calls `res.send(html)`, which goes
  // through the Fastify payload pipeline when given the Fastify reply.
  // The Scalar type definition incorrectly intersects with Express Request,
  // so we use @ts-expect-error to suppress the assignment error.
  // @ts-expect-error — Scalar 类型定义未正确区分 Fastify/Express 集成
  const docsHandler: (req: FastifyRequest, res: FastifyReply) => void =
    apiReference({
      spec: { content: document },
      theme: 'purple',
      _integration: 'nestjs',
      // Self-host the Scalar standalone bundle instead of loading it from the
      // jsdelivr CDN (unreliable in CN networks → blank page). The URL is
      // versioned (see resolveScalarStandaloneUrl) so the immutable cache below is
      // invalidated when the @scalar/api-reference dependency upgrades.
      cdn: scalarStandaloneUrl,
    });

  // ── Self-hosted Scalar standalone asset (avoids unreachable CDN) ──
  void fastify.get('/scalar/standalone.js', async (_request, reply) => {
    try {
      // Resolve relative to this file so it works regardless of the process
      // working directory (PM2 / systemd / Docker). `__dirname` is the project
      // root both in dev (src/) and after `nest build` (dist/).
      const file = join(
        __dirname,
        '..',
        'node_modules',
        '@scalar',
        'api-reference',
        'dist',
        'browser',
        'standalone.js',
      );
      const content = await readFile(file);
      // The bundle only changes between @scalar/api-reference versions, so a
      // long-lived cache is safe.
      reply
        .type('application/javascript')
        .header('Cache-Control', 'public, max-age=31536000, immutable')
        .send(content);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        reply.status(404).send('Scalar bundle not found');
        return;
      }
      Logger.warn(
        `Failed to serve Scalar standalone bundle: ${err instanceof Error ? err.message : String(err)}`,
        err instanceof Error ? err.stack : undefined,
      );
      reply.status(500).send('Failed to serve Scalar bundle');
    }
  });

  void fastify.get(
    '/api/docs',
    (request: FastifyRequest, reply: FastifyReply) => {
      docsHandler(request, reply);
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
