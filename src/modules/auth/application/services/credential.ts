import { Injectable } from '@nestjs/common';

import { normalizeEmail, now } from '../../../../common/index.js';
import {
  errAsync,
  fromPromise,
  mapUnknownToDependencyFailure,
  okAsync,
  type DomainFailure,
  type ResultAsync,
} from '../../../../common/result/index.js';
import type { User } from '#generated/prisma/client.js';
import { UserStatus } from '#generated/prisma/client.js';
import { UserService } from '../../../user/index.js';
import { AuthIdentityService, type LocalPasswordCheck } from './identity.js';
import {
  decideCredential,
  type CredentialDecision,
  type CredentialFacts,
} from '../../domain/account/credential-verdict.js';
import {
  credentialsInvalidFailure,
  shouldCountLoginFailure,
  toCredentialFailure,
} from './credential-failures.js';
import type { RegisterDto } from '../../dto/credentials/register.dto.js';
import type { LoginDto } from '../../dto/credentials/login.dto.js';
import { SessionTokens, type TokenPair } from './session-tokens.js';
import type { RequestOrigin } from '../../application/ports/request-origin.js';
import { toSessionSubject } from './session-subject.js';

import { AuthRateLimitService } from './rate-limit.js';
import { HumanVerification } from '../../application/ports/human-verification.js';
import { VerificationCodeService } from '../../services/identity/verification-code.service.js';

/**
 * Handles email/password credential flows: registration and login.
 *
 * Password management (change/set/reset), email changes and verification
 * codes live in `PasswordManagementService`.
 *
 * All expected business failures are expressed as
 * `ResultAsync<T, DomainFailure>`. Unknown exceptions, config errors and
 * dependency-level failures (Argon2 hashing, DB, token signing, cache) are
 * returned as `internal` or `dependency` DomainFailures so they keep their
 * real semantics instead of being misreported as wrong credentials.
 */
@Injectable()
export class CredentialAuthService {
  constructor(
    private readonly userService: UserService,
    private readonly verificationCodeService: VerificationCodeService,
    private readonly sessionTokens: SessionTokens,
    private readonly authRateLimitService: AuthRateLimitService,
    private readonly authIdentityService: AuthIdentityService,
    private readonly turnstileService: HumanVerification,
  ) {}

  // ── Registration ─────────────────────────────────────────────

  register(
    dto: RegisterDto,
    context?: RequestOrigin,
  ): ResultAsync<{ user: User } & TokenPair, DomainFailure> {
    const email = normalizeEmail(dto.email);
    const name = dto.nickname?.trim() || email.split('@')[0] || 'User';

    // Human verification comes first: registration is the cheapest path to a
    // bot account, so a request that never proved it came from a browser must
    // not spend an Argon2 hash or a verification code.
    // Anti-enumeration: the verification code is validated before the
    // email-existence check, so probing the endpoint cannot distinguish an
    // already-registered email from a wrong code (both look identical unless
    // a valid code is supplied).
    return this.turnstileService
      .verify(dto.captchaToken, context?.ipAddress)
      .andThen(() =>
        this.verificationCodeService.verify(email, dto.code, 'register'),
      )
      .andThen(() =>
        fromPromise(
          this.authIdentityService.hashPassword(dto.password),
          (error) =>
            mapUnknownToDependencyFailure(error, 'Password hashing failed'),
        ),
      )
      .andThen((passwordHash) =>
        this.authIdentityService.createLocalUser({
          email,
          passwordHash,
          nickname: name,
        }),
      )
      .andThen(({ user, created }) => {
        if (!created) {
          // The email is already registered.  Deliberately the same code as
          // other credential failures — never reveal that the email is taken.
          return errAsync(credentialsInvalidFailure());
        }
        return this.lift(this.userService.findById(user.id));
      })
      .andThen((user) => {
        if (!user) {
          return errAsync(credentialsInvalidFailure());
        }
        return this.userService
          .update(user.id, {
            emailVerified: true,
            emailVerifiedAt: now(),
          })
          .andThen((updatedUser) =>
            this.sessionTokens
              .issue(toSessionSubject(updatedUser), context)
              .map((tokens) => ({ user: updatedUser, ...tokens })),
          );
      });
  }

  // ── Login ────────────────────────────────────────────────────

