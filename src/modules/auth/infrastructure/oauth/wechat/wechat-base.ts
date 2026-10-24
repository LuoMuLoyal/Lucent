import {
  extractErrorInfo,
  toInputJsonValue,
} from '../../../../../common/index.js';
import {
  errAsync,
  fromPromise,
  isDomainFailure,
  okAsync,
  type DomainFailure,
  type ResultAsync,
} from '../../../../../common/result/index.js';
import type { Logger } from '@nestjs/common';
import {
  classifyFetchError,
  dependencyBadGateway,
} from '../dependency-failure.js';

export const WECHAT_ACCESS_TOKEN_URL =
  'https://api.weixin.qq.com/sns/oauth2/access_token';
export const WECHAT_USERINFO_URL = 'https://api.weixin.qq.com/sns/userinfo';

export interface WechatAccessTokenSuccess {
  access_token: string;
  expires_in: number;
  refresh_token: string;
  openid: string;
  scope: string;
  unionid?: string;
}

export interface WechatUserInfoSuccess {
  openid: string;
  nickname?: string;
  sex?: number;
  province?: string;
  city?: string;
  country?: string;
  headimgurl?: string;
  privilege?: string[];
  unionid?: string;
}

export interface WechatErrorResponse {
  errcode: number;
  errmsg: string;
}

/**
 * WeChat OAuth 提供商的共享基类。
 *
 * ## 这一层在做什么
 *
 * 只做「和微信通信」：发 HTTP、判非 2xx、解 JSON、识别微信的 `errcode`
 * 错误响应、把每个失败模式折成 `DEPENDENCY_*`。
 *
 * ## 它**不**产出领域对象
 *
 * `fetchWechat` 返回的是**微信自己的响应形状**（`WechatAccessTokenSuccess` /
 * `WechatUserInfoSuccess`）。把 `openid`/`unionid`/`headimgurl` 映射成
 * `OAuthProviderProfile` 的字段由各子类在 `fetchProfile` 里做——那是「归一化」，
 * 是本层与端口之间的边界。
 *
 * ## 依赖方向
 *
 * 只依赖 `common/` 与同层的 `dependency-failure.js`。**不 import `domain/`**
 * ——基础设施实现端口（`application/ports/oauth-provider.ts`），不直接依赖领域。
 */
export abstract class WechatBaseOAuthProvider {
  protected abstract readonly logger: Logger;
  abstract readonly provider: string;

  /**
   * 发一次微信 API 请求并解出 payload。
   *
   * 三种失败模式分别映射（与 S2 的依赖故障分类同一原则——**绝不折成凭据无效**）：
   * - 网络不可达 → `DEPENDENCY_UNAVAILABLE`
   * - 超时 → `DEPENDENCY_TIMEOUT`
   * - 非 2xx / JSON 解不开 / 微信 `errcode` → `DEPENDENCY_BAD_GATEWAY`
   *
   * 最后一种刻意**不**映射成 `VALIDATION_FAILED`：微信说「这个 code 不能用」
   * 是**上游拒绝**，不是客户端请求畸形。折成校验错会让客户端以为是自己发错了
   * 参数而重试同一个坏 code。
   */
  protected fetchWechat<T>(url: string): ResultAsync<T, DomainFailure> {
    return fromPromise(fetch(url), (error) => {
      const { message: reason, stack } = extractErrorInfo(error);
      this.logger.error(`WeChat OAuth request failed: ${reason}`, stack);
      return classifyFetchError(error);
    }).andThen((response) => {
      if (!response.ok) {
        // Upstream responded with a non-2xx status.
        return errAsync(dependencyBadGateway());
      }
      return fromPromise(response.json(), (error) => {
        if (isDomainFailure(error)) return error;
        const { message: reason, stack } = extractErrorInfo(error);
        this.logger.error(
          `Failed to decode WeChat OAuth JSON response: ${reason}`,
          stack,
        );
        return dependencyBadGateway(error);
      }).andThen((payload) => {
        if (this.isWechatError(payload)) {
          // Upstream rejected the credential (errcode response) — a token
          // exchange failure, not a client validation problem.
          return errAsync(dependencyBadGateway());
        }
        return okAsync(payload as T);
      });
    });
  }

  protected isWechatError(payload: unknown): payload is WechatErrorResponse {
    if (typeof payload !== 'object' || payload === null) {
      return false;
    }

    const candidate = payload as Partial<WechatErrorResponse>;
    return typeof candidate.errcode === 'number';
  }

  /**
   * 原始响应 → 可 JSON 序列化的普通对象。
   *
   * 这里做一次 `toInputJsonValue` 清洗（去掉 `undefined`、确保可序列化），
   * 但**结果不落库**——它随 `OAuthProviderProfile.rawProfile` 交给
   * `infrastructure/persistence`，由那里决定写不写、写什么形状。
   */
  protected toJsonValue(value: unknown): Record<string, unknown> {
    return toInputJsonValue(value) as Record<string, unknown>;
  }
}
