import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import type { Cache } from 'cache-manager';
import { ConfigService } from '@nestjs/config';

import { RedisService } from '../../../../common/index.js';
import {
  createDomainFailure,
  errAsync,
  fromPromise,
  okAsync,
  type DomainFailure,
  type ResultAsync,
} from '../../../../common/result/index.js';
import { EnvKey } from '../../../../config/env/env-keys.enum.js';
import { RuntimeConfigService } from '../../../../config/runtime/runtime-config.service.js';
import type { RuntimeConfigPort } from '../../../../config/runtime/runtime-config.types.js';
import { MailService } from '../../../../mail/mail.service.js';
import type { VerificationScene } from '../../dto/password/send-verification-code.dto.js';
import {
  MAX_CHALLENGE_ATTEMPTS,
  VerificationChallenge,
  type ChallengeState,
  type ChallengeVerdict,
} from '../../domain/challenge/challenge.js';
import {
  deriveCodeHash,
  generateCode,
} from '../../domain/challenge/verification-code.js';

interface RateLimitBucket {
  count: number;
  resetAt: number;
}

/**
 * Manages product-level anti-abuse verification codes for register, login,
 * set-password, change-email, and delete-account flows. Codes are stored in
 * cache (not the database) and are distinct from the emailed verification and
 * password-reset tokens issued by `EmailVerificationService`.
 */
@Injectable()
export class VerificationCodeService {
  private static readonly CACHE_KEY_PREFIX = 'vcode';

  private readonly logger = new Logger(VerificationCodeService.name);

  private readonly envCodeTtlMs: number;
  private readonly envCooldownTtlMs: number;
  private readonly envRateLimitWindowMs: number;
  private readonly envRateLimitMaxRequests: number;
  private readonly envCodeLength: number;

  constructor(
    @Inject(CACHE_MANAGER) private readonly cache: Cache,
    private readonly mailService: MailService,
    private readonly configService: ConfigService,
    private readonly redisService: RedisService,
    @Optional()
    @Inject(RuntimeConfigService)
    private readonly runtimeConfig?: RuntimeConfigPort,
  ) {
    this.envCodeTtlMs = Number(
      this.configService.get<string>(EnvKey.VERIFICATION_CODE_TTL_MS),
    );
    this.envCooldownTtlMs = Number(
      this.configService.get<string>(EnvKey.VERIFICATION_COOLDOWN_MS),
    );
    this.envRateLimitWindowMs = Number(
      this.configService.get<string>(EnvKey.VERIFICATION_RATE_LIMIT_WINDOW_MS),
    );
    this.envRateLimitMaxRequests = Number(
      this.configService.get<string>(EnvKey.VERIFICATION_RATE_LIMIT_MAX),
    );
    this.envCodeLength = Number(
      this.configService.get<string>(EnvKey.VERIFICATION_CODE_LENGTH),
    );

    this.assertVerificationConfig();
  }

  /**
   * Current anti-abuse settings. Read on every issue/verify so a published
   * document applies to the next code; the startup assert below still guards
   * the env baseline. A published cooldown longer than the code TTL is clamped,
   * otherwise the last part of the cooldown would guard a code that is already
   * gone.
   */
  private readSettings(): {
    codeTtlMs: number;
    cooldownTtlMs: number;
    rateLimitWindowMs: number;
    rateLimitMaxRequests: number;
    codeLength: number;
  } {
    const values = this.runtimeConfig?.getSnapshot().values;
    const codeTtlMs =
      values?.[EnvKey.VERIFICATION_CODE_TTL_MS] ?? this.envCodeTtlMs;
    return {
      codeTtlMs,
      cooldownTtlMs: Math.min(
        values?.[EnvKey.VERIFICATION_COOLDOWN_MS] ?? this.envCooldownTtlMs,
        codeTtlMs,
      ),
      rateLimitWindowMs:
        values?.[EnvKey.VERIFICATION_RATE_LIMIT_WINDOW_MS] ??
        this.envRateLimitWindowMs,
      rateLimitMaxRequests:
        values?.[EnvKey.VERIFICATION_RATE_LIMIT_MAX] ??
        this.envRateLimitMaxRequests,
      codeLength:
        values?.[EnvKey.VERIFICATION_CODE_LENGTH] ?? this.envCodeLength,
    };
  }

