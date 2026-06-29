import { unauthorized } from '../../../common/utils/api-errors';
import type { Logger } from '@nestjs/common';
import { ServiceUnavailableException } from '@nestjs/common';
import type { I18nService } from 'nestjs-i18n';
import type { Prisma } from '../../../generated/prisma/client';
import { ResultCode } from '../../../common/api-envelope';
import type { OAuthProvider } from './oauth-provider.interface';

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
  protected abstract readonly i18n: I18nService;
  abstract readonly provider: OAuthProvider['provider'];

  protected async fetchWechat<T>(url: string): Promise<T> {
    let response: Response;
    try {
      response = await fetch(url);
    } catch {
      throw new ServiceUnavailableException({
        code: ResultCode.EXTERNAL_SERVICE_ERROR,
        message: this.i18n.t('auth.oauth_provider_unavailable'),
      });
    }

    if (!response.ok) {
      throw new ServiceUnavailableException({
        code: ResultCode.EXTERNAL_SERVICE_ERROR,
        message: this.i18n.t('auth.oauth_provider_unavailable'),
      });
    }

    const payload = (await response.json()) as T | WechatErrorResponse;
    if (this.isWechatError(payload)) {
      unauthorized(this.i18n.t('auth.oauth_code_invalid'));
    }

    return payload;
  }

  protected isWechatError(payload: unknown): payload is WechatErrorResponse {
    if (typeof payload !== 'object' || payload === null) {
      return false;
    }

    const candidate = payload as Partial<WechatErrorResponse>;
    return typeof candidate.errcode === 'number';
  }

  protected toJsonValue(value: unknown): Prisma.InputJsonValue {
    return value as Prisma.InputJsonValue;
  }
}
