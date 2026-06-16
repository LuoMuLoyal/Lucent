const fs = require('node:fs');
const path = require('node:path');
const { NestFactory } = require('@nestjs/core');
const { ConfigService } = require('@nestjs/config');
const { SwaggerModule } = require('@nestjs/swagger');

async function main() {
  delete process.env.REDIS_URL;
  process.env.OPENAPI_EXPORT_SKIP_DB_CONNECT = 'true';

  const { AppModule } = await import('../dist/app.module.js');
  const { setupApp } = await import('../dist/setup-app.js');

  const app = await NestFactory.create(AppModule, { logger: false });
  setupApp(app, app.get(ConfigService));

  const document = SwaggerModule.createDocument(app, {
    openapi: '3.0.0',
    info: {
      title: 'Lucent API',
      description: 'Lucent 后端 API 文档',
      version: '1.0',
    },
  });

  const outputPath = path.resolve(__dirname, '..', 'docs', 'openapi.json');
  fs.writeFileSync(
    outputPath,
    `${JSON.stringify(document, null, 2)}\n`,
    'utf-8',
  );

  console.log(`OpenAPI spec exported to: ${outputPath}`);
  console.log(`Paths: ${Object.keys(document.paths).length}`);
  console.log(
    `Schemas: ${Object.keys(document.components?.schemas ?? {}).length}`,
  );

  await app.close();
}

void main().catch((error) => {
  console.error('Export failed:', error);
  process.exit(1);
});
