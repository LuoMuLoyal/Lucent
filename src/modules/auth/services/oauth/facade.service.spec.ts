import type { UserService } from '../../../user';
import type { WechatWebOAuthProvider } from '../../providers/wechat/wechat-web-oauth.provider';
import type { WechatMobileOAuthProvider } from '../../providers/wechat/wechat-mobile-oauth.provider';
import type { QqOAuthProvider } from '../../providers/qq-oauth.provider';
import type { WeiboOAuthProvider } from '../../providers/weibo-oauth.provider';
import type { GoogleOAuthProvider } from '../../providers/google-oauth.provider';
import type { AuthOAuthStateService } from './state.service';
import type { AuthTokenService } from '../token.service';
import type { AuthOAuthService } from './oauth.service';
import type { AuthNotificationService } from '../notification.service';
import type { OAuthProfile } from '../../types/oauth.types';
import type { AuthBetterAuthAdapter } from '../../adapters/better-auth.adapter';
import { AuthOAuthFacadeService } from './facade.service';
import { UserStatus } from '#generated/prisma/client';
import {
  createDomainFailure,
  errAsync,
  ok,
  okAsync,
  type DomainFailure,
  type ResultAsync,
} from '../../../../common/result';

const mockProfile: OAuthProfile = {
  provider: 'wechat_web',
  providerUserId: 'wx-123',
  nickname: 'TestUser',
};

const mockUser = {
  id: 'user-1',
  email: 'test@example.com',
  nickname: 'TestUser',
  avatar: null,
  status: UserStatus.active,
  emailVerified: true,
  emailVerifiedAt: null,
  lastLoginAt: null,
  deletedAt: null,
  createdAt: new Date('2026-01-01T00:00:00Z'),
  updatedAt: new Date('2026-01-01T00:00:00Z'),
};

const mockTokens = {
  accessToken: 'access-token',
  refreshToken: 'refresh-token',
  accessTokenExpiresAt: '2026-07-11T00:00:00Z',
  refreshTokenExpiresAt: '2026-07-18T00:00:00Z',
};

const stateInvalidFailure = createDomainFailure({
  kind: 'authentication',
  code: 'AUTH_OAUTH_STATE_INVALID',
});

const dependencyUnavailableFailure = createDomainFailure({
  kind: 'dependency',
  code: 'DEPENDENCY_UNAVAILABLE',
});

function collectResult<T>(
  result: ResultAsync<T, DomainFailure>,
): Promise<{ ok: true; value: T } | { ok: false; error: DomainFailure }> {
  return result.match(
    (value) => ({ ok: true as const, value }),
    (error) => ({ ok: false as const, error }),
  );
}