  /**
   * Fail-fast sanity checks for the verification config. A misconfigured
   * env value (e.g. cooldown > code TTL, or zero/negative TTLs) silently
   * breaks rate-limiting and code expiry, so the service refuses to start
   * instead of running in a broken state.
   */
  private assertVerificationConfig(): void {
    const codeTtlMs = this.envCodeTtlMs;
    const cooldownTtlMs = this.envCooldownTtlMs;
    const rateLimitMaxRequests = this.envRateLimitMaxRequests;
    const fail = (message: string): never => {
      // eslint-disable-next-line error-handling/no-bare-throw-error -- DI init: config validation is exempt
      throw new Error(message);
    };

    if (codeTtlMs <= 0) {
      fail(
        `verification.codeTtlMs must be positive (got ${String(codeTtlMs)})`,
      );
    }
    if (cooldownTtlMs <= 0) {
      fail(
        `verification.cooldownMs must be positive (got ${String(cooldownTtlMs)})`,
      );
    }
    if (cooldownTtlMs > codeTtlMs) {
      fail(
        `verification.cooldownMs (${String(cooldownTtlMs)}) must not exceed codeTtlMs (${String(codeTtlMs)})`,
      );
    }
    if (rateLimitMaxRequests <= 0) {
      fail(
        `verification.rateLimitMax must be positive (got ${String(rateLimitMaxRequests)})`,
      );
    }
  }

  /** Cooldown period in seconds (exposed for API response). */
  getCooldownSec(): number {
    return Math.floor(this.readSettings().cooldownTtlMs / 1000);
  }

  /**
   * 生成并发送验证码。
   * 内部处理客户端窗口限流和同邮箱 cooldown。
   *
   * 预期业务失败以 DomainFailure 返回：客户端窗口超限使用
   * AUTH_VERIFICATION_CODE_RATE_LIMITED，冷却使用
   * AUTH_VERIFICATION_CODE_COOLDOWN。缓存/Redis/邮件等基础设施故障
   * 保留原始异常向边界抛出，不得伪装成“发送成功”或业务限流。
   */
  send(
    email: string,
    scene: VerificationScene,
    clientKey?: string,
    locale?: string,
  ): ResultAsync<void, DomainFailure> {
    return this.assertClientRateLimit(clientKey).andThen(() =>
      this.issueCodeAndSend(email, scene, locale),
    );
  }

  assertClientRateLimit(
    clientKey = 'unknown',
  ): ResultAsync<void, DomainFailure> {
    const settings = this.readSettings();
    const key = this.clientRateLimitKey(clientKey);

    // Prefer atomic Redis INCR when available — eliminates the race
    // condition where concurrent requests could all read the same stale
    // count and bypass the limit.
    if (this.redisService.isAvailable) {
      return this.lift(
        this.redisService.atomicIncrement(key, settings.rateLimitWindowMs),
      ).andThen((count) => {
        if (count > settings.rateLimitMaxRequests) {
          return errAsync(
            createDomainFailure({
              kind: 'rate_limited',
              code: 'AUTH_VERIFICATION_CODE_RATE_LIMITED',
              retryable: true,
              // Conservative estimate: the Redis window has no per-request
              // resetAt, so advertise the full window as the retry delay.
              retryAfter: Math.ceil(settings.rateLimitWindowMs / 1000),
            }),
          );
        }
        return okAsync(undefined);
      });
    }

    // Fall back to non-atomic cache-based rate limiting when Redis is
    // not directly available (e.g. in-memory cache in test/dev).
    const now = Date.now();
    return this.lift(this.cacheGet(key)).andThen((value) => {
      const bucket = value as RateLimitBucket | undefined;

      if (!this.isValidBucket(bucket) || bucket.resetAt <= now) {
        return this.lift(
          this.cacheSet(
            key,
            { count: 1, resetAt: now + settings.rateLimitWindowMs },
            settings.rateLimitWindowMs,
          ),
        );
      }

      if (bucket.count >= settings.rateLimitMaxRequests) {
        return errAsync(
          createDomainFailure({
            kind: 'rate_limited',
            code: 'AUTH_VERIFICATION_CODE_RATE_LIMITED',
            retryable: true,
            retryAfter: Math.max(0, Math.ceil((bucket.resetAt - now) / 1000)),
          }),
        );
      }

      return this.lift(
        this.cacheSet(
          key,
          { count: bucket.count + 1, resetAt: bucket.resetAt },
          bucket.resetAt - now,
        ),
      );
    });
  }

