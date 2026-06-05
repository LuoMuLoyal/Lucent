import {
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { I18nService } from 'nestjs-i18n';
import type { Prisma } from '../../generated/prisma/client';
import { ResultCode } from '../../common/api-envelope';
import { ConfigKey } from '../../config/config-keys.enum';
import type { OAuthConfig } from '../../config/oauth.config';
import { OAUTH_PROVIDER_WECHAT_MOBILE, type OAuthProfile } from './oauth.types';

const WECHAT_ACCESS_TOKEN_URL =
  'https://api.weixin.qq.com/sns/oauth2/access_token';
const WECHAT_USERINFO_URL = 'https://api.weixin.qq.com/sns/userinfo';

interface WechatAccessTokenSuccess {
  access_token: string;
  expires_in: number;
  refresh_token: string;
  openid: string;
  scope: string;
  unionid?: string;
}

interface WechatUserInfoSuccess {
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

interface WechatErrorResponse {
  errcode: number;
  errmsg: string;
}

@Injectable()
export class WechatMobileOAuthProvider {
  constructor(
    private readonly configService: ConfigService,
    private readonly i18n: I18nService,
  ) {}

  async fetchProfile(code: string): Promise<OAuthProfile> {
    const config = this.getConfig();
    const tokenParams = new URLSearchParams({
      appid: config.appId,
      secret: config.appSecret,
      code,
      grant_type: 'authorization_code',
    });

    const token = await this.fetchWechat<WechatAccessTokenSuccess>(
      `${WECHAT_ACCESS_TOKEN_URL}?${tokenParams.toString()}`,
    );

    const userInfoParams = new URLSearchParams({
      access_token: token.access_token,
      openid: token.openid,
      lang: 'zh_CN',
    });

    const userInfo = await this.fetchWechat<WechatUserInfoSuccess>(
      `${WECHAT_USERINFO_URL}?${userInfoParams.toString()}`,
    );
    const rawToken = {
      openid: token.openid,
      scope: token.scope,
      expires_in: token.expires_in,
      ...(token.unionid !== undefined && { unionid: token.unionid }),
    };

    return {
      provider: OAUTH_PROVIDER_WECHAT_MOBILE,
      providerUserId: token.openid,
      ...(token.unionid !== undefined && { unionId: token.unionid }),
      email: null,
      nickname: userInfo.nickname ?? null,
      avatar: userInfo.headimgurl ?? null,
      rawProfile: {
        token: this.toJsonValue(rawToken),
        userInfo: this.toJsonValue(userInfo),
      },
    };
  }

  private getConfig(): { appId: string; appSecret: string } {
    const config = this.configService.getOrThrow<OAuthConfig>(ConfigKey.OAuth);
    const wechat = config.wechatMobile;

    if (!wechat.appId || !wechat.appSecret) {
      throw new ServiceUnavailableException({
        code: ResultCode.EXTERNAL_SERVICE_ERROR,
        message: this.i18n.t('auth.oauth_provider_not_configured'),
      });
    }

    return wechat;
  }

  private async fetchWechat<T>(url: string): Promise<T> {
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
      throw new UnauthorizedException({
        code: ResultCode.UNAUTHORIZED,
        message: this.i18n.t('auth.oauth_code_invalid'),
      });
    }

    return payload;
  }

  private isWechatError(payload: unknown): payload is WechatErrorResponse {
    if (typeof payload !== 'object' || payload === null) {
      return false;
    }

    const candidate = payload as Partial<WechatErrorResponse>;
    return typeof candidate.errcode === 'number';
  }

  private toJsonValue(value: unknown): Prisma.InputJsonValue {
    return value as Prisma.InputJsonValue;
  }
}
