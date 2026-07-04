import { Module } from '@nestjs/common';
import { CacheModule } from '@nestjs/cache-manager';
import { ConfigModule } from '@nestjs/config';
import { RouterModule } from '@nestjs/core';
import { appConfig } from './config/app.config';
import { aiConfig } from './config/ai.config';
import { jwtConfig } from './config/jwt.config';
import { oauthConfig } from './config/oauth.config';
import { tencentCosConfig } from './config/tencent-cos.config';
import { getEnvFilePaths } from './config/env-file-paths';
import { validateEnvironment } from './config/environment.validation';
import { AuthModule } from './modules/auth/auth.module';
import { MailModule } from './mail/mail.module';
import { PrismaModule } from './prisma/prisma.module';
import { CacheConfigService } from './config/cache.config';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { I18nModule } from './i18n/i18n.module';
import { LoggerModule } from './common/logger/logger.module';
import { MedicinesModule } from './modules/medicines/medicines.module';
import { DailyRecordsModule } from './modules/daily-records/daily-records.module';
import { MedicineDoseLogsModule } from './modules/medicine-dose-logs/medicine-dose-logs.module';
import { MedicineRemindersModule } from './modules/medicine-reminders/medicine-reminders.module';
import { UserHealthContextModule } from './modules/user-health-context/user-health-context.module';
import { AccountModule } from './modules/account/account.module';
import { EnvironmentModule } from './modules/environment/environment.module';
import { ReportsModule } from './modules/reports/reports.module';
import { UserSettingsModule } from './modules/user-settings/user-settings.module';
import { SupportResourcesModule } from './modules/support-resources/support-resources.module';
import { DataExportModule } from './modules/data-export/data-export.module';
import { FilesModule } from './modules/files/files.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { TestingSupportModule } from './modules/testing-support/testing-support.module';
import { LlmRuntimeModule } from './modules/llm-runtime/llm-runtime.module';
import { TodayAnalysisModule } from './modules/today-analysis/today-analysis.module';
import { AssistantModule } from './modules/assistant/assistant.module';
import { ApiExceptionFilter } from './common/filters/api-exception.filter';

/**
 * Root application module. Wires configuration, persistence, common
 * infrastructure, and all feature modules together.
 */
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: getEnvFilePaths(),
      load: [appConfig, aiConfig, jwtConfig, oauthConfig, tencentCosConfig],
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
    MedicineRemindersModule,
    EnvironmentModule,
    ReportsModule,
    LlmRuntimeModule,
    AssistantModule,
    TodayAnalysisModule,
    UserSettingsModule,
    SupportResourcesModule,
    DataExportModule,
    FilesModule,
    NotificationsModule,
    ...(process.env['NODE_ENV'] === 'test' ? [TestingSupportModule] : []),
    RouterModule.register([
      {
        path: 'user',
        children: [
          AssistantModule,
          DailyRecordsModule,
          DataExportModule,
          FilesModule,
          UserHealthContextModule,
          MedicineDoseLogsModule,
          MedicineRemindersModule,
          NotificationsModule,
          ReportsModule,
          UserSettingsModule,
          TodayAnalysisModule,
        ],
      },
    ]),
  ],
  controllers: [AppController],
  providers: [AppService, ApiExceptionFilter],
})
export class AppModule {}
