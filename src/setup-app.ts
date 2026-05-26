import {
  INestApplication,
  Logger,
  ValidationPipe,
  VersioningType,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
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
  app.use((req, res, next) => {
    const start = Date.now();
    res.on('finish', () => {
      const duration = Date.now() - start;
      logger.log(
        `${req.method} ${req.originalUrl || req.url} ${res.statusCode} ${duration}ms`,
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
}
