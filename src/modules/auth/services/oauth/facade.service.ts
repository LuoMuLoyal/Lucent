import { Injectable, Logger } from '@nestjs/common';

import { User } from '#generated/prisma/client';
import { UserService } from '../../../user';
import {
  AppleOAuthCallbackDto,
  GoogleOAuthAuthorizeDto,
  GoogleOAuthCallbackDto,
  OAuthAuthorizeDto,
  OAuthCallbackDto,
  OAuthCodeCallbackDto,
  QqOAuthAuthorizeDto,
  QqOAuthCallbackDto,
  WeiboOAuthAuthorizeDto,
  WeiboOAuthCallbackDto,
} from '../../dto/shared/oauth.dto';
import { AppleOAuthProvider } from '../../providers/apple-oauth.provider';
import { GoogleOAuthProvider } from '../../providers/google-oauth.provider';
import { QqOAuthProvider } from '../../providers/qq-oauth.provider';
import { WeiboOAuthProvider } from '../../providers/weibo-oauth.provider';
import { WechatMobileOAuthProvider } from '../../providers/wechat/wechat-mobile-oauth.provider';
import { WechatWebOAuthProvider } from '../../providers/wechat/wechat-web-oauth.provider';
import {
  OAUTH_PROVIDER_GOOGLE,
  OAUTH_PROVIDER_QQ,
  OAUTH_PROVIDER_WECHAT_WEB,
  OAUTH_PROVIDER_WEIBO,
  type OAuthAuthorizeResult,
  type OAuthProfile,
} from '../../types/oauth.types';
import { AuthNotificationService } from '../notification.service';
import { unwrapResult } from '../../../../common/result';
import { AuthOAuthService } from './oauth.service';
import { AuthOAuthStateService, type OAuthStateEntry } from './state.service';
import { AuthTokenService, type TokenPair } from '../token.service';
import type { AuthRequestContext } from '../../types/auth-request';

@Injectable()
export class AuthOAuthFacadeService {
  private readonly logger = new Logger(AuthOAuthFacadeService.name);

  constructor(
    private readonly userService: UserService,
    private readonly wechatWebOAuthProvider: WechatWebOAuthProvider,
    private readonly wechatMobileOAuthProvider: WechatMobileOAuthProvider,
    private readonly appleOAuthProvider: AppleOAuthProvider,
    private readonly qqOAuthProvider: QqOAuthProvider,
    private readonly weiboOAuthProvider: WeiboOAuthProvider,
    private readonly googleOAuthProvider: GoogleOAuthProvider,
    private readonly authOAuthStateService: AuthOAuthStateService,
    private readonly authTokenService: AuthTokenService,
    private readonly authOAuthService: AuthOAuthService,
    private readonly authNotificationService: AuthNotificationService,
  ) {}

  async createWechatWebAuthorizeUrl(
    dto?: OAuthAuthorizeDto,
  ): Promise<OAuthAuthorizeResult> {
    return this.createWechatWebAuthorizeUrlForPurpose('login', dto);
  }

  async createWechatWebIdentityLinkAuthorizeUrl(
    dto?: OAuthAuthorizeDto,
  ): Promise<OAuthAuthorizeResult> {
    return this.createWechatWebAuthorizeUrlForPurpose('link', dto);
  }

  private async createWechatWebAuthorizeUrlForPurpose(
    purpose: OAuthStateEntry['purpose'],
    dto?: OAuthAuthorizeDto,
  ): Promise<OAuthAuthorizeResult> {
    const { state, ttlSec } = await this.authOAuthStateService.createState(
      OAUTH_PROVIDER_WECHAT_WEB,
      purpose,
      dto?.callbackUri,
    );
    const entry = await this.authOAuthStateService.peek(
      OAUTH_PROVIDER_WECHAT_WEB,
      state,
    );

    return {
      authorizeUrl: this.wechatWebOAuthProvider.buildAuthorizeUrl(state),
      state,
      expiresIn: ttlSec,
      ...(entry.callbackUri !== undefined && {
        callbackUri: entry.callbackUri,
      }),
    };
  }

  async resolveWechatWebCallbackRedirect(
    dto: OAuthCallbackDto,
  ): Promise<string> {
    const entry = await this.authOAuthStateService.peek(
      OAUTH_PROVIDER_WECHAT_WEB,
      dto.state,
    );
    return this.authOAuthStateService.buildRedirectUrl(
      entry,
      dto.code,
      dto.state,
    );
  }

  async loginWithWechatWeb(
    dto: OAuthCallbackDto,
    context?: AuthRequestContext,
  ): Promise<{ user: User } & TokenPair> {
    await this.authOAuthStateService.consume(
      OAUTH_PROVIDER_WECHAT_WEB,
      dto.state,
      'login',
    );
    const profile = await this.wechatWebOAuthProvider.fetchProfile({
      code: dto.code,
    });
    return this.loginWithOAuthProfile(profile, context);
  }

  async loginWithWechatMobile(
    dto: OAuthCodeCallbackDto,
    context?: AuthRequestContext,
  ): Promise<{ user: User } & TokenPair> {
    const profile = await this.wechatMobileOAuthProvider.fetchProfile({
      code: dto.code,
    });
    return this.loginWithOAuthProfile(profile, context);
  }

  async loginWithApple(
    dto: AppleOAuthCallbackDto,
    context?: AuthRequestContext,
  ): Promise<{ user: User } & TokenPair> {
    const profile = await this.appleOAuthProvider.fetchProfile({
      identityToken: dto.identityToken,
      authorizationCode: dto.authorizationCode,
      givenName: dto.givenName,
      familyName: dto.familyName,
    });
    return this.loginWithOAuthProfile(profile, context);
  }