  /**
   * 校验验证码。成功后自动删除（一次性）。
   *
   * ## 判定在聚合里，这里只做「读 → 判定 → 写回」
   *
   * 四条不变量（单次消费、过期不可用、尝试次数上限、指纹绑定场景与邮箱）都在
   * `domain/challenge/challenge.ts` 的 `VerificationChallenge`。本方法负责把它
   * 接上缓存：读条目 → `from()` 重建聚合 → `verify()` 判定 → 按 `nextState`
   * 写回（成功时删除、失败时递增计数、猜爆时写回上限）。
   *
   * ## 尝试次数上限是本次新增的（行为变更）
   *
   * 迁移前**没有失败计数**：`verify` 比对不匹配就返回错误，该码仍然有效，
   * 可以无限次尝试。风险最大的是 `forgot-password → reset-password`——猜中码
   * 等于直接改密码，而该路径没有按邮箱的尝试计数。现在连续猜错
   * `MAX_CHALLENGE_ATTEMPTS`(5) 次即作废该码。
   *
   * ## 错误码为什么仍是 EXPIRED / MISMATCH
   *
   * 聚合的 verdict 有 `mismatch` / `exhausted` / `expired` / `absent` 四种，
   * 但对外只映射两个既有码：
   *
   * | verdict | 错误码 |
   * | --- | --- |
   * | `mismatch` | `AUTH_VERIFICATION_CODE_MISMATCH` |
   * | `exhausted` | `AUTH_VERIFICATION_CODE_EXPIRED` |
   * | `expired` / `absent` | `AUTH_VERIFICATION_CODE_EXPIRED` |
   *
   * **`exhausted` 映射成 EXPIRED 而不是新码**：它对外就是「这个码不能用了，
   * 重新获取」。新造一个码会告诉攻击者「你把这码猜爆了」——那是进度反馈。
   * 缓存层保留条目（不删除）让运维能在日志里区分「猜爆」与「过期」，
   * 而这两者对用户和攻击者都是同一件事。
   */
  verify(
    email: string,
    code: string,
    scene: VerificationScene,
  ): ResultAsync<void, DomainFailure> {
    const codeKey = this.codeKey(scene, email);

    return this.lift(this.cacheGet(codeKey)).andThen((value) => {
      const state = this.toChallengeState(value);

      if (state === undefined) {
        return errAsync(this.codeExpiredFailure());
      }

      const result = VerificationChallenge.from(state).verify(code);

      if (result.verdict.kind === 'accepted') {
        // 单次消费：成功即删除条目。
        return this.lift(this.cacheDel(codeKey)).map(() => undefined);
      }

      if (result.verdict.kind === 'exhausted') {
        this.logger.warn(
          { scene, attempts: MAX_CHALLENGE_ATTEMPTS },
          'Verification challenge exhausted',
        );
      }

      // 写回递增后的计数；猜爆时它已到上限，后续校验一律 exhausted。
      // TTL 用剩余 TTL 而不是原始 TTL：写回不该延长码的寿命。
      return this.lift(
        this.cacheSet(
          codeKey,
          result.nextState,
          this.remainingTtlMs(state.issuedAtMs),
        ),
      ).andThen(() => errAsync(this.codeFailureFor(result.verdict)));
    });
  }

