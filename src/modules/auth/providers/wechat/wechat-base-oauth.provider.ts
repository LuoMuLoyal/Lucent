import { extractErrorInfo, toInputJsonValue } from '../../../../common';
import {
  errAsync,
  fromPromise,
  isDomainFailure,
  okAsync,
  type DomainFailure,
  type ResultAsync,
} from '../../../../common/result';
import type { Logger } from '@nestjs/common';
import type { Prisma } from '#generated/prisma/client';
import {
  classifyFetchError,
  dependencyBadGateway,
} from '../dependency-failure.utils';

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
 * Shared base for WeChat OAuth providers.
 *
 * Subclasses must implement {@link OAuthProvider} and provide:
 * - `getConfig()` returning the provider-specific config
 * - `buildAuthorizeUrl?()` (web only)
 * - `fetchProfile()` mapping credentials to an {@link OAuthProfile}
 */
export abstract class WechatBaseOAuthProvider {
  protected abstract readonly logger: Logger;
  abstract readonly provider: string;

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

  protected toJsonValue(value: unknown): Prisma.InputJsonValue {
    return toInputJsonValue(value);
  }
}
