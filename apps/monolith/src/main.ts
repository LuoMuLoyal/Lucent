import './tracing.js';
import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { Logger } from 'nestjs-pino';
import { FastifyAdapter } from '@nestjs/platform-fastify';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { AppModule } from './app.module.js';
import { setupApp } from './setup-app.js';
import { ConfigKey } from './config/env/config-keys.enum.js';
import { EnvKey } from './config/env/env-keys.enum.js';
import { registerAdminConsole } from './admin-console/setup.js';

async function bootstrap() {
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter({
      trustProxy: process.env[EnvKey.TRUST_PROXY] === 'true',
    }),
    // bodyParser: false — the JSON content-type parser is registered manually
    // in setupApp() so an absent body is accepted and malformed JSON maps to a
    // 400 Problem Details response instead of a 500.
    //
    // routeConflictPolicy (v12): fail fast on duplicate route declarations
    // and warn when a route silently shadows a more specific one.
    {
      bufferLogs: true,
      bodyParser: false,
      routeConflictPolicy: { duplicate: 'error', shadow: 'warn' },
    },
  );
  // Substitute pino for Nest's built-in logger. Every `new Logger(X.name)`
  // in the codebase then emits through pino without changing its call sites.
  app.useLogger(app.get(Logger));

  const configService = app.get(ConfigService);
  await setupApp(app, configService);
  await registerAdminConsole(app, configService);
  app.enableShutdownHooks();

  const host = configService.getOrThrow<string>(`${ConfigKey.App}.host`);
  const port = configService.getOrThrow<number>(`${ConfigKey.App}.port`);
  await app.listen(port, host);
}

void bootstrap();