  /** 聚合 verdict → 对外错误码。见 {@link verify} 的表格。 */
  private codeFailureFor(verdict: ChallengeVerdict): DomainFailure {
    return createDomainFailure({
      kind: 'authentication',
      code:
        verdict.kind === 'mismatch'
          ? 'AUTH_VERIFICATION_CODE_MISMATCH'
          : 'AUTH_VERIFICATION_CODE_EXPIRED',
    });
  }

  private codeExpiredFailure(): DomainFailure {
    return createDomainFailure({
      kind: 'authentication',
      code: 'AUTH_VERIFICATION_CODE_EXPIRED',
    });
  }

  /**
   * 写回时的 TTL：从签发时刻算起的剩余寿命。
   *
   * 用剩余值而不是完整 TTL，是为了让「猜错 4 次」不延长码的有效期——
   * 否则攻击者可以靠不断猜错把码永远留住。
   */
  private remainingTtlMs(issuedAtMs: number): number {
    const elapsed = Date.now() - issuedAtMs;
    const remaining = this.readSettings().codeTtlMs - elapsed;
    // 下限 1ms：`cache.set` 传 0/负数在各后端行为不一致（有的当立即过期，
    // 有的当永不过期）。给一个极小的正值，语义是「马上过期」。
    return Math.max(1, remaining);
  }

  // ── Private Helpers ──────────────────────────────────────────

  private issueCodeAndSend(
    email: string,
    scene: VerificationScene,
    locale?: string,
  ): ResultAsync<void, DomainFailure> {
    const settings = this.readSettings();
    const cooldownKey = this.cooldownKey(scene, email);

    return this.lift(this.cacheGet(cooldownKey)).andThen((inCooldown) => {
      if (inCooldown) {
        return errAsync(
          createDomainFailure({
            kind: 'rate_limited',
            code: 'AUTH_VERIFICATION_CODE_COOLDOWN',
            retryable: true,
            retryAfter: this.getCooldownSec(),
          }),
        );
      }

      const code = generateCode(settings.codeLength);
      const codeKey = this.codeKey(scene, email);

      // 存**聚合状态**而不是裸指纹：`attempts` 与码必须同时成立，放在同一个
      // 缓存条目里，作废与清零就是同一个原子操作（见 challenge.ts 头注释）。
      const issuedState: ChallengeState = {
        scene,
        email,
        codeHash: deriveCodeHash(code, scene, email),
        attempts: 0,
        issuedAtMs: Date.now(),
      };

      // Store code hash in cache (never store plaintext codes)
      return this.lift(this.cacheSet(codeKey, issuedState, settings.codeTtlMs))
        .andThen(() =>
          this.lift(this.cacheSet(cooldownKey, '1', settings.cooldownTtlMs)),
        )
        .andThen(() =>
          this.lift(this.mailService.sendVerificationCode(email, code, locale)),
        )
        .map(() => {
          this.logger.log(
            `Verification code sent: scene=${scene}, email=${email}`,
          );
        });
    });
  }

  /**
   * 将缓存/Redis/邮件等非 Prisma IO 提升为 ResultAsync。
   * 这些基础设施故障不是可恢复的业务失败：保留原始异常向边界抛出，
   * 由全局 filter 处理，不得把依赖故障伪装成业务失败。
   */
  private lift<T>(promise: Promise<T>): ResultAsync<T, DomainFailure> {
    return fromPromise(promise, (error) => {
      throw error;
    });
  }

  private codeKey(scene: string, email: string): string {
    return `${VerificationCodeService.CACHE_KEY_PREFIX}:${scene}:${email}`;
  }

