import { Module } from '@nestjs/common';
import { CacheModule } from '@nestjs/cache-manager';
import { ConfigModule } from '@nestjs/config';
import { appConfig } from './config/app.config';
import { jwtConfig } from './config/jwt.config';
import { getEnvFilePaths } from './config/env-file-paths';
import { validateEnvironment } from './config/environment.validation';
import { HealthModule } from './health/health.module';
import { AuthModule } from './auth/auth.module';
import { LoggerModule } from './common/logger/logger.module';
import { MailModule } from './mail/mail.module';
import { PrismaModule } from './prisma/prisma.module';
import { CacheConfigService } from './config/cache.config';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: getEnvFilePaths(),
      load: [appConfig, jwtConfig],
      validate: validateEnvironment,
    }),
    CacheModule.registerAsync({
      isGlobal: true,
      useClass: CacheConfigService,
    }),
    LoggerModule,
    PrismaModule,
    MailModule,
    HealthModule,
    AuthModule,
  ],
})
export class AppModule {}
