import {
  Inject,
  Injectable,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { WINSTON_MODULE_PROVIDER } from 'nest-winston';
import type { Logger as WinstonLogger } from 'winston';
import { PrismaPg } from '@prisma/adapter-pg';
import { Prisma, PrismaClient } from '#generated/prisma/client.js';
import { EnvKey } from '../config/env/env-keys.enum.js';
import { ConfigKey } from '../config/env/config-keys.enum.js';
import type { YamlConfig } from '../config/yaml/yaml-loader.js';
import { getActiveTraceId } from '../common/logger/trace-context.utils.js';
import {
  applySoftDeleteExtension,
  type ExtendedPrismaClient,
} from './prisma.extension.js';

/**
 * NestJS wrapper around the Prisma client with two architecture-level
 * enhancements (2026-07-17 architecture review, item 3):
 *
 * 1. **Soft-delete query variants** — the internal `_extended` client is
 *    created via `$extends` and exposes `nonDeleted` namespaces on the four
 *    models that carry a `deletedAt` column (User, UserDailyRecord,
 *    UserMedicineReminder, UserMedicineDoseLog).  Use
 *    `prisma.nonDeleted.user.findMany(...)` to automatically filter out
 *    soft-deleted rows without manually spreading `deletedAt: null`.
 *
 * 2. **Slow-query observability** — the `query` log level is emitted as an
 *    event; the `$on('query')` handler logs queries whose duration exceeds
 *    `SLOW_QUERY_THRESHOLD_MS` (default 500 ms) to Winston, including the
 *    SQL text (parameterised placeholders only — actual parameter values
 *    are never logged) and the current `traceId` for correlation.
 *
 * All existing model delegates (`this.user`, `this.userDailyRecord`, etc.)
 * continue to work unchanged; the extension only adds new properties.
 */
@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  private readonly _extended: ExtendedPrismaClient;
  private readonly _winstonLogger: WinstonLogger;
  private readonly _slowQueryThresholdMs: number;
  private readonly _configService: ConfigService;

  constructor(
    configService: ConfigService,
    @Inject(WINSTON_MODULE_PROVIDER) winstonLogger: WinstonLogger,
  ) {
    const connectionString = configService.get<string>(EnvKey.DATABASE_URL);
    if (connectionString === undefined) {
      // eslint-disable-next-line error-handling/no-bare-throw-error -- 构造函数在 DI 初始化阶段执行，ApiExceptionFilter 尚未就绪
      throw new Error(
        `Missing required environment variable: ${EnvKey.DATABASE_URL}`,
      );
    }
    const adapter = new PrismaPg({ connectionString });
    super({
      adapter,
      log: [
        'warn' as const,
        'error' as const,
        { emit: 'event' as const, level: 'query' as const },
      ],
    });

    this._winstonLogger = winstonLogger;
    this._configService = configService;
    const yaml = configService.getOrThrow<YamlConfig>(ConfigKey.Yaml);
    this._slowQueryThresholdMs = yaml.log.slowQueryThresholdMs;

    // ── Slow-query logging ──────────────────────────────────────────────
    // Every query emits a `QueryEvent` with `duration` (ms).  Only queries
    // above the threshold are forwarded to Winston to avoid log noise.
    // The `query` field contains parameterised SQL (e.g. `SELECT ... WHERE
    // id = $1`) — safe to log.  `params` is deliberately omitted.
    // Cast needed: `extends PrismaClient` defaults `LogOpts` to `never`,
    // making `$on<'query'>` not type-safe. At runtime, the `log` option
    // includes `{ emit: 'event', level: 'query' }` so the event fires.
    (
      this.$on as unknown as (
        event: 'query',
        cb: (e: Prisma.QueryEvent) => void,
      ) => void
    )('query', (e) => {
      if (e.duration >= this._slowQueryThresholdMs) {
        this._winstonLogger.warn('Slow query detected', {
          durationMs: e.duration,
          query: e.query,
          target: e.target,
          traceId: getActiveTraceId(),
        });
      }
    });

    // ── Extended client for soft-delete variants ───────────────────────
    // `$extends` returns a lightweight wrapper over the same connection;
    // it does NOT open a second pool.
    this._extended = applySoftDeleteExtension(this);
  }

  /**
   * Soft-delete-aware query variants for models with `deletedAt`.
   *
   * Each property exposes the `nonDeleted` namespace added by the Prisma
   * client extension.  For example:
   * ```ts
   * await prisma.nonDeleted.user.findMany({ where: { email } });
   * // equivalent to:
   * await prisma.user.findMany({ where: { email, deletedAt: null } });
   * ```
   */
  get nonDeleted() {
    return {
      user: this._extended.user.nonDeleted,
      userDailyRecord: this._extended.userDailyRecord.nonDeleted,
      userMedicineReminder: this._extended.userMedicineReminder.nonDeleted,
      userMedicineDoseLog: this._extended.userMedicineDoseLog.nonDeleted,
    };
  }

  async onModuleInit() {
    if (
      this._configService.get<string>(EnvKey.OPENAPI_EXPORT_SKIP_DB_CONNECT) ===
      'true'
    ) {
      return;
    }
    await this.$connect();
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
