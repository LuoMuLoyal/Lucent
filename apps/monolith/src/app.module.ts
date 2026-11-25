import { Module } from '@nestjs/common';
import { CacheModule } from '@nestjs/cache-manager';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { RouterModule } from '@nestjs/core';
import { ThrottlerModule } from '@nestjs/throttler';
import { buildThrottlerOptions } from './config/services/throttler.config.js';
import { TerminusModule } from '@nestjs/terminus';
import { APP_GUARD } from '@nestjs/core';
import { JwtAuthGuard } from './modules/auth/index.js';
import { appConfig } from './config/app.config.js';
import { llmConfig } from './config/services/llm.config.js';
import { jwtConfig } from './config/services/jwt.config.js';
import { oauthConfig } from './config/services/oauth.config.js';
import { turnstileConfig } from './config/services/turnstile.config.js';
import { generativeSurfaceConfig } from './config/services/generative-surface.config.js';
import { tencentCosConfig } from './config/services/tencent-cos.config.js';
import { s3StorageConfig } from './config/services/s3-storage.config.js';
import { aliyunOssConfig } from './config/services/aliyun-oss.config.js';
import { jpushConfig } from './config/services/jpush.config.js';
import { getEnvFilePaths } from './config/env/env-file-paths.js';
import { isRunningFromSource } from './config/env/runtime-signal.js';
import { EnvKey } from './config/env/env-keys.enum.js';
import { validatedEnvSchema } from './config/env/environment.validation.js';
import { RuntimeConfigModule } from './config/runtime/runtime-config.module.js';
import { AuthModule } from './modules/auth/auth.module.js';
import { AdminModule } from './modules/admin/admin.module.js';
import { AdminMetricsModule } from './modules/admin/admin-metrics.module.js';
import { MailModule } from './mail/mail.module.js';
import { PrismaModule } from './prisma/index.js';
import { CacheConfigService } from './config/services/cache.config.js';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { I18nModule } from './i18n/i18n.module.js';
import { LoggerModule } from './common/logger/logger.module.js';
import { MetricsModule } from './common/metrics/metrics.module.js';
import { SseModule } from './common/index.js';
import { DomainEventsModule } from './common/events/domain-events.module.js';
import { BullmqModule } from './common/queue/queue.module.js';
import { CronJobsModule } from './common/queue/cron-jobs.module.js';
import { RedisModule } from './common/redis/redis.module.js';
import { MedicinesModule } from './modules/medicines/medicines.module.js';
import { RecordModule } from './modules/record/record.module.js';
import { DoseModule } from './modules/dose/dose.module.js';
import { HealthEventsModule } from './modules/health-events/health-events.module.js';
import { ReminderModule } from './modules/reminder/reminder.module.js';
import { ContextModule } from './modules/context/context.module.js';
import { AccountModule } from './modules/account/account.module.js';
import { EnvironmentModule } from './modules/environment/environment.module.js';
import { ReportsModule } from './modules/reports/reports.module.js';
import { SettingsModule } from './modules/settings/settings.module.js';
import { AppInfoModule } from './modules/app-info/app-info.module.js';
import { LegalModule } from './modules/legal/legal.module.js';
import { ExportModule } from './modules/export/export.module.js';
import { FilesModule } from './modules/files/files.module.js';
import { NotificationsModule } from './modules/notifications/notifications.module.js';
import { NotificationModule } from './modules/notification/notification.module.js';
import { ProductModule } from './modules/product/product.module.js';
import { LayoutsModule } from './modules/layouts/layouts.module.js';
import { TestingModule } from './modules/testing/testing.module.js';
import { LlmRuntimeModule } from './llm-runtime/llm-runtime.module.js';
import { AnalysisModule } from './modules/analysis/analysis.module.js';
import { SuggestionModule } from './modules/suggestion/suggestion.module.js';
import { AssistantModule } from './modules/assistant/assistant.module.js';
import { McpModule } from './modules/assistant/adapters/mcp/mcp.module.js';
import { AuditLogModule } from './modules/audit-log/audit-log.module.js';
import { RetentionModule } from './modules/retention/retention.module.js';
import { ApiExceptionFilter } from './common/filters/api-exception.filter.js';
import {
  RuntimeThrottlerGuard,
  SlowRequestInterceptor,
} from './common/index.js';
import {
  AppInfoHealthIndicator,
  CacheHealthIndicator,
  DatabaseHealthIndicator,
} from './common/index.js';