  login(
    dto: LoginDto,
    context?: RequestOrigin,
  ): ResultAsync<{ user: User } & TokenPair, DomainFailure> {
    const email = normalizeEmail(dto.email);

    return this.authRateLimitService
      .checkLoginRateLimit(email)
      .andThen(() =>
        this.authRateLimitService
          .isCaptchaRequired(email)
          .andThen((required) =>
            required
              ? this.turnstileService.verify(
                  dto.captchaToken,
                  context?.ipAddress,
                )
              : okAsync(undefined),
          ),
      )
      .andThen(() => this.lift(this.userService.findByEmail(email)))
      .andThen((user) => this.verifyLoginCredentials(email, dto, user))
      .andThen((user) =>
        this.authRateLimitService
          .clearLoginFailures(email)
          .andThen(() =>
            this.userService.update(user.id, {
              lastLoginAt: now(),
              status: UserStatus.active,
            }),
          )
          .andThen((updatedUser) =>
            this.sessionTokens
              .issue(toSessionSubject(updatedUser), context)
              .map((tokens) => ({ user: updatedUser, ...tokens })),
          ),
      );
  }

  // ── Helpers ──────────────────────────────────────────────────

  /**
   * Validates the provided password (or verification code) for a login attempt.
   *
   * ## 这一层现在只做两件事：**收集事实** 与 **映射结论**
   *
   * 判定本身是一个纯函数（`domain/account/credential-verdict.ts` 的
   * `decideCredential`）。这里负责：
   *
   * 1. 查账号、按需比对密码 / 校验验证码 → 得到 `CredentialFacts`；
   * 2. 把结论交给 `application/services/credential-failures.ts` 折成
   *    `DomainFailure`，并在**该计入限流时**记账。
   *
   * 之所以要这样拆：反枚举的本质是「把多种失败折叠成同一个可观察结果」，
   * 而折叠是**映射**。放在流程里时，没有任何测试能证明「账号不存在」与
   * 「密码错」走的是同一条路；变成纯函数后，折叠由返回类型保证，且可以脱离
   * Prisma mock 与 DI 容器单测（见 `credential-verdict.spec.ts`）。
   *
   * ## 两条不变量落在哪里
   *
   * - **#1 反枚举**：所有 `rejected` reason 在 `toCredentialFailure` 里合流成
   *   同一个 `AUTH_WRONG_PASSWORD`。验证码路径的 `MISMATCH`/`EXPIRED` 同样
   *   折进该桶并**计入限流**——它们曾经原样返回且跳过 `recordLoginFailure`，
   *   使 `POST /auth/login` 成为不限速的账号存在性预言机。
   * - **#2 依赖故障不折进反枚举桶**：依赖故障在 `CredentialFacts` 里是**独立的
   *   字段**、在 `CredentialDecision` 里是**独立的 kind**，因此不可能被折叠。
   */
  private verifyLoginCredentials(
    email: string,
    dto: LoginDto,
    user: User | null,
  ): ResultAsync<User, DomainFailure> {
    const presented: CredentialFacts['presented'] =
      dto.password !== undefined && dto.code !== undefined
        ? 'both'
        : dto.password !== undefined
          ? 'password'
          : dto.code !== undefined
            ? 'code'
            : 'neither';

    // 账号不存在：不再往下查，直接判定（判定结果仍是统一的凭据失败）。
    if (!user) {
      return this.settleRejection(
        email,
        decideCredential({
          accountFound: false,
          storedPassword: 'none',
          presented,
          passwordMatches: null,
          codeValid: null,
          dependencyFailure: null,
        }),
      );
    }

    // 请求形状不对（两者都给 / 都不给）：不消耗任何依赖，直接判定。
    if (presented === 'both' || presented === 'neither') {
      return this.settleRejection(
        email,
        decideCredential({
          accountFound: true,
          storedPassword: 'none',
          presented,
          passwordMatches: null,
          codeValid: null,
          dependencyFailure: null,
        }),
      );
    }
    return presented === 'password'
      ? this.verifyByPassword(email, user, dto.password as string)
      : this.verifyByCode(email, user, dto.code as string);
  }

