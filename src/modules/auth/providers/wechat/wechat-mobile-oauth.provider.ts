import {
  createDomainFailure,
  errAsync,
  type DomainFailure,
  type ResultAsync,
} from '../../../../common/result/index.js';
import {
  Injectable,
  Logger,
  OnModuleInit,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ConfigKey } from '../../../../config/env/config-keys.enum.js';
import type { OAuthConfig } from '../../../../config/services/oauth.config.js';
import {
  WechatBaseOAuthProvider,
  WECHAT_ACCESS_TOKEN_URL,
  WECHAT_USERINFO_URL,
  type WechatAccessTokenSuccess,
  type WechatUserInfoSuccess,
} from './wechat-base-oauth.provider.js';
import {
  OAUTH_PROVIDER_WECHAT_MOBILE,
  type OAuthProfile,
} from '../../types/oauth.types.js';
import type { OAuthProvider } from '../oauth-provider.interface.js';
import { dependencyBadGateway } from '../dependency-failure.utils.js';

@Injectable()
export class WechatMobileOAuthProvider
  extends WechatBaseOAuthProvider
  implements OAuthProvider, OnModuleInit
{
  readonly provider = OAUTH_PROVIDER_WECHAT_MOBILE;
  protected readonly logger = new Logger(WechatMobileOAuthProvider.name);

  constructor(private readonly configService: ConfigService) {
    super();
  }

  fetchProfile(
    credential: Record<string, unknown>,
  ): ResultAsync<OAuthProfile, DomainFailure> {
    const code = credential['code'] as string;
    if (!code) {
      return errAsync(this.validationFailure());
    }
    const config = this.getConfig();
    const tokenParams = new URLSearchParams({
      appid: config.appId,
      secret: config.appSecret,
      code,
      grant_type: 'authorization_code',
    });

    return this.fetchWechat<WechatAccessTokenSuccess>(
      `${WECHAT_ACCESS_TOKEN_URL}?${tokenParams.toString()}`,
    ).andThen((token) => {
      if (!token.openid) {
        // Profile is unusable without a stable provider user id.
        return errAsync(dependencyBadGateway());
      }

      const userInfoParams = new URLSearchParams({
        access_token: token.access_token,
        openid: token.openid,
        lang: 'zh_CN',
      });

      return this.fetchWechat<WechatUserInfoSuccess>(
        `${WECHAT_USERINFO_URL}?${userInfoParams.toString()}`,
      ).map((userInfo): OAuthProfile => {
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
      });
    });
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
        code: 'DEPENDENCY_UNAVAILABLE',
        message: 'WeChat Mobile OAuth is not configured.',
      });
    }

    return wechat;
  }

  private readRawConfig(): { appId: string; appSecret: string } {
    const config = this.configService.getOrThrow<OAuthConfig>(ConfigKey.OAuth);
    return config.wechatMobile;
  }

  private validationFailure(): DomainFailure {
    return createDomainFailure({
      kind: 'validation',
      code: 'VALIDATION_FAILED',
    });
  }
}
