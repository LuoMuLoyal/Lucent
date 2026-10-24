import { Inject, Injectable, Logger } from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import type { Cache } from 'cache-manager';

import { FailureCounters } from '../../application/ports/failure-counters.js';

/**
 * `FailureCounters` 端口的 cache-manager 实现。
 *
 * ## 为什么包一层 try/catch 只为了日志
 *
 * 每个方法都把缓存异常**记日志后原样抛出**（不是吞掉）。这是 `AGENTS.md` 的
 * `error-handling/no-silent-catch` 要求，也是不变量 #2 的要求：限流依赖缓存，
 * 缓存故障必须让调用方看见并映射成 `DEPENDENCY_UNAVAILABLE`——
 * **绝不能返回「没有失败记录」**，那等于限流静默失效。
 *
 * ## 为什么不直接用 `RedisService`
 *
 * `Cache` 是项目统一的缓存抽象（`@nestjs/cache-manager` 注入），
 * 登录限流与密码重验限流原本就走它。换存储只改这一处。
 */
@Injectable()
export class CacheFailureCounters extends FailureCounters {
  private readonly logger = new Logger(CacheFailureCounters.name);

  constructor(@Inject(CACHE_MANAGER) private readonly cache: Cache) {
    super();
  }

  async read(key: string): Promise<unknown> {
    try {
      const value = await this.cache.get(key);
      return value ?? null;
    } catch (error) {
      this.logger.warn(
        `Failure-counter cache get failed (key=${key}): ${String(error)}`,
      );
      throw error;
    }
  }

  async write(key: string, value: unknown, ttlMs: number): Promise<void> {
    try {
      await this.cache.set(key, value, ttlMs);
    } catch (error) {
      this.logger.warn(
        `Failure-counter cache set failed (key=${key}): ${String(error)}`,
      );
      throw error;
    }
  }

  async clear(key: string): Promise<void> {
    try {
      await this.cache.del(key);
    } catch (error) {
      this.logger.warn(
        `Failure-counter cache delete failed (key=${key}): ${String(error)}`,
      );
      throw error;
    }
  }
}