  /** 密码路径：取「有无密码 + 比对结果」两个事实，交给纯函数判定。 */
  private verifyByPassword(
    email: string,
    user: User,
    password: string,
  ): ResultAsync<User, DomainFailure> {
    return this.authIdentityService
      .checkLocalPassword(user.id, password)
      .orElse((error) =>
        // 依赖故障原样上抛（#2）：绝不折成「密码错」。
        errAsync<LocalPasswordCheck, DomainFailure>(error),
      )
      .andThen((check) =>
        this.settle(
          email,
          decideCredential({
            accountFound: true,
            storedPassword: check.hasPassword ? 'set' : 'none',
            presented: 'password',
            passwordMatches: check.passwordMatches,
            codeValid: null,
            dependencyFailure: null,
          }),
        ),
      )
      .map(() => user);
  }

  /**
   * 验证码路径：把校验结果折成领域事实，交给纯函数判定。
   *
   * **这里不区分「码错」与「码过期」**：校验器会给出两种错误码，但折成领域
   * 事实时只留「有效 / 无效」。理由见 `CredentialRejectionReason` 的注释——
   * 一旦区分流进领域结论，就会有人把它记进日志或指标，从而以另一种渠道泄露
   * 「该邮箱近期请求过验证码」。用户侧不需要这个区分（两种情况的行动都是
   * 「重新获取」），客户端也看不到（都折进 `AUTH_WRONG_PASSWORD`）。
   */
  private verifyByCode(
    email: string,
    user: User,
    code: string,
  ): ResultAsync<User, DomainFailure> {
    return this.verificationCodeService
      .verify(email, code, 'login')
      .map((): boolean => true)
      .orElse((error): ResultAsync<boolean, DomainFailure> => {
        // 依赖故障（缓存/Redis 不可用）原样上抛（#2）：不能报成「验证码错」，
        // 否则用户会去重试一个本来没问题的码。
        if (error.kind === 'internal' || error.kind === 'dependency') {
          return errAsync(error);
        }
        // 码错与码过期合流（#1）。领域层不保留「为什么无效」。
        return okAsync(false);
      })
      .andThen((codeValid) =>
        this.settle(
          email,
          decideCredential({
            accountFound: true,
            storedPassword: 'none',
            presented: 'code',
            passwordMatches: null,
            codeValid,
            dependencyFailure: null,
          }),
        ),
      )
      .map(() => user);
  }

  /**
   * 落定一个**必定失败**的领域结论：按需记限流，然后折成统一的 `DomainFailure`。
   *
   * **是否计入限流由领域函数决定**（`shouldCountLoginFailure`），不在这里
   * 重写判据——限流分桶与反枚举桶必须同步，两处各写一遍迟早漂移。
   *
   * 返回 `never` 的成功分支：调用点用它做「必定拒绝」的短路（账号不存在、
   * 请求形状不对），因此不需要再 `.map()` 出一个用户。
   */
  private settleRejection(
    email: string,
    decision: CredentialDecision,
  ): ResultAsync<never, DomainFailure> {
    const failure = toCredentialFailure(decision);
    if (!shouldCountLoginFailure(decision)) {
      // 依赖故障不计入限流：一次缓存抖动不该把一批用户锁在门外。
      return errAsync(failure);
    }
    return this.authRateLimitService
      .recordLoginFailure(email)
      .andThen(() => errAsync(failure));
  }

  /**
   * 落定一个领域结论并放行成功路径。
   *
   * 与 {@link settleRejection} 分开是因为返回类型不同：成功时要继续带着
   * 用户往下走，拒绝时是 `never`。合成一个会逼调用点做无意义的 `null` 映射。
   */
  private settle(
    email: string,
    decision: CredentialDecision,
  ): ResultAsync<void, DomainFailure> {
    return decision.kind === 'accepted'
      ? okAsync(undefined)
      : this.settleRejection(email, decision);
  }

  /**
   * Lifts non-Prisma IO (Argon2 callbacks, token service,
   * user lookups) into `ResultAsync`. Unknown exceptions are mapped to
   * `DEPENDENCY_UNAVAILABLE` so they stay inside the Result channel instead
   * of becoming unhandled rejections.
   */
  private lift<T>(promise: Promise<T>): ResultAsync<T, DomainFailure> {
    return fromPromise(promise, (error) =>
      mapUnknownToDependencyFailure(error, 'Credential operation failed'),
    );
  }
}
