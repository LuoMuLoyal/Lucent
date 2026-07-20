import { Module } from '@nestjs/common';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { CacheModule } from '@nestjs/cache-manager';
import { ConfigModule } from '@nestjs/config';
import { RouterModule } from '@nestjs/core';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { APP_GUARD } from '@nestjs/core';
import { JwtAuthGuard } from './modules/auth/guards/jwt-auth.guard';
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
import { MetricsModule } from './common/metrics/metrics.module';
import { SseModule } from './common/api/sse.module';
import { BullmqModule } from './common/queue/queue.module';
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
import { LegalDocumentsModule } from './modules/legal-documents/legal-documents.module';
import { DataExportModule } from './modules/data-export/data-export.module';
import { FilesModule } from './modules/files/files.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { TestingSupportModule } from './modules/testing-support/testing-support.module';
import { LlmRuntimeModule } from './llm-runtime/llm-runtime.module';
import { TodayAnalysisModule } from './modules/today-analysis/today-analysis.module';
import { TodaySuggestionModule } from './modules/today-suggestion/today-suggestion.module';
import { AssistantModule } from './modules/assistant/assistant.module';
import { AuditLogModule } from './modules/audit-log/audit-log.module';
import { UserDevicesModule } from './modules/user-devices/user-devices.module';
import { ApiExceptionFilter } from './common/filters/api-exception.filter';
import { SlowRequestInterceptor } from './common/interceptors/slow-request.interceptor';

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
    ScheduleModule.forRoot(),
    EventEmitterModule.forRoot(),
    // In-process (memory) rate limiting by design: sufficient for the
    // single-instance deployment; counters reset on process restart.
    ThrottlerModule.forRoot([
      {
        ttl: 60_000,
        limit: 100,
      },
    ]),
    I18nModule,
    LoggerModule,
    MetricsModule,
    SseModule,
    BullmqModule,
    PrismaModule,
    AuditLogModule,
    UserDevicesModule,
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
    TodaySuggestionModule,
    UserSettingsModule,
    SupportResourcesModule,
    LegalDocumentsModule,
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
          UserDevicesModule,
          NotificationsModule,
          ReportsModule,
          UserSettingsModule,
          TodayAnalysisModule,
          TodaySuggestionModule,
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
