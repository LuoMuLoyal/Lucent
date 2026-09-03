import { Module } from '@nestjs/common';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { CacheModule } from '@nestjs/cache-manager';
import { ConfigModule } from '@nestjs/config';
import { yamlConfigFactory } from './config/yaml/yaml-loader.js';
import { RouterModule } from '@nestjs/core';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { ThrottlerConfigService } from './config/services/throttler.config.js';
import { APP_GUARD } from '@nestjs/core';
import { JwtAuthGuard } from './modules/auth/index.js';
import { appConfig } from './config/app.config.js';
import { llmConfig } from './config/services/llm.config.js';
import { jwtConfig } from './config/services/jwt.config.js';
import { oauthConfig } from './config/services/oauth.config.js';
import { tencentCosConfig } from './config/services/tencent-cos.config.js';
import { s3StorageConfig } from './config/services/s3-storage.config.js';
import { jpushConfig } from './config/services/jpush.config.js';
import { getEnvFilePaths } from './config/env/env-file-paths.js';
import { validatedEnvSchema } from './config/env/environment.validation.js';
import { AuthModule } from './modules/auth/auth.module.js';
import { MailModule } from './mail/mail.module.js';
import { PrismaModule } from './prisma/index.js';
import { CacheConfigService } from './config/services/cache.config.js';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { I18nModule } from './i18n/i18n.module.js';
import { LoggerModule } from './common/logger/logger.module.js';
import { MetricsModule } from './common/metrics/metrics.module.js';
import { SseModule } from './common/index.js';
import { BullmqModule } from './common/queue/queue.module.js';
import { CronJobsModule } from './common/queue/cron-jobs.module.js';
import { RedisModule } from './common/redis/redis.module.js';
import { MedicinesModule } from './modules/medicines/medicines.module.js';
import { DailyRecordsModule } from './modules/daily-records/daily-records.module.js';
import { MedicineDoseLogsModule } from './modules/medicine-dose-logs/medicine-dose-logs.module.js';
import { HealthEventsModule } from './modules/health-events/health-events.module.js';
import { MedicineRemindersModule } from './modules/medicine-reminders/medicine-reminders.module.js';
import { UserHealthContextModule } from './modules/user-health-context/user-health-context.module.js';
import { AccountModule } from './modules/account/account.module.js';
import { EnvironmentModule } from './modules/environment/environment.module.js';
import { ReportsModule } from './modules/reports/reports.module.js';
import { UserSettingsModule } from './modules/user-settings/user-settings.module.js';
import { AppInfoModule } from './modules/app-info/app-info.module.js';
import { LegalDocumentsModule } from './modules/legal-documents/legal-documents.module.js';
import { DataExportModule } from './modules/data-export/data-export.module.js';
import { FilesModule } from './modules/files/files.module.js';
import { NotificationsModule } from './modules/notifications/notifications.module.js';
import { NotificationPreferencesModule } from './modules/notification-preferences/notification-preferences.module.js';
import { ProductEventsModule } from './modules/product-events/product-events.module.js';
import { TestingSupportModule } from './modules/testing-support/testing-support.module.js';
import { LlmRuntimeModule } from './llm-runtime/llm-runtime.module.js';
import { TodayAnalysisModule } from './modules/today-analysis/today-analysis.module.js';
import { TodaySuggestionModule } from './modules/today-suggestion/today-suggestion.module.js';
import { AssistantModule } from './modules/assistant/assistant.module.js';
import { AuditLogModule } from './modules/audit-log/audit-log.module.js';
import { DataRetentionModule } from './modules/data-retention/data-retention.module.js';
import { ApiExceptionFilter } from './common/filters/api-exception.filter.js';
import { SlowRequestInterceptor } from './common/index.js';

/**
 * Root application module. Wires configuration, persistence, common
 * infrastructure, and all feature modules together.
 */
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: getEnvFilePaths(),
      load: [
        yamlConfigFactory,
        appConfig,
        llmConfig,
        jwtConfig,
        oauthConfig,
        tencentCosConfig,
        s3StorageConfig,
        jpushConfig,
      ],
      // NestJS 12 Standard Schema option — the zod schema (including the
      // cross-field refinements) validates the merged env in one
      // declarative unit; undeclared variables are merged back by
      // @nestjs/config and stay available.
      validationSchema: validatedEnvSchema,
    }),
    CacheModule.registerAsync({
      isGlobal: true,
      useClass: CacheConfigService,
    }),
    EventEmitterModule.forRoot(),
    // Rate limiting: Redis-backed when REDIS_URL is set, in-memory fallback
    ThrottlerModule.forRootAsync({
      imports: [],
      useClass: ThrottlerConfigService,
    }),
    I18nModule,
    LoggerModule,
    MetricsModule,
    SseModule,
    BullmqModule,
    CronJobsModule,
    RedisModule,
    PrismaModule,
    AuditLogModule,
    DataRetentionModule,
    MailModule,
    AuthModule,
    AccountModule,
    MedicinesModule,
    UserHealthContextModule,
    DailyRecordsModule,
    MedicineDoseLogsModule,
    HealthEventsModule,
    MedicineRemindersModule,
    EnvironmentModule,
    ReportsModule,
    LlmRuntimeModule,
    AssistantModule,
    TodayAnalysisModule,
    TodaySuggestionModule,
    UserSettingsModule,
    AppInfoModule,
    LegalDocumentsModule,
    DataExportModule,
    FilesModule,
    NotificationsModule,
    ProductEventsModule,
    ...(process.env['NODE_ENV'] === 'test' ? [TestingSupportModule] : []),
    NotificationPreferencesModule,
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
          HealthEventsModule,
          MedicineRemindersModule,
          NotificationsModule,
          ProductEventsModule,
          ReportsModule,
          UserSettingsModule,
          TodayAnalysisModule,
          TodaySuggestionModule,
          NotificationPreferencesModule,
        ],
      },
    ]),
  ],
  controllers: [AppController],
  providers: [
    AppService,
    ApiExceptionFilter,
    SlowRequestInterceptor,
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
    {
      provide: APP_GUARD,
      useClass: JwtAuthGuard,
    },
  ],
})
export class AppModule {}
