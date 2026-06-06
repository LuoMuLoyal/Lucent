import { Module } from '@nestjs/common';
import { CacheModule } from '@nestjs/cache-manager';
import { ConfigModule } from '@nestjs/config';
import { appConfig } from './config/app.config';
import { jwtConfig } from './config/jwt.config';
import { oauthConfig } from './config/oauth.config';
import { tencentCosConfig } from './config/tencent-cos.config';
import { getEnvFilePaths } from './config/env-file-paths';
import { validateEnvironment } from './config/environment.validation';
import { AuthModule } from './modules/auth/auth.module';
import { LoggerModule } from './common/logger/logger.module';
import { MailModule } from './mail/mail.module';
import { PrismaModule } from './prisma/prisma.module';
import { CacheConfigService } from './config/cache.config';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { I18nModule } from './i18n/i18n.module';
import { MedicinesModule } from './modules/medicines/medicines.module';
import { DailyRecordsModule } from './modules/daily-records/daily-records.module';
import { MedicineDoseLogsModule } from './modules/medicine-dose-logs/medicine-dose-logs.module';
import { UserHealthContextModule } from './modules/user-health-context/user-health-context.module';
import { AccountModule } from './modules/account/account.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: getEnvFilePaths(),
      load: [appConfig, jwtConfig, oauthConfig, tencentCosConfig],
      validate: validateEnvironment,
    }),
    CacheModule.registerAsync({
      isGlobal: true,
      useClass: CacheConfigService,
    }),
    I18nModule,
    LoggerModule,
    PrismaModule,
    MailModule,
    AuthModule,
    AccountModule,
    MedicinesModule,
    UserHealthContextModule,
    DailyRecordsModule,
    MedicineDoseLogsModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
// eslint-disable-next-line @typescript-eslint/no-extraneous-class -- NestJS @Module requires a class declaration
export class AppModule {}