  async createQqAuthorizeUrl(
    dto?: QqOAuthAuthorizeDto,
  ): Promise<OAuthAuthorizeResult> {
    const { state, ttlSec } = await this.authOAuthStateService.createState(
      OAUTH_PROVIDER_QQ,
      'login',
      dto?.callbackUri,
    );
    const entry = await this.authOAuthStateService.peek(
      OAUTH_PROVIDER_QQ,
      state,
    );

    return {
      authorizeUrl: this.qqOAuthProvider.buildAuthorizeUrl(
        state,
        dto?.callbackUri,
      ),
      state,
      expiresIn: ttlSec,
      ...(entry.callbackUri !== undefined && {
        callbackUri: entry.callbackUri,
      }),
    };
  }

  async loginWithQq(
    dto: QqOAuthCallbackDto,
    context?: AuthRequestContext,
  ): Promise<{ user: User } & TokenPair> {
    await this.authOAuthStateService.consume(
      OAUTH_PROVIDER_QQ,
      dto.state,
      'login',
    );
    const profile = await this.qqOAuthProvider.fetchProfile({ code: dto.code });
    return this.loginWithOAuthProfile(profile, context);
  }

  async createWeiboAuthorizeUrl(
    dto?: WeiboOAuthAuthorizeDto,
  ): Promise<OAuthAuthorizeResult> {
    const { state, ttlSec } = await this.authOAuthStateService.createState(
      OAUTH_PROVIDER_WEIBO,
      'login',
      dto?.callbackUri,
    );
    const entry = await this.authOAuthStateService.peek(
      OAUTH_PROVIDER_WEIBO,
      state,
    );

    return {
      authorizeUrl: this.weiboOAuthProvider.buildAuthorizeUrl(
        state,
        dto?.callbackUri,
      ),
      state,
      expiresIn: ttlSec,
      ...(entry.callbackUri !== undefined && {
        callbackUri: entry.callbackUri,
      }),
    };
  }

  async loginWithWeibo(
    dto: WeiboOAuthCallbackDto,
    context?: AuthRequestContext,
  ): Promise<{ user: User } & TokenPair> {
    await this.authOAuthStateService.consume(
      OAUTH_PROVIDER_WEIBO,
      dto.state,
      'login',
    );
    const profile = await this.weiboOAuthProvider.fetchProfile({
      code: dto.code,
    });
    return this.loginWithOAuthProfile(profile, context);
  }

  async createGoogleAuthorizeUrl(
    dto?: GoogleOAuthAuthorizeDto,
  ): Promise<OAuthAuthorizeResult> {
    const { state, ttlSec } = await this.authOAuthStateService.createState(
      OAUTH_PROVIDER_GOOGLE,
      'login',
      dto?.callbackUri,
    );
    const entry = await this.authOAuthStateService.peek(
      OAUTH_PROVIDER_GOOGLE,
      state,
    );

    return {
      authorizeUrl: this.googleOAuthProvider.buildAuthorizeUrl(
        state,
        dto?.callbackUri,
      ),
      state,
      expiresIn: ttlSec,
      ...(entry.callbackUri !== undefined && {
        callbackUri: entry.callbackUri,
      }),
    };
  }

  async loginWithGoogle(
    dto: GoogleOAuthCallbackDto,
    context?: AuthRequestContext,
  ): Promise<{ user: User } & TokenPair> {
    await this.authOAuthStateService.consume(
      OAUTH_PROVIDER_GOOGLE,
      dto.state,
      'login',
    );
    const profile = await this.googleOAuthProvider.fetchProfile({
      code: dto.code,
    });
    return this.loginWithOAuthProfile(profile, context);
  }

  async linkWechatWebIdentity(
    userId: string,
    dto: OAuthCallbackDto,
  ): Promise<void> {
    await this.userService.findById(userId);
    await this.authOAuthStateService.consume(
      OAUTH_PROVIDER_WECHAT_WEB,
      dto.state,
      'link',
    );
    const profile = await this.wechatWebOAuthProvider.fetchProfile({
      code: dto.code,
    });
    await this.authOAuthService.linkOAuthProfileToUser(userId, profile);
    this.authNotificationService
      .notifyIdentityLinked(userId, profile)
      .catch((error: unknown) => {
        this.logger.error(
          `Failed to send identity-linked notification for user ${userId}: ${error instanceof Error ? error.message : String(error)}`,
          error instanceof Error ? error.stack : undefined,
        );
      });
  }

  async linkWechatMobileIdentity(
    userId: string,
    dto: OAuthCodeCallbackDto,
  ): Promise<void> {
    await this.userService.findById(userId);
    const profile = await this.wechatMobileOAuthProvider.fetchProfile({
      code: dto.code,
    });
    await this.authOAuthService.linkOAuthProfileToUser(userId, profile);
  }

  private async loginWithOAuthProfile(
    profile: OAuthProfile,
    context?: AuthRequestContext,
  ): Promise<{ user: User } & TokenPair> {
    const user = await this.authOAuthService.findOrCreateOAuthUser(profile);
    const updatedUser = await this.authOAuthService.updateOAuthLoginUser(
      user,
      profile,
    );
    const tokens = await unwrapResult(
      this.authTokenService.generateTokenPair(updatedUser, context),
    );
    this.authNotificationService
      .notifyOAuthLogin(updatedUser.id, profile)
      .catch((error: unknown) => {
        this.logger.error(
          `Failed to send oauth-login notification for user ${updatedUser.id}: ${error instanceof Error ? error.message : String(error)}`,
          error instanceof Error ? error.stack : undefined,
        );
      });
    return { user: updatedUser, ...tokens };
  }
}
