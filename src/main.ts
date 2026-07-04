import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module';
import { setupApp } from './setup-app';
import { ConfigKey } from './config/config-keys.enum';
import { registerAdminPanel } from './admin/adminjs.setup';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  app.useLogger(app.get(Logger));

  const configService = app.get(ConfigService);
  setupApp(app, configService);
  await registerAdminPanel(app, configService);

  const host = configService.getOrThrow<string>(`${ConfigKey.App}.host`);
  const port = configService.getOrThrow<number>(`${ConfigKey.App}.port`);
  await app.listen(port, host);
}

void bootstrap();
