import { NestFactory } from '@nestjs/core';
import { SwaggerModule } from '@nestjs/swagger';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { AppModule } from '../src/app.module';
import { setupApp } from '../src/setup-app';
import { ConfigService } from '@nestjs/config';

async function main() {
  const app = await NestFactory.create(AppModule, { logger: false });
  const cs = app.get(ConfigService);
  setupApp(app, cs);

  const document = SwaggerModule.createDocument(app, {
    openapi: '3.0.0',
    info: {
      title: 'Lucent API',
      description: 'Lucent 后端 API 文档',
      version: '1.0',
    },
  });

  const outputPath = path.resolve(__dirname, '..', 'docs', 'openapi.json');
  fs.writeFileSync(outputPath, JSON.stringify(document, null, 2), 'utf-8');

  console.log('OpenAPI spec exported to: ' + outputPath);
  const paths = document.paths;
  const schemas: Record<string, unknown> = document.components?.schemas ?? {};
  console.log('Paths: ' + String(Object.keys(paths).length));
  console.log('Schemas: ' + String(Object.keys(schemas).length));

  await app.close();
}

main().catch((err: unknown) => {
  console.error('Export failed:', err);
  process.exit(1);
});
