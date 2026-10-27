import { performance } from 'node:perf_hooks';

import {
  BadRequestException,
  Logger,
  StandardSchemaSerializerInterceptor,
  StandardSchemaValidationPipe,
  VersioningType,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { ConfigService } from '@nestjs/config';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import fastifyCompress from '@fastify/compress';
import fastifyCookie from '@fastify/cookie';
import fastifyHelmet from '@fastify/helmet';
import { I18nContext, I18nService } from 'nestjs-i18n';
import { resolveHttpsHeaderPolicy, safeCompare } from './common/index.js';
import { ConfigKey } from './config/env/config-keys.enum.js';
import { ApiExceptionFilter } from './common/filters/api-exception.filter.js';
import { ValidationException } from './common/filters/validation-exception.js';
import { translateValidationMessage } from './common/validators/validation-copy.js';
import { SlowRequestInterceptor } from './common/index.js';
import type { FastifyRequestWithMetrics } from './common/types/metrics.types.js';
import { getActiveTraceIds } from './common/logger/trace-context.utils.js';
import { buildAccessLogEntry } from './common/logger/access-log.utils.js';
import { MetricsService } from './common/metrics/metrics.service.js';
import { normalizeRoute, shouldSkip } from './common/metrics/metrics.utils.js';

/**
 * Configures the NestJS application with global middleware, pipes, filters,
 * interceptors, API versioning, and CORS.
 */
export async function setupApp(
  app: NestFastifyApplication,
  configService: ConfigService,
): Promise<void> {
  const fastify = app.getHttpAdapter().getInstance();

  // ── JSON body parser ───────────────────────────────────────────
  // NestJS's default body parser is disabled (bodyParser: false in main.ts) so
  // the empty-payload and malformed-JSON handling below stays the single
  // content-type parser for application/json.
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
      } catch (parseError) {
        // NestJS 12 reworked HTTP adapter error mapping: errors raised by a
        // content-type parser reach the global exception filter directly, and
        // the filter only maps `HttpException` instances — a plain error
        // (even one carrying `statusCode`) surfaces as a 500. Malformed JSON
        // must stay a client error (400), as asserted by the security fuzzing
        // e2e suite, so hand the adapter a BadRequestException.
        //
        // The original SyntaxError (with line/column context) is deliberately
        // not re-thrown; its message is included in the detail string so the
        // global filter's logging and the problem+json response body both
        // carry the diagnostic — the status stays 400 (client error).
        done(
          new BadRequestException(
            `Malformed JSON payload: ${parseError instanceof Error ? parseError.message : String(parseError)}`,
          ),
        );
      }
    },
  );

  // ── Helmet security headers ─────────────────────────────────────
  // `script-src` allows 'unsafe-inline'. The original justification (the
  // retired AdminJS panel rendered inline bootstrap scripts) no longer
  // applies: the current admin console is a Vite SPA whose entry is an
  // external module script. The directive is kept as-is because relaxing it
  // to `'self'` is a policy change that needs its own verification, not a
  // side effect of removing dead references.
  //
  // Helmet's defaults also carry the HTTPS-only headers, which must follow the
  // scheme the deployment is really served on: on a plain-HTTP public origin
  // `upgrade-insecure-requests` rewrites /admin/assets/* to https, every asset
  // fails to load, and the console renders blank (see
  // `common/api/security-headers.ts`).
  const appConfig = configService.get<{
    publicBaseUrl?: string;
    metricsUser?: string;
    metricsPassword?: string;
  }>(ConfigKey.App);
  const httpsOnlyHeaders = resolveHttpsHeaderPolicy(
    appConfig?.publicBaseUrl ?? '',
  );

  await app.register(fastifyHelmet, {
    hsts: httpsOnlyHeaders.hsts,
    contentSecurityPolicy: {
      directives: {
        'script-src': ["'self'", "'unsafe-inline'"],
        ...httpsOnlyHeaders.cspDirectives,
      },
    },
  });

  // ── Response compression ────────────────────────────────────────
  // Global gzip/deflate/brotli negotiation for JSON and text responses.
  // SSE routes opt out with `@RouteConfig({ compress: false })`: they write
  // the head directly on the raw response (`prepareSse`) and must stay
  // unbuffered. The plugin skips bodies under its 1 KiB default threshold and
  // honours the `x-no-compression` request header, so small payloads and
  // explicitly-opted-out clients are untouched.
  await app.register(fastifyCompress, {
    global: true,
    encodings: ['gzip', 'deflate', 'br'],
  });

  // ── Cookies ─────────────────────────────────────────────────────
  // `@fastify/cookie` gives `reply.setCookie` / `reply.clearCookie` and a
  // parsed `request.cookies` map. Using it (rather than hand-building
  // `Set-Cookie` strings) keeps one implementation for every cookie the
  // service issues, and makes the "cleared attribute must match the issued
  // attribute or the browser keeps the cookie" rule the plugin's job instead
  // of a comment's.
  //
  // `secret` stays unset on purpose: every cookie here carries a value that
  // is already tamper-proof on its own (a signed JWT, or a random refresh
  // token that is looked up by hash). Enabling `sign`/`unsign` would add a
  // second, redundant integrity layer and another secret to rotate.
  await app.register(fastifyCookie);

  // ── Prometheus metrics ──────────────────────────────────────────
  const metricsService = app.get(MetricsService);
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
  // Emitted through pino via the substituted Nest logger; metadata lands at
  // the top level of the JSON entry.
  const accessLogger = new Logger('HttpAccess');

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
    if (level === 'error') {
      accessLogger.error(meta, message);
    } else {
      accessLogger.log(meta, message);
    }
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
    // Standard Schema pipe validates params that carry `{ schema }` metadata
    // (all request DTOs are zod schemas since the request-side migration).
    //
    // The built-in factory flattens issues into bare `message` strings, which
    // `resolveErrors` cannot turn back into field-level detail. Keep the
    // structured issues instead, so a `.strict()` rejection names the
    // offending key rather than reporting an actionable-less "Bad Request".
    //
    // Messages are schema-authored **codes** (`validation.password.too_short`)
    // rendered here, at the one place a request language is available — a
    // schema is built at module load, so prose in it cannot follow
    // `Accept-Language`. Unknown text passes through untouched.
    new StandardSchemaValidationPipe({
      exceptionFactory: (issues) => {
        const locale = I18nContext.current()?.lang ?? 'en';
        return new ValidationException(
          issues.map((issue) => {
            const fieldPath = (issue.path ?? [])
              .map((segment) =>
                // Standard Schema allows a bare key or a `{ key }` segment;
                // zod emits the latter for object properties.
                String(typeof segment === 'object' ? segment.key : segment),
              )
              .join('.');
            return {
              path: fieldPath,
              // `fieldPath` lets the renderer turn `{field}` into a label; the
              // message itself carries only the rule code.
              message: translateValidationMessage(
                app.get(I18nService),
                locale,
                issue.message,
                { fieldPath },
              ),
            };
          }),
        );
      },
    }),
  );
  app.useGlobalInterceptors(
    app.get(SlowRequestInterceptor),
    // Response-side standard-schema serialization: validates responses that
    // carry `@SerializeOptions({ schema })`; a no-op everywhere else.
    new StandardSchemaSerializerInterceptor(app.get(Reflector)),
  );
  app.useGlobalFilters(app.get(ApiExceptionFilter));

  app.enableCors({
    origin: configService.get<boolean | string[]>(
      `${ConfigKey.App}.corsOrigin`,
      false,
    ),
    // @fastify/cors defaults to "GET,HEAD,POST" (CORS-safelisted), but the
    // API uses PATCH, PUT and DELETE which require an explicit preflight
    // allow.  Omitting them causes the browser to block the actual request
    // after a successful preflight — the classic "DELETE returns 204 in
    // OPTIONS but never arrives" symptom.
    methods: 'GET,HEAD,POST,PATCH,PUT,DELETE,OPTIONS',
    // HttpOnly session cookies (see `common/api/session-cookie.ts`) must be
    // sent on cross-origin requests from Lumine's web and desktop hosts. The
    // browser only forwards them when the server answers the preflight with
    // `Access-Control-Allow-Credentials: true`, so WILDCARD ORIGIN IS NOT
    // ACCEPTABLE here — `corsOrigin` must list explicit origins (or `true`,
    // which reflects the request origin). `CORS_ORIGIN=*` combined with
    // credentials is rejected by browsers by design.
    credentials: true,
  });
}
