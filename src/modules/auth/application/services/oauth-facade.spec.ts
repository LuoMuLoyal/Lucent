import type { UserService } from '../../../user/index.js';
import type { OAuthProvider } from '../ports/oauth-provider.js';
import type { AuthOAuthStateService } from '../../services/oauth/state.service.js';
import type { SessionTokens } from '../../application/services/session-tokens.js';
import type { AuthOAuthService } from '../../services/oauth/oauth.service.js';
import type { AuthNotificationService } from '../../services/notification.service.js';
import type { OAuthProviderProfile } from '../../application/ports/oauth-provider.js';
import { AuthOAuthFacadeService } from './oauth-facade.js';
import { UserStatus } from '#generated/prisma/client.js';
import {
  createDomainFailure,
  errAsync,
  ok,
  okAsync,
  type DomainFailure,
  type ResultAsync,
} from '../../../../common/result/index.js';

const mockProfile: OAuthProviderProfile = {
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
  let wechatWebProvider: vi.Mocked<OAuthProvider>;
  let wechatMobileProvider: vi.Mocked<OAuthProvider>;
  let qqProvider: vi.Mocked<OAuthProvider>;
  let googleProvider: vi.Mocked<OAuthProvider>;
  let stateService: vi.Mocked<AuthOAuthStateService>;
  let tokenService: vi.Mocked<SessionTokens>;
  let oauthService: vi.Mocked<AuthOAuthService>;
  let notificationService: vi.Mocked<AuthNotificationService>;
  let appleProvider: vi.Mocked<OAuthProvider>;

  beforeEach(() => {
    userService = {
      findById: vi.fn().mockResolvedValue(mockUser),
      update: vi.fn().mockReturnValue(okAsync(mockUser)),
    } as unknown as vi.Mocked<UserService>;
    wechatWebProvider = {
      buildAuthorizeUrl: vi.fn().mockReturnValue('https://wx/auth?url=1'),
      fetchProfile: vi.fn().mockReturnValue(okAsync(mockProfile)),
    } as unknown as vi.Mocked<OAuthProvider>;
    wechatMobileProvider = {
      fetchProfile: vi
        .fn()
        .mockReturnValue(
          okAsync({ ...mockProfile, provider: 'wechat_mobile' }),
        ),
    } as unknown as vi.Mocked<OAuthProvider>;
    appleProvider = {
      fetchProfile: vi
        .fn()
        .mockReturnValue(okAsync({ ...mockProfile, provider: 'apple' })),
    } as unknown as vi.Mocked<OAuthProvider>;
    qqProvider = {
      buildAuthorizeUrl: vi.fn().mockReturnValue('https://qq/auth?url=1'),
      fetchProfile: vi
        .fn()
        .mockReturnValue(okAsync({ ...mockProfile, provider: 'qq' })),
    } as unknown as vi.Mocked<OAuthProvider>;
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
      fetchProfileFromIdToken: vi
        .fn()
        .mockReturnValue(okAsync({ ...mockProfile, provider: 'google' })),
    } as unknown as vi.Mocked<OAuthProvider>;
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
      issue: vi.fn().mockReturnValue(okAsync(mockTokens)),
    } as unknown as vi.Mocked<SessionTokens>;
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
      googleProvider,
      appleProvider,
      stateService,
      tokenService,
      oauthService,
      notificationService,
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
      expect(tokenService.issue).toHaveBeenCalled();
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
    it('verifies the identity token, resolves the profile, and returns tokens', async () => {
      const outcome = await collectResult(
        service.loginWithApple({
          identityToken: 'apple-token',
          authorizationCode: 'auth-code',
        }),
      );

      expect(appleProvider.fetchProfile).toHaveBeenCalledWith({
        identityToken: 'apple-token',
        authorizationCode: 'auth-code',
        givenName: undefined,
        familyName: undefined,
      });
      expect(oauthService.findOrCreateOAuthUser).toHaveBeenCalledWith(
        expect.objectContaining({ provider: 'apple' }),
      );
      expect(oauthService.updateOAuthLoginUser).toHaveBeenCalledWith(
        mockUser,
        expect.objectContaining({ provider: 'apple' }),
      );
      expect(outcome).toEqual({
        ok: true,
        value: expect.objectContaining({ accessToken: 'access-token' }),
      });
    });
  });

  describe('loginWithGoogle', () => {
    it('exchanges code for tokens, verifies the id token, and returns tokens', async () => {
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
      expect(googleProvider.fetchProfileFromIdToken).toHaveBeenCalledWith(
        'google-id-token',
        'google-access',
      );
      expect(oauthService.findOrCreateOAuthUser).toHaveBeenCalledWith(
        expect.objectContaining({ provider: 'google' }),
      );
      expect(oauthService.updateOAuthLoginUser).toHaveBeenCalledWith(
        mockUser,
        expect.objectContaining({ provider: 'google' }),
      );
      expect(outcome).toEqual({
        ok: true,
        value: expect.objectContaining({ accessToken: 'access-token' }),
      });
    });

    it('returns AUTH_OAUTH_FAILED when the profile cannot be resolved to a user', async () => {
      oauthService.findOrCreateOAuthUser.mockReturnValue(
        errAsync(
          createDomainFailure({
            kind: 'authentication',
            code: 'AUTH_OAUTH_FAILED',
          }),
        ),
      );

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
      expect(oauthService.updateOAuthLoginUser).not.toHaveBeenCalled();
    });

    it('propagates an invalid state failure', async () => {
      stateService.consume.mockReturnValue(errAsync(stateInvalidFailure));

      const outcome = await collectResult(
        service.loginWithGoogle({ code: 'google-code', state: 'bad-state' }),
      );

      expect(outcome).toEqual({ ok: false, error: stateInvalidFailure });
      expect(googleProvider.exchangeCodeForTokens).not.toHaveBeenCalled();
    });

    it('propagates an id-token verification failure from the provider', async () => {
      const verificationFailure = createDomainFailure({
        kind: 'dependency',
        code: 'DEPENDENCY_UNAVAILABLE',
      });
      (googleProvider.fetchProfileFromIdToken as vi.Mock).mockReturnValue(
        errAsync(verificationFailure),
      );

      const outcome = await collectResult(
        service.loginWithGoogle({ code: 'google-code', state: 'state-123' }),
      );

      expect(outcome).toEqual({ ok: false, error: verificationFailure });
      expect(oauthService.findOrCreateOAuthUser).not.toHaveBeenCalled();
    });

    it('propagates a token-exchange failure from the provider', async () => {
      const exchangeFailure = createDomainFailure({
        kind: 'dependency',
        code: 'DEPENDENCY_UNAVAILABLE',
      });
      (googleProvider.exchangeCodeForTokens as vi.Mock).mockReturnValue(
        errAsync(exchangeFailure),
      );

      const outcome = await collectResult(
        service.loginWithGoogle({ code: 'google-code', state: 'state-123' }),
      );

      expect(outcome).toEqual({ ok: false, error: exchangeFailure });
      expect(oauthService.findOrCreateOAuthUser).not.toHaveBeenCalled();
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
