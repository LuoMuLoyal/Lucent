import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { WINSTON_MODULE_NEST_PROVIDER } from 'nest-winston';
import { AppModule } from './app.module';
import { setupApp } from './setup-app';
import { ConfigKey } from './config/config-keys.enum';
import { registerAdminPanel } from './admin/setup';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  app.useLogger(app.get(WINSTON_MODULE_NEST_PROVIDER));

  const configService = app.get(ConfigService);
  setupApp(app, configService);
  await registerAdminPanel(app, configService);
  app.enableShutdownHooks();

  const host = configService.getOrThrow<string>(`${ConfigKey.App}.host`);
  const port = configService.getOrThrow<number>(`${ConfigKey.App}.port`);
  await app.listen(port, host);
}

void bootstrap();
