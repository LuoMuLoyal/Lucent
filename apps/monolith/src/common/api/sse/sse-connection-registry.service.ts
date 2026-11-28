import {
  Injectable,
  Logger,
  Optional,
  type BeforeApplicationShutdown,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { ServerResponse } from 'node:http';
import { EnvKey } from '../../../config/env/env-keys.enum.js';
import { MetricsService } from '../../metrics/metrics.service.js';
import { writeSseEvent, type SseConnectionTracker } from './sse.js';
import { SseProblemDetailsMapper } from './sse-problem-details.js';

/** 已被接受的连接记录。 */
interface AcceptedConnection {
  language: string;
  /** 打开连接的用户；`undefined` 表示未认证视角（例如公共流）。 */
  userId?: string;
}

/**
 * 一次注册尝试的结果。
 *
 * 拒绝是**正常返回**而不是抛异常：SSE 在写完响应头之前的失败要走普通 HTTP
 * 语义（调用方据此回 503 Problem Details），而 `prepareSse` 负责在写好头之后
 * 才能写事件帧。返回判别式联合让调用点必须显式处理两条分支。
 */
export type SseRegistrationResult =
  | { accepted: true }
  | { accepted: false; reason: 'global_limit' | 'user_limit' };

/**
 * Tracks every open SSE connection so a shutdown (SIGTERM →
 * `app.enableShutdownHooks()` → `beforeApplicationShutdown`) can notify
 * clients with a terminal event and end their streams instead of letting
 * the process kill them mid-flight. `closeAll` is deliberately
 * non-blocking: it writes the terminal event best-effort and ends each
 * response without awaiting client drains.
 *
 * ## 为什么需要上限
 *
 * 长连接不消耗 CPU，但每条连接持有 response 缓冲、流上下文与上游生产者
 * （LLM/检索）的引用，内存随并发线性增长。没有上限时，几百条连接就能把进程
 * RSS 顶到数 GB，进而拖垮同一进程里的 HTTP 服务。因此：
 *
 * - **实例级总上限** `SSE_MAX_CONNECTIONS`（默认 500）：防止整机被拖爆；
 * - **单用户上限** `SSE_MAX_CONNECTIONS_PER_USER`（默认 3）：防止单个账号
 *   刷爆总配额，把其他用户挡在门外。
 *
 * 超限一律拒绝而不是排队：SSE 的语义是"立刻开始推送"，排队既无意义又会
 * 让调用方悬挂。
 */
@Injectable()
export class SseConnectionRegistry
  implements SseConnectionTracker, BeforeApplicationShutdown
{
  private readonly logger = new Logger(SseConnectionRegistry.name);
  private readonly connections = new Map<ServerResponse, AcceptedConnection>();
  /** 每个用户当前占用的连接数，用于快速判定单用户上限。 */
  private readonly perUserCounts = new Map<string, number>();
  private readonly maxConnections: number;
  private readonly maxConnectionsPerUser: number;

  constructor(
    private readonly problemDetails: SseProblemDetailsMapper,
    configService: ConfigService,
    @Optional() private readonly metrics?: MetricsService,
  ) {
    this.maxConnections = Number(
      configService.get<string>(EnvKey.SSE_MAX_CONNECTIONS) ?? 500,
    );
    this.maxConnectionsPerUser = Number(
      configService.get<string>(EnvKey.SSE_MAX_CONNECTIONS_PER_USER) ?? 3,
    );
  }

  /** Number of currently tracked connections. */
  get size(): number {
    return this.connections.size;
  }

  /** 当前打开连接数，供 metrics 采集。 */
  get activeConnections(): number {
    return this.connections.size;
  }

  /**
   * 尝试接纳一条连接。返回判别式结果，不抛异常 —— 调用方据 `reason` 决定
   * 回 503 还是照常继续。
   */
  tryRegister(
    response: ServerResponse,
    language = 'en',
    userId?: string,
  ): SseRegistrationResult {
    if (this.connections.size >= this.maxConnections) {
      this.logger.warn(
        `SSE connection rejected: instance limit ${String(this.maxConnections)} reached`,
      );
      return { accepted: false, reason: 'global_limit' };
    }

    if (userId != null) {
      const current = this.perUserCounts.get(userId) ?? 0;
      if (current >= this.maxConnectionsPerUser) {
        this.logger.warn(
          `SSE connection rejected: user limit ${String(this.maxConnectionsPerUser)} reached`,
        );
        return { accepted: false, reason: 'user_limit' };
      }
      this.perUserCounts.set(userId, current + 1);
    }

    this.connections.set(response, {
      language,
      ...(userId == null ? {} : { userId }),
    });
    this.publishGauge();
    // Client disconnects / network resets surface as `close`; drop the
    // connection so closeAll never writes to a dead socket.
    response.once('close', () => {
      this.unregister(response);
    });
    return { accepted: true };
  }

  /** `SseConnectionTracker` 兼容签名：只登记、不判定。 */
  register(response: ServerResponse, language = 'en'): void {
    void this.tryRegister(response, language);
  }

  unregister(response: ServerResponse): void {
    const entry = this.connections.get(response);
    if (entry === undefined) {
      return;
    }
    this.connections.delete(response);
    if (entry.userId != null) {
      const next = (this.perUserCounts.get(entry.userId) ?? 1) - 1;
      if (next <= 0) {
        this.perUserCounts.delete(entry.userId);
      } else {
        this.perUserCounts.set(entry.userId, next);
      }
    }
    this.publishGauge();
  }

  private publishGauge(): void {
    this.metrics?.setSseActiveConnections(this.connections.size);
  }

  closeAll(): void {
    const count = this.connections.size;
    for (const [response, entry] of this.connections) {
      this.connections.delete(response);
      if (entry.userId != null) {
        this.perUserCounts.delete(entry.userId);
      }
      try {
        writeSseEvent(response, {
          event: 'error',
          data: this.problemDetails.build(new Error('server shutdown'), {
            lang: entry.language,
            code: 'SERVER_SHUTDOWN',
            status: 'server_shutdown',
          }),
        });
        if (!response.writableEnded) {
          response.end();
        }
      } catch (error) {
        // Best-effort: one broken connection must not abort the shutdown,
        // but we log it so operators can diagnose leaks during graceful shutdown.
        this.logger.warn(
          {
            error: error instanceof Error ? error.message : String(error),
          },
          'Failed to close SSE connection during shutdown',
        );
      }
    }
    this.perUserCounts.clear();
    this.publishGauge();
    if (count > 0) {
      this.logger.log(
        `Closed ${String(count)} active SSE connection(s) for server shutdown`,
      );
    }
  }

  beforeApplicationShutdown(): void {
    this.closeAll();
  }
}
