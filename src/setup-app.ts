import type { Request, Response, NextFunction } from 'express';
import type { INestApplication } from '@nestjs/common';
import { Logger, ValidationPipe, VersioningType } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { ConfigKey } from './config/config-keys.enum';
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
        `${req.method} ${req.originalUrl || req.url} ${res.statusCode.toString()} ${duration.toString()}ms`,
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
