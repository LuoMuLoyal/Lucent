import {
  createDomainFailure,
  errAsync,
  type DomainFailure,
  type ResultAsync,
} from '../../../../../common/result/index.js';
import {
  Injectable,
  Logger,
  OnModuleInit,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ConfigKey } from '../../../../../config/env/config-keys.enum.js';
import type {
  OAuthConfig,
  OAuthProviderConfig,
} from '../../../../../config/services/oauth.config.js';
import {
  WechatBaseOAuthProvider,
  WECHAT_ACCESS_TOKEN_URL,
  WECHAT_USERINFO_URL,
  type WechatAccessTokenSuccess,
  type WechatUserInfoSuccess,
} from './wechat-base.js';
import { OAUTH_PROVIDER_WECHAT_WEB } from '../../../types/oauth.types.js';
import type { OAuthProviderProfile } from '../../../application/ports/oauth-provider.js';
import { dependencyBadGateway } from '../dependency-failure.js';

const WECHAT_AUTHORIZE_URL = 'https://open.weixin.qq.com/connect/qrconnect';
const WECHAT_SCOPE = 'snsapi_login';

/**
 * 微信网页扫码登录。
 *
 * ## 归一化：微信的字段名 → 端口字段名
 *
 * | 微信 | `OAuthProviderProfile` |
 * | --- | --- |
 * | `openid` | `providerUserId` |
 * | `unionid` | `unionId` |
 * | `nickname` | `nickname` |
 * | `headimgurl` | `avatar` |
 * | （无邮箱） | `email: null` |
 *
 * `email` 恒为 `null`：微信不披露邮箱。所以这个提供商**永远不参与按邮箱自动
 * 关联**——即便它哪天出现在受信名单里，`canAutoLinkByEmail` 也会因为没有邮箱
 * 而返回 `false`（`domain/account/oauth-identity.ts`）。
 */
@Injectable()
export class WechatWebOAuthProvider
  extends WechatBaseOAuthProvider
  implements OnModuleInit
{
  readonly provider = OAUTH_PROVIDER_WECHAT_WEB;
  protected readonly logger = new Logger(WechatWebOAuthProvider.name);

  constructor(private readonly configService: ConfigService) {
    super();
  }

  buildAuthorizeUrl(state: string, _callbackUri?: string): string {
    const config = this.getConfig();

    if (!config.redirectUri) {
      throw new ServiceUnavailableException({
        code: 'DEPENDENCY_UNAVAILABLE',
        message: 'WeChat Web OAuth is not configured.',
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

  fetchProfile(
    credential: Record<string, unknown>,
  ): ResultAsync<OAuthProviderProfile, DomainFailure> {
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
      ).map((userInfo): OAuthProviderProfile => {
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
      });
    });
  }

  onModuleInit(): void {
    const wechat = this.readRawConfig();
    if (!wechat.appId || !wechat.appSecret) {
      this.logger.warn(
        'WeChat Web OAuth is not fully configured — web/desktop WeChat login will be unavailable.',
      );
    }
  }

  /**
   * 读配置，缺 appId/appSecret 即抛 `ServiceUnavailableException`。
   *
   * **配置错误是抛而不是返回 DomainFailure**：端口契约里写明「配置错误与编程
   * 错误抛出，不折进 Result」。配置缺失是部署问题，不该表现成一个业务失败。
   *
   * `redirectUri` **不在这里校验**：它只被 `buildAuthorizeUrl` 需要，而
   * `fetchProfile`（回调路径）不需要。原实现在 `fetchProfile` 里也只校验
   * appId/appSecret——这里保持同样的严格度，避免把「未配置回调地址」升级成
   * 「连 code 换 token 都不可用」。
   */
  private getConfig(): OAuthProviderConfig {
    const wechat = this.readRawConfig();

    if (!wechat.appId || !wechat.appSecret) {
      throw new ServiceUnavailableException({
        code: 'DEPENDENCY_UNAVAILABLE',
        message: 'WeChat Web OAuth is not configured.',
      });
    }

    return wechat;
  }

  private readRawConfig(): OAuthProviderConfig {
    const config = this.configService.getOrThrow<OAuthConfig>(ConfigKey.OAuth);
    return config.wechatWeb;
  }

  private validationFailure(): DomainFailure {
    return createDomainFailure({
      kind: 'validation',
      code: 'VALIDATION_FAILED',
    });
  }
}
