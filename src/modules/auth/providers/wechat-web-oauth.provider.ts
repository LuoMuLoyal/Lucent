import {
  Injectable,
  Logger,
  OnModuleInit,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { I18nService } from 'nestjs-i18n';
import { ResultCode } from '../../../common/api';
import { ConfigKey } from '../../../config/config-keys.enum';
import type {
  OAuthConfig,
  OAuthProviderConfig,
} from '../../../config/oauth.config';
import {
  WechatBaseOAuthProvider,
  WECHAT_ACCESS_TOKEN_URL,
  WECHAT_USERINFO_URL,
  type WechatAccessTokenSuccess,
  type WechatUserInfoSuccess,
} from './wechat-base-oauth.provider';
import {
  OAUTH_PROVIDER_WECHAT_WEB,
  type OAuthProfile,
} from '../types/oauth.types';
import type { OAuthProvider } from './oauth-provider.interface';

const WECHAT_AUTHORIZE_URL = 'https://open.weixin.qq.com/connect/qrconnect';
const WECHAT_SCOPE = 'snsapi_login';

@Injectable()
export class WechatWebOAuthProvider
  extends WechatBaseOAuthProvider
  implements OAuthProvider, OnModuleInit
{
  readonly provider = OAUTH_PROVIDER_WECHAT_WEB;
  protected readonly logger = new Logger(WechatWebOAuthProvider.name);

  constructor(
    private readonly configService: ConfigService,
    protected readonly i18n: I18nService,
  ) {
    super();
  }

  buildAuthorizeUrl(state: string, _callbackUri?: string): string {
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

  async fetchProfile(
    credential: Record<string, unknown>,
  ): Promise<OAuthProfile> {
    const code = credential['code'] as string;
    if (!code) {
      // will throw via unauthorized in fetchWechat on invalid code; let WeChat API reject it
    }

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
}
