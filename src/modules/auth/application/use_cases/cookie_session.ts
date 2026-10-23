import { Injectable } from '@nestjs/common';

import type { User } from '#generated/prisma/client.js';
import { unwrapResult } from '../../../../common/result/index.js';

import type {
  DomainFailure,
  ResultAsync,
} from '../../../../common/result/index.js';
import { AuthRequestContext, TokenPair } from '../../types/auth-request.js';
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
 * 凭据流程的返回值：用户 + 一对 token，其中 token 仍是扁平字段。
 * 这是既有 `AuthService` 的形状，本用例把它收敛成 `{ user, tokens }`。
 */
type CredentialsResult = { user: User } & TokenPair;

/** 扁平 token 字段 → `TokenPair`，丢掉 `user`。 */
function splitCredentials(result: CredentialsResult): {
  user: User;
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
 * 也不碰 `Set-Cookie` —— 那些分别属于既有领域服务与 HTTP adapter。
 *
 * 所以这个类读起来应该是几个「一条直线」的方法，而不是第二套认证逻辑。
 *
 * ## 为什么把 token 对原样返回
 *
 * 只有投递层知道 cookie 该怎么投（属性由 `domain/session/cookie_policy.ts`
 * 决定）。用例层返回 `{ user, tokens }`，adapter 把 `tokens` 写进 cookie、
 * 把 `user` 投影成响应体 —— token 因此**没有任何一条路径**能进响应体。
 *
 * ## 待办：本模块的完整 DDD 化
 *
 * `AuthService` 仍是本模块的 legacy 服务（ADR-0024 把 `auth` 列为第二批迁移）。
 * 本用例直接依赖它，是本批次**已知的过渡状态**：等 `auth` 整体迁移时，
 * 这里换成 application port，凭据校验下沉到 `domain/`。
 * 现在强行包一层 port 只会把「尚未拆分的边界」伪装成已经拆好。
 */
@Injectable()
export class CookieSessionUseCase {
  constructor(private readonly authService: AuthService) {}

  /**
   * 登录并返回会话所需的用户与 token。
   *
   * 凭据失败（密码错 / 账号不存在 / 验证码错）由 `AuthService` 统一映射为
   * `AUTH_WRONG_PASSWORD`，对外不可区分——反枚举是服务端的不变量，
   * 这里不再二次包装。
   */
  login(
    command: LoginCommand,
    context?: AuthRequestContext,
  ): ResultAsync<{ user: User; tokens: TokenPair }, DomainFailure> {
    return this.authService.login(command, context).map(splitCredentials);
  }

  /** 注册并直接建立会话（服务端注册即登录，客户端不必再调一次登录）。 */
  register(
    command: RegisterCommand,
    context?: AuthRequestContext,
  ): ResultAsync<{ user: User; tokens: TokenPair }, DomainFailure> {
    return this.authService.register(command, context).map(splitCredentials);
  }

  /**
   * 轮换会话。
   *
   * 返回**新的一对** token 与它所属的用户：`AuthTokenService` 在轮换时
   * 已经持有会话记录，所以这里不需要再解一次 JWT 或再查一次库。
   */
  rotate(
    refreshToken: string,
    context?: AuthRequestContext,
  ): ResultAsync<{ user: User; tokens: TokenPair }, DomainFailure> {
    return this.authService.refreshWithUser(refreshToken, context);
  }

  /** 吊销指定 refresh token 对应的会话。 */
  async revoke(userId: string, refreshToken: string): Promise<void> {
    await unwrapResult(this.authService.logout(userId, refreshToken));
  }

  /** 读取当前登录用户。会话已失效时失败码与 Bearer 那条路一致。 */
  currentUser(userId: string): ResultAsync<User, DomainFailure> {
    return this.authService.getActiveUser(userId);
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