  private cooldownKey(scene: string, email: string): string {
    return `${VerificationCodeService.CACHE_KEY_PREFIX}:cd:${scene}:${email}`;
  }

  private clientRateLimitKey(clientKey: string): string {
    const digest = createHash('sha256').update(clientKey).digest('hex');
    return `${VerificationCodeService.CACHE_KEY_PREFIX}:rl:client:${digest}`;
  }

  private isValidBucket(bucket: unknown): bucket is RateLimitBucket {
    if (typeof bucket !== 'object' || bucket === null) {
      return false;
    }

    const candidate = bucket as Partial<RateLimitBucket>;
    return (
      typeof candidate.count === 'number' &&
      typeof candidate.resetAt === 'number'
    );
  }

  /**
   * 从缓存条目还原挑战状态。
   *
   * `@keyv/redis` 会把值 JSON 化后落库，`issuedAt: Date` 读回来是 ISO 字符串，
   * 到 `remainingTtlMs` 里就成了 `TypeError: ...getTime is not a function`——
   * 猜错验证码这条**正常业务路径**因此变成 500。所以反序列化必须和序列化对称，
   * 收敛在这个唯一的存储边界上，而不是让每个调用方各自防御。
   *
   * 形状不认识就返回 `undefined`（等价于「该码不存在」）：缓存条目可能来自
   * 旧版本或被打坏，那同样是不能用的码，不该抛成服务端故障。
   */
  private toChallengeState(value: unknown): ChallengeState | undefined {
    if (typeof value !== 'object' || value === null) {
      return undefined;
    }

    const candidate = value as Record<string, unknown>;
    // 兼容旧条目：更早的版本把这一格存成 `issuedAt: Date`（JSON 往返后是字符串），
    // 读老数据仍要能算 TTL，否则升级瞬间在途的码会被当场判失效。
    const issuedAtMs = this.toEpochMs(
      candidate['issuedAtMs'] ?? candidate['issuedAt'],
    );

    if (
      typeof candidate['scene'] !== 'string' ||
      typeof candidate['email'] !== 'string' ||
      typeof candidate['codeHash'] !== 'string' ||
      typeof candidate['attempts'] !== 'number' ||
      issuedAtMs === undefined
    ) {
      return undefined;
    }

    return {
      scene: candidate['scene'],
      email: candidate['email'],
      codeHash: candidate['codeHash'],
      attempts: candidate['attempts'],
      issuedAtMs,
    };
  }

  private toEpochMs(value: unknown): number | undefined {
    if (typeof value === 'number') {
      return Number.isFinite(value) ? value : undefined;
    }
    if (typeof value === 'string') {
      const parsed = Date.parse(value);
      return Number.isNaN(parsed) ? undefined : parsed;
    }
    // 内存 store（无 Redis 时的回退）不做 JSON 往返，拿到的是真正的 Date。
    if (value instanceof Date) {
      const time = value.getTime();
      return Number.isNaN(time) ? undefined : time;
    }
    return undefined;
  }

  private async cacheGet(key: string): Promise<unknown> {
    try {
      return await this.cache.get(key);
    } catch (error) {
      this.logger.warn(
        `Verification-code cache get failed (key=${key}): ${String(error)}`,
      );
      throw error;
    }
  }

  private async cacheSet(
    key: string,
    value: unknown,
    ttl: number,
  ): Promise<void> {
    try {
      await this.cache.set(key, value, ttl);
    } catch (error) {
      this.logger.warn(
        `Verification-code cache set failed (key=${key}): ${String(error)}`,
      );
      throw error;
    }
  }

  private async cacheDel(key: string): Promise<void> {
    try {
      await this.cache.del(key);
    } catch (error) {
      this.logger.warn(
        `Verification-code cache delete failed (key=${key}): ${String(error)}`,
      );
      throw error;
    }
  }
}