describe('AuthOAuthFacadeService', () => {
  let service: AuthOAuthFacadeService;
  let userService: vi.Mocked<UserService>;
  let wechatWebProvider: vi.Mocked<WechatWebOAuthProvider>;
  let wechatMobileProvider: vi.Mocked<WechatMobileOAuthProvider>;
  let qqProvider: vi.Mocked<QqOAuthProvider>;
  let weiboProvider: vi.Mocked<WeiboOAuthProvider>;
  let googleProvider: vi.Mocked<GoogleOAuthProvider>;
  let stateService: vi.Mocked<AuthOAuthStateService>;
  let tokenService: vi.Mocked<AuthTokenService>;
  let oauthService: vi.Mocked<AuthOAuthService>;
  let notificationService: vi.Mocked<AuthNotificationService>;
  let betterAuthAdapter: {
    auth: { api: { signInSocial: ReturnType<typeof vi.fn> } };
    revokeBetterAuthSessions: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    userService = {
      findById: vi.fn().mockResolvedValue(mockUser),
      update: vi.fn().mockReturnValue(okAsync(mockUser)),
    } as unknown as vi.Mocked<UserService>;
    wechatWebProvider = {
      buildAuthorizeUrl: vi.fn().mockReturnValue('https://wx/auth?url=1'),
      fetchProfile: vi.fn().mockReturnValue(okAsync(mockProfile)),
    } as unknown as vi.Mocked<WechatWebOAuthProvider>;
    wechatMobileProvider = {
      fetchProfile: vi
        .fn()
        .mockReturnValue(
          okAsync({ ...mockProfile, provider: 'wechat_mobile' }),
        ),
    } as unknown as vi.Mocked<WechatMobileOAuthProvider>;
    betterAuthAdapter = {
      auth: {
        api: {
          signInSocial: vi.fn(),
        },
      },
      revokeBetterAuthSessions: vi.fn().mockReturnValue(okAsync(undefined)),
    };
    qqProvider = {
      buildAuthorizeUrl: vi.fn().mockReturnValue('https://qq/auth?url=1'),
      fetchProfile: vi
        .fn()
        .mockReturnValue(okAsync({ ...mockProfile, provider: 'qq' })),
    } as unknown as vi.Mocked<QqOAuthProvider>;
    weiboProvider = {
      buildAuthorizeUrl: vi.fn().mockReturnValue('https://weibo/auth?url=1'),
      fetchProfile: vi
        .fn()
        .mockReturnValue(okAsync({ ...mockProfile, provider: 'weibo' })),
    } as unknown as vi.Mocked<WeiboOAuthProvider>;
    googleProvider = {
      buildAuthorizeUrl: vi.fn().mockReturnValue('https://google/auth?url=1'),
      fetchProfile: vi
        .fn()
        .mockReturnValue(okAsync({ ...mockProfile, provider: 'google' })),
      exchangeCodeForTokens: vi
        .fn()
        .mockReturnValue(
          okAsync({ accessToken: 'google-access', idToken: 'google-id-token' }),
        ),
    } as unknown as vi.Mocked<GoogleOAuthProvider>;
    stateService = {
      createState: vi
        .fn()
        .mockReturnValue(okAsync({ state: 'state-123', ttlSec: 300 })),
      peek: vi.fn().mockReturnValue(
        okAsync({
          provider: 'wechat_web',
          purpose: 'login',
          callbackUri: undefined,
        }),
      ),
      consume: vi.fn().mockReturnValue(okAsync(undefined as never)),
      buildRedirectUrl: vi.fn().mockReturnValue(ok('https://app/callback')),
    } as unknown as vi.Mocked<AuthOAuthStateService>;
    tokenService = {
      generateTokenPair: vi.fn().mockReturnValue(okAsync(mockTokens)),
    } as unknown as vi.Mocked<AuthTokenService>;
    oauthService = {
      findOrCreateOAuthUser: vi.fn().mockReturnValue(okAsync(mockUser)),
      updateOAuthLoginUser: vi.fn().mockReturnValue(okAsync(mockUser)),
      linkOAuthProfileToUser: vi.fn().mockReturnValue(okAsync(undefined)),
    } as unknown as vi.Mocked<AuthOAuthService>;
    notificationService = {
      notifyOAuthLogin: vi.fn().mockResolvedValue(undefined),
      notifyIdentityLinked: vi.fn().mockResolvedValue(undefined),
    } as unknown as vi.Mocked<AuthNotificationService>;

    service = new AuthOAuthFacadeService(
      userService,
      wechatWebProvider,
      wechatMobileProvider,
      qqProvider,
      weiboProvider,
      googleProvider,
      stateService,
      tokenService,
      oauthService,
      notificationService,
      betterAuthAdapter as unknown as AuthBetterAuthAdapter,
    );
  });

  describe('createWechatWebAuthorizeUrl', () => {
    it('creates authorize URL for login purpose', async () => {
      const outcome = await collectResult(
        service.createWechatWebAuthorizeUrl(),
      );

      expect(stateService.createState).toHaveBeenCalledWith(
        'wechat_web',
        'login',
        undefined,
      );
      expect(wechatWebProvider.buildAuthorizeUrl).toHaveBeenCalledWith(
        'state-123',
      );
      expect(outcome).toEqual({
        ok: true,
        value: {
          authorizeUrl: 'https://wx/auth?url=1',
          state: 'state-123',
          expiresIn: 300,
        },
      });
    });

    it('passes callbackUri when provided', async () => {
      stateService.peek.mockReturnValue(
        okAsync({
          provider: 'wechat_web',
          purpose: 'login',
          callbackUri: 'https://app/cb',
        }),
      );

      const outcome = await collectResult(
        service.createWechatWebAuthorizeUrl({
          callbackUri: 'https://app/cb',
        }),
      );

      expect(outcome).toEqual({
        ok: true,
        value: expect.objectContaining({ callbackUri: 'https://app/cb' }),
      });
    });

    it('propagates an invalid state failure', async () => {
      stateService.createState.mockReturnValue(errAsync(stateInvalidFailure));

      const outcome = await collectResult(
        service.createWechatWebAuthorizeUrl(),
      );

      expect(outcome).toEqual({ ok: false, error: stateInvalidFailure });
    });
  });

  describe('createWechatWebIdentityLinkAuthorizeUrl', () => {
    it('creates authorize URL for link purpose', async () => {
      const outcome = await collectResult(
        service.createWechatWebIdentityLinkAuthorizeUrl(),
      );

      expect(stateService.createState).toHaveBeenCalledWith(
        'wechat_web',
        'link',
        undefined,
      );
      expect(outcome).toEqual({
        ok: true,
        value: expect.objectContaining({ state: 'state-123' }),
      });
    });
  });

  describe('resolveWechatWebCallbackRedirect', () => {
    it('returns redirect URL', async () => {
      const outcome = await collectResult(
        service.resolveWechatWebCallbackRedirect({
          code: 'auth-code',
          state: 'state-123',
        }),
      );

      expect(stateService.peek).toHaveBeenCalledWith('wechat_web', 'state-123');
      expect(stateService.buildRedirectUrl).toHaveBeenCalled();
      expect(outcome).toEqual({ ok: true, value: 'https://app/callback' });
    });

    it('propagates an invalid state failure', async () => {
      stateService.peek.mockReturnValue(errAsync(stateInvalidFailure));

      const outcome = await collectResult(
        service.resolveWechatWebCallbackRedirect({
          code: 'auth-code',
          state: 'bad-state',
        }),
      );

      expect(outcome).toEqual({ ok: false, error: stateInvalidFailure });
    });
  });

  describe('loginWithWechatWeb', () => {
    it('consumes state, fetches profile, and returns tokens', async () => {
      const outcome = await collectResult(
        service.loginWithWechatWeb({
          code: 'auth-code',
          state: 'state-123',
        }),
      );

      expect(stateService.consume).toHaveBeenCalledWith(
        'wechat_web',
        'state-123',
        'login',
      );
      expect(wechatWebProvider.fetchProfile).toHaveBeenCalledWith({
        code: 'auth-code',
      });
      expect(oauthService.findOrCreateOAuthUser).toHaveBeenCalledWith(
        mockProfile,
      );
      expect(tokenService.generateTokenPair).toHaveBeenCalled();
      expect(outcome).toEqual({
        ok: true,
        value: expect.objectContaining({
          user: mockUser,
          accessToken: 'access-token',
        }),
      });
    });

    it('propagates an invalid state failure without fetching the profile', async () => {
      stateService.consume.mockReturnValue(errAsync(stateInvalidFailure));

      const outcome = await collectResult(
        service.loginWithWechatWeb({
          code: 'auth-code',
          state: 'bad-state',
        }),
      );

      expect(outcome).toEqual({ ok: false, error: stateInvalidFailure });
      expect(wechatWebProvider.fetchProfile).not.toHaveBeenCalled();
    });

    it('propagates a dependency-unavailable failure from the provider', async () => {
      wechatWebProvider.fetchProfile.mockReturnValue(
        errAsync(dependencyUnavailableFailure),
      );

      const outcome = await collectResult(
        service.loginWithWechatWeb({
          code: 'auth-code',
          state: 'state-123',
        }),
      );

      expect(outcome).toEqual({
        ok: false,
        error: dependencyUnavailableFailure,
      });
      expect(oauthService.findOrCreateOAuthUser).not.toHaveBeenCalled();
    });
  });

  describe('loginWithWechatMobile', () => {
    it('fetches profile and returns tokens', async () => {
      const outcome = await collectResult(
        service.loginWithWechatMobile({ code: 'wx-code' }),
      );

      expect(wechatMobileProvider.fetchProfile).toHaveBeenCalledWith({
        code: 'wx-code',
      });
      expect(outcome).toEqual({
        ok: true,
        value: expect.objectContaining({ accessToken: 'access-token' }),
      });
    });
  });

  describe('loginWithApple', () => {
    it('calls Better Auth social sign-in and returns tokens', async () => {
      betterAuthAdapter.auth.api.signInSocial.mockResolvedValue({
        user: { id: 'user-1' },
      });

      const outcome = await collectResult(
        service.loginWithApple({
          identityToken: 'apple-token',
          authorizationCode: 'auth-code',
        }),
      );

      expect(betterAuthAdapter.auth.api.signInSocial).toHaveBeenCalledWith({
        body: {
          provider: 'apple',
          idToken: {
            token: 'apple-token',
            accessToken: 'auth-code',
          },
        },
      });
      expect(userService.update).toHaveBeenCalledWith('user-1', {
        lastLoginAt: expect.any(Date),
        status: UserStatus.active,
      });
      expect(betterAuthAdapter.revokeBetterAuthSessions).toHaveBeenCalledWith(
        'user-1',
      );
      expect(outcome).toEqual({
        ok: true,
        value: expect.objectContaining({ accessToken: 'access-token' }),
      });
    });
  });

  describe('loginWithGoogle', () => {
    it('exchanges code for tokens, calls Better Auth, and returns tokens', async () => {
      betterAuthAdapter.auth.api.signInSocial.mockResolvedValue({
        user: { id: 'user-1' },
      });

      const outcome = await collectResult(
        service.loginWithGoogle({ code: 'google-code', state: 'state-123' }),
      );

      expect(stateService.consume).toHaveBeenCalledWith(
        'google',
        'state-123',
        'login',
      );
      expect(googleProvider.exchangeCodeForTokens).toHaveBeenCalledWith(
        'google-code',
      );
      expect(betterAuthAdapter.auth.api.signInSocial).toHaveBeenCalledWith({
        body: {
          provider: 'google',
          idToken: {
            token: 'google-id-token',
            accessToken: 'google-access',
          },
        },
      });
      expect(userService.update).toHaveBeenCalledWith('user-1', {
        lastLoginAt: expect.any(Date),
        status: UserStatus.active,
      });
      expect(betterAuthAdapter.revokeBetterAuthSessions).toHaveBeenCalledWith(
        'user-1',
      );
      expect(outcome).toEqual({
        ok: true,
        value: expect.objectContaining({ accessToken: 'access-token' }),
      });
    });

    it('returns AUTH_OAUTH_FAILED when Better Auth user does not exist locally', async () => {
      betterAuthAdapter.auth.api.signInSocial.mockResolvedValue({
        user: { id: 'missing-user' },
      });
      userService.findById.mockResolvedValue(null);

      const outcome = await collectResult(
        service.loginWithGoogle({ code: 'google-code', state: 'state-123' }),
      );

      expect(outcome).toEqual({
        ok: false,
        error: expect.objectContaining({
          kind: 'authentication',
          code: 'AUTH_OAUTH_FAILED',
        }),
      });
    });

    it('propagates an invalid state failure', async () => {
      stateService.consume.mockReturnValue(errAsync(stateInvalidFailure));

      const outcome = await collectResult(
        service.loginWithGoogle({ code: 'google-code', state: 'bad-state' }),
      );

      expect(outcome).toEqual({ ok: false, error: stateInvalidFailure });
      expect(googleProvider.exchangeCodeForTokens).not.toHaveBeenCalled();
    });

    it('maps an unknown Better Auth 4xx error to AUTH_OAUTH_FAILED', async () => {
      betterAuthAdapter.auth.api.signInSocial.mockRejectedValue({
        statusCode: 400,
        body: { code: 'UNKNOWN_OAUTH_ERROR' },
      });

      const outcome = await collectResult(
        service.loginWithGoogle({ code: 'google-code', state: 'state-123' }),
      );

      expect(outcome).toEqual({
        ok: false,
        error: expect.objectContaining({
          kind: 'authentication',
          code: 'AUTH_OAUTH_FAILED',
        }),
      });
    });

    it('maps a disabled social provider error to AUTH_METHOD_DISABLED', async () => {
      betterAuthAdapter.auth.api.signInSocial.mockRejectedValue({
        statusCode: 400,
        body: { code: 'SOCIAL_SIGN_IN_DISABLED' },
      });

      const outcome = await collectResult(
        service.loginWithGoogle({ code: 'google-code', state: 'state-123' }),
      );

      expect(outcome).toEqual({
        ok: false,
        error: expect.objectContaining({
          kind: 'dependency',
          code: 'AUTH_METHOD_DISABLED',
        }),
      });
    });

    it('maps an unknown Better Auth 5xx error to DEPENDENCY_UNAVAILABLE', async () => {
      betterAuthAdapter.auth.api.signInSocial.mockRejectedValue({
        statusCode: 500,
        body: { code: 'FAILED_TO_CREATE_SESSION' },
      });

      const outcome = await collectResult(
        service.loginWithGoogle({ code: 'google-code', state: 'state-123' }),
      );

      expect(outcome).toEqual({
        ok: false,
        error: expect.objectContaining({
          kind: 'dependency',
          code: 'DEPENDENCY_UNAVAILABLE',
        }),
      });
    });
  });

  describe('createQqAuthorizeUrl', () => {
    it('creates QQ authorize URL', async () => {
      const outcome = await collectResult(service.createQqAuthorizeUrl());

      expect(stateService.createState).toHaveBeenCalledWith(
        'qq',
        'login',
        undefined,
      );
      expect(qqProvider.buildAuthorizeUrl).toHaveBeenCalledWith(
        'state-123',
        undefined,
      );
      expect(outcome).toEqual({
        ok: true,
        value: expect.objectContaining({ state: 'state-123' }),
      });
    });
  });

  describe('loginWithQq', () => {
    it('consumes state, fetches profile, and returns tokens', async () => {
      const outcome = await collectResult(
        service.loginWithQq({
          code: 'qq-code',
          state: 'state-123',
        }),
      );

      expect(stateService.consume).toHaveBeenCalledWith(
        'qq',
        'state-123',
        'login',
      );
      expect(qqProvider.fetchProfile).toHaveBeenCalledWith({ code: 'qq-code' });
      expect(outcome).toEqual({
        ok: true,
        value: expect.objectContaining({ accessToken: 'access-token' }),
      });
    });

    it('propagates an invalid state failure', async () => {
      stateService.consume.mockReturnValue(errAsync(stateInvalidFailure));

      const outcome = await collectResult(
        service.loginWithQq({ code: 'qq-code', state: 'bad-state' }),
      );

      expect(outcome).toEqual({ ok: false, error: stateInvalidFailure });
    });
  });

  describe('linkWechatWebIdentity', () => {
    it('links OAuth profile to user', async () => {
      const outcome = await collectResult(
        service.linkWechatWebIdentity('user-1', {
          code: 'link-code',
          state: 'state-123',
        }),
      );

      expect(stateService.consume).toHaveBeenCalledWith(
        'wechat_web',
        'state-123',
        'link',
      );
      expect(oauthService.linkOAuthProfileToUser).toHaveBeenCalledWith(
        'user-1',
        mockProfile,
      );
      expect(outcome).toEqual({ ok: true, value: undefined });
    });

    it('propagates an invalid state failure', async () => {
      stateService.consume.mockReturnValue(errAsync(stateInvalidFailure));

      const outcome = await collectResult(
        service.linkWechatWebIdentity('user-1', {
          code: 'link-code',
          state: 'bad-state',
        }),
      );

      expect(outcome).toEqual({ ok: false, error: stateInvalidFailure });
      expect(oauthService.linkOAuthProfileToUser).not.toHaveBeenCalled();
    });

    it('propagates an identity-conflict failure', async () => {
      oauthService.linkOAuthProfileToUser.mockReturnValue(
        errAsync(
          createDomainFailure({
            kind: 'conflict',
            code: 'RESOURCE_CONFLICT',
          }),
        ),
      );

      const outcome = await collectResult(
        service.linkWechatWebIdentity('user-1', {
          code: 'link-code',
          state: 'state-123',
        }),
      );

      expect(outcome).toEqual({
        ok: false,
        error: expect.objectContaining({ code: 'RESOURCE_CONFLICT' }),
      });
    });
  });

  describe('linkWechatMobileIdentity', () => {
    it('links OAuth profile to user without state consumption', async () => {
      const outcome = await collectResult(
        service.linkWechatMobileIdentity('user-1', { code: 'link-code' }),
      );

      expect(wechatMobileProvider.fetchProfile).toHaveBeenCalledWith({
        code: 'link-code',
      });
      expect(oauthService.linkOAuthProfileToUser).toHaveBeenCalled();
      expect(outcome).toEqual({ ok: true, value: undefined });
    });
  });
});
