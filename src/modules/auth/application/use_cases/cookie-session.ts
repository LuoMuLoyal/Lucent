import { Injectable } from '@nestjs/common';

import { unwrapResult } from '../../../../common/result/index.js';

import type {
  DomainFailure,
  ResultAsync,
} from '../../../../common/result/index.js';
import type { RequestOrigin } from '../ports/request-origin.js';
import { SessionTokens, type TokenPair } from '../services/session-tokens.js';
import { AuthService } from '../../services/auth.service.js';

/**
 * 登录命令 —— **应用层自己的输入契约**。
 *
 * 不复用 HTTP 层的 zod 输出类型：`application/` 不得依赖 `adapters/`
 * （ADR-0024 D2，由 `pnpm arch:check` 强制）。投递层负责把校验过的请求体
 * 映射成这里的形状；字段一致是**当前需求的巧合**，不是耦合的借口。
 */
export interface LoginCommand {
  email: string;
  /** 密码与验证码二选一；都缺时按统一凭据失败处理（反枚举）。 */
  password?: string | undefined;
  code?: string | undefined;
  captchaToken?: string | undefined;
}

/** 注册命令。`code` 必填：服务端注册流程要求邮箱验证码。 */
export interface RegisterCommand {
  email: string;
  password: string;
  code: string;
  captchaToken?: string | undefined;
  nickname?: string | undefined;
}

/**
 * 会话响应用到的用户字段子集（HTTP 投影只需要这些）。
 *
 * 比 `User` 实体窄：投递层不该能读到 `deletedAt`、`status` 这类不进响应体的
 * 列，也就不必为它们在本层建依赖。
 */
export interface SessionUser {
  id: string;
  email: string | null;
  nickname: string | null;
  avatar: string | null;
  emailVerifiedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

/** 凭据流程的返回值：用户 + 一对 token，其中 token 仍是扁平字段。 */
type CredentialsResult = { user: SessionUser } & TokenPair;

/** 扁平 token 字段 → `TokenPair`，丢掉 `user`。 */
function splitCredentials(result: CredentialsResult): {
  user: SessionUser;
  tokens: TokenPair;
} {
  return {
    user: result.user,
    tokens: {
      accessToken: result.accessToken,
      refreshToken: result.refreshToken,
      accessTokenExpiresAt: result.accessTokenExpiresAt,
      refreshTokenExpiresAt: result.refreshTokenExpiresAt,
    },
  };
}

/**
 * cookie 会话的应用用例。
 *
 * ## 这一层在做什么，不做什么
 *
 * 它只做**编排**：调用凭据校验（`AuthService`）→ 拿到用户与 token 对 →
 * 交给投递层去下发 cookie。它不校验密码、不判断验证码、不构造 HTTP 响应，
 * 也不碰 `Set-Cookie` —— 那些分别属于领域服务与 HTTP adapter。
 *
 * 所以这个类读起来应该是几个「一条直线」的方法，而不是第二套认证逻辑。
 *
 * ## 为什么把 token 对原样返回
 *
 * 只有投递层知道 cookie 该怎么投（属性由 `domain/session/cookie-policy.ts`
 * 决定）。用例层返回 `{ user, tokens }`，adapter 把 `tokens` 写进 cookie、
 * 把 `user` 投影成响应体 —— token 因此**没有任何一条路径**能进响应体。
 *
 * ## 轮换为什么直接走 `SessionTokens`
 *
 * 轮换除了签新 token 还要判断「这条 refresh token 还能不能用」，判定在
 * `domain/session/session.ts`，编排在 `application/services/session-tokens.ts`。
 * 本用例不需要再包一层——它只把结果交给投递层。
 */
@Injectable()
export class CookieSessionUseCase {
  constructor(
    private readonly authService: AuthService,
    private readonly sessionTokens: SessionTokens,
  ) {}

  /**
   * 登录并返回会话所需的用户与 token。
   *
   * 凭据失败（密码错 / 账号不存在 / 验证码错）由 `AuthService` 统一映射为
   * `AUTH_WRONG_PASSWORD`，对外不可区分——反枚举是服务端的不变量，
   * 这里不再二次包装。
   */
  login(
    command: LoginCommand,
    context?: RequestOrigin,
  ): ResultAsync<{ user: SessionUser; tokens: TokenPair }, DomainFailure> {
    return this.authService.login(command, context).map(splitCredentials);
  }

  /** 注册并直接建立会话（服务端注册即登录，客户端不必再调一次登录）。 */
  register(
    command: RegisterCommand,
    context?: RequestOrigin,
  ): ResultAsync<{ user: SessionUser; tokens: TokenPair }, DomainFailure> {
    return this.authService.register(command, context).map(splitCredentials);
  }

  /**
   * 轮换会话。
   *
   * 会话行里已经有归属人，所以不需要再解一次 JWT 或再查一次库。
   * 投递层拿到 `userId` 后自己决定要不要补一次用户查询来拼响应体。
   */
  rotate(
    refreshToken: string,
    context?: RequestOrigin,
  ): ResultAsync<{ userId: string; tokens: TokenPair }, DomainFailure> {
    return this.sessionTokens.rotate(refreshToken, context);
  }

  /** 吊销指定 refresh token 对应的会话。 */
  async revoke(userId: string, refreshToken: string): Promise<void> {
    await unwrapResult(this.sessionTokens.revoke(userId, refreshToken));
  }

  /**
   * 「会话失效」的统一失败，供投递层在**没有 refresh cookie**时直接拒绝。
   *
   * 复用 `AUTH_REFRESH_TOKEN_INVALID`（而不是另造一个码），让 Bearer 与 cookie
   * 两条路共用一套错误词汇：客户端只需按一个值分支。
   */
  refreshFailure(): DomainFailure {
    return this.authService.refreshTokenInvalidException().failure;
  }
}
