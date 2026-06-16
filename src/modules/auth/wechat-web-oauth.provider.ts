import {
  Injectable,
  Logger,
  OnModuleInit,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { I18nService } from 'nestjs-i18n';
import type { Prisma } from '../../generated/prisma/client';
import { ResultCode } from '../../common/api-envelope';
import { ConfigKey } from '../../config/config-keys.enum';
import type {
  OAuthConfig,
  OAuthProviderConfig,
} from '../../config/oauth.config';
import { OAUTH_PROVIDER_WECHAT_WEB, type OAuthProfile } from './oauth.types';

const WECHAT_AUTHORIZE_URL = 'https://open.weixin.qq.com/connect/qrconnect';
const WECHAT_ACCESS_TOKEN_URL =
  'https://api.weixin.qq.com/sns/oauth2/access_token';
const WECHAT_USERINFO_URL = 'https://api.weixin.qq.com/sns/userinfo';
const WECHAT_SCOPE = 'snsapi_login';

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
export class WechatWebOAuthProvider implements OnModuleInit {
  private readonly logger = new Logger(WechatWebOAuthProvider.name);
  constructor(
    private readonly configService: ConfigService,
    private readonly i18n: I18nService,
  ) {}

  buildAuthorizeUrl(state: string): string {
    const config = this.getConfig();

    if (!config.redirectUri) {
      throw new ServiceUnavailableException({
        code: ResultCode.EXTERNAL_SERVICE_ERROR,
        message: this.i18n.t('auth.oauth_provider_not_configured'),
      });
    }

    const params = new URLSearchParams({
      appid: config.appId,
      redirect_uri: config.redirectUri,
      response_type: 'code',
      scope: WECHAT_SCOPE,
      state,
    });

    return `${WECHAT_AUTHORIZE_URL}?${params.toString()}#wechat_redirect`;
  }

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
      provider: OAUTH_PROVIDER_WECHAT_WEB,
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

  onModuleInit(): void {
    const wechat = this.readRawConfig();
    if (!wechat.appId || !wechat.appSecret) {
      this.logger.warn(
        'WeChat Web OAuth is not fully configured — web/desktop WeChat login will be unavailable.',
      );
    }
  }

  private getConfig(): OAuthProviderConfig {
    const wechat = this.readRawConfig();

    if (!wechat.appId || !wechat.appSecret) {
      throw new ServiceUnavailableException({
        code: ResultCode.EXTERNAL_SERVICE_ERROR,
        message: this.i18n.t('auth.oauth_provider_not_configured'),
      });
    }

    return wechat;
  }

  private readRawConfig(): OAuthProviderConfig {
    const config = this.configService.getOrThrow<OAuthConfig>(ConfigKey.OAuth);
    return config.wechatWeb;
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
