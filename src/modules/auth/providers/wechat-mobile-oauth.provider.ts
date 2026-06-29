import { unauthorized } from '../../../common/utils/api-errors';
import {
  Injectable,
  Logger,
  OnModuleInit,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { I18nService } from 'nestjs-i18n';
import { ResultCode } from '../../../common/api-envelope';
import { ConfigKey } from '../../../config/config-keys.enum';
import type { OAuthConfig } from '../../../config/oauth.config';
import {
  WechatBaseOAuthProvider,
  WECHAT_ACCESS_TOKEN_URL,
  WECHAT_USERINFO_URL,
  type WechatAccessTokenSuccess,
  type WechatUserInfoSuccess,
} from './wechat-base-oauth.provider';
import {
  OAUTH_PROVIDER_WECHAT_MOBILE,
  type OAuthProfile,
} from '../types/oauth.types';
import type { OAuthProvider } from './oauth-provider.interface';

@Injectable()
export class WechatMobileOAuthProvider
  extends WechatBaseOAuthProvider
  implements OAuthProvider, OnModuleInit
{
  readonly provider = OAUTH_PROVIDER_WECHAT_MOBILE;
  protected readonly logger = new Logger(WechatMobileOAuthProvider.name);

  constructor(
    private readonly configService: ConfigService,
    protected readonly i18n: I18nService,
  ) {
    super();
  }

  async fetchProfile(
    credential: Record<string, unknown>,
  ): Promise<OAuthProfile> {
    const code = credential['code'] as string;
    if (!code) {
      unauthorized(this.i18n.t('auth.oauth_code_required'));
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

  onModuleInit(): void {
    const wechat = this.readRawConfig();
    if (!wechat.appId || !wechat.appSecret) {
      this.logger.warn(
        'WeChat Mobile OAuth is not fully configured — mobile WeChat login will be unavailable.',
      );
    }
  }

  private getConfig(): { appId: string; appSecret: string } {
    const wechat = this.readRawConfig();

    if (!wechat.appId || !wechat.appSecret) {
      throw new ServiceUnavailableException({
        code: ResultCode.EXTERNAL_SERVICE_ERROR,
        message: this.i18n.t('auth.oauth_provider_not_configured'),
      });
    }

    return wechat;
  }

  private readRawConfig(): { appId: string; appSecret: string } {
    const config = this.configService.getOrThrow<OAuthConfig>(ConfigKey.OAuth);
    return config.wechatMobile;
  }
}