/**
 * Root application module. Wires configuration, persistence, common
 * infrastructure, and all feature modules together.
 */

// Bootstrap-stage env gate (ConfigService is not available before DI). The
// testing module mounts only for an explicit test run AND while the
// process executes from source: a compiled image never mounts it, even
// if NODE_ENV were misconfigured to "test" on a production host. Same
// src-vs-dist signal i18n.module.ts uses for its dev-only typesOutputPath
// (see `config/env/runtime-signal.ts`). `EnvKey.NODE_ENV` keeps the read on
// the same typed key as `app.config.ts` instead of a raw string literal.
const isTestRuntime =
  process.env[EnvKey.NODE_ENV] === 'test' && isRunningFromSource();

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: getEnvFilePaths(),
      load: [
        appConfig,
        llmConfig,
        jwtConfig,
        oauthConfig,
        turnstileConfig,
        generativeSurfaceConfig,
        tencentCosConfig,
        s3StorageConfig,
        aliyunOssConfig,
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
    // Rate limiting: Redis-backed when REDIS_URL is set, in-memory fallback.
    // useFactory + inject resolves ConfigService through DI (ConfigService is
    // global) instead of re-instantiating a useClass placeholder; `imports`
    // stays explicit per the throttler ^6.5 typings.
    ThrottlerModule.forRootAsync({
      imports: [],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) =>
        buildThrottlerOptions(configService),
    }),
    I18nModule,
    LoggerModule,
    MetricsModule,
    DomainEventsModule,
    RuntimeConfigModule,
    SseModule,
    BullmqModule,
    CronJobsModule,
    RedisModule,
    PrismaModule,
    TerminusModule,
    AuditLogModule,
    RetentionModule,
    MailModule,
    AuthModule,
    AdminModule,
    AdminMetricsModule,
    AccountModule,
    MedicinesModule,
    ContextModule,
    RecordModule,
    DoseModule,
    HealthEventsModule,
    ReminderModule,
    EnvironmentModule,
    ReportsModule,
    LlmRuntimeModule,
    AssistantModule,
    // MCP 是对外协议出口（`/api/v1/mcp`），与 assistant 的会话流程分开：
    // 由 MCP_ENABLED 独立开关，路由在它自己的 onModuleInit 里注册。
    McpModule,
    AnalysisModule,
    SuggestionModule,
    SettingsModule,
    AppInfoModule,
    LegalModule,
    ExportModule,
    FilesModule,
    NotificationsModule,
    ProductModule,
    // Mounted at the top level (not under the `user` prefix): layouts are their
    // own resource line, and `:surface` is already a path segment. See
    // `src/modules/layouts/README.md` for why this is not `/user/layouts`.
    LayoutsModule,
    ...(isTestRuntime ? [TestingModule] : []),
    NotificationModule,
    RouterModule.register([
      {
        path: 'user',
        children: [
          AssistantModule,
          RecordModule,
          ExportModule,
          FilesModule,
          ContextModule,
          DoseModule,
          HealthEventsModule,
          ReminderModule,
          NotificationsModule,
          ProductModule,
          ReportsModule,
          SettingsModule,
          AnalysisModule,
          SuggestionModule,
          NotificationModule,
        ],
      },
    ]),
  ],
  controllers: [AppController],
  providers: [
    AppService,
    AppInfoHealthIndicator,
    CacheHealthIndicator,
    DatabaseHealthIndicator,
    ApiExceptionFilter,
    SlowRequestInterceptor,
    {
      provide: APP_GUARD,
      useClass: RuntimeThrottlerGuard,
    },
    {
      provide: APP_GUARD,
      useClass: JwtAuthGuard,
    },
  ],
})
export class AppModule {}
