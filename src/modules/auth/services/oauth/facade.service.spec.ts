import type { UserService } from '../../../user';
import type { WechatWebOAuthProvider } from '../../providers/wechat/wechat-web-oauth.provider';
import type { WechatMobileOAuthProvider } from '../../providers/wechat/wechat-mobile-oauth.provider';
import type { AppleOAuthProvider } from '../../providers/apple-oauth.provider';
import type { QqOAuthProvider } from '../../providers/qq-oauth.provider';
import type { WeiboOAuthProvider } from '../../providers/weibo-oauth.provider';
import type { GoogleOAuthProvider } from '../../providers/google-oauth.provider';
import type { AuthOAuthStateService } from './state.service';
import type { AuthTokenService } from '../token.service';
import type { AuthOAuthService } from './oauth.service';
import type { AuthNotificationService } from '../notification.service';
import type { OAuthProfile } from '../../types/oauth.types';
import { AuthOAuthFacadeService } from './facade.service';
import { okAsync } from '../../../../common/result';

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
  emailVerifiedAt: null,
  createdAt: new Date('2026-01-01T00:00:00Z'),
  updatedAt: new Date('2026-01-01T00:00:00Z'),
};

const mockTokens = {
  accessToken: 'access-token',
  refreshToken: 'refresh-token',
  accessTokenExpiresAt: '2026-07-11T00:00:00Z',
  refreshTokenExpiresAt: '2026-07-18T00:00:00Z',
};

describe('AuthOAuthFacadeService', () => {
  let service: AuthOAuthFacadeService;
  let userService: vi.Mocked<UserService>;
  let wechatWebProvider: vi.Mocked<WechatWebOAuthProvider>;
  let wechatMobileProvider: vi.Mocked<WechatMobileOAuthProvider>;
  let appleProvider: vi.Mocked<AppleOAuthProvider>;
  let qqProvider: vi.Mocked<QqOAuthProvider>;
  let weiboProvider: vi.Mocked<WeiboOAuthProvider>;
  let googleProvider: vi.Mocked<GoogleOAuthProvider>;
  let stateService: vi.Mocked<AuthOAuthStateService>;
  let tokenService: vi.Mocked<AuthTokenService>;
  let oauthService: vi.Mocked<AuthOAuthService>;
  let notificationService: vi.Mocked<AuthNotificationService>;

  beforeEach(() => {
    userService = {
      findById: vi.fn().mockResolvedValue(mockUser),
    } as unknown as vi.Mocked<UserService>;
    wechatWebProvider = {
      buildAuthorizeUrl: vi.fn().mockReturnValue('https://wx/auth?url=1'),
      fetchProfile: vi.fn().mockResolvedValue(mockProfile),
    } as unknown as vi.Mocked<WechatWebOAuthProvider>;
    wechatMobileProvider = {
      fetchProfile: vi.fn().mockResolvedValue({
        ...mockProfile,
        provider: 'wechat_mobile',
      }),
    } as unknown as vi.Mocked<WechatMobileOAuthProvider>;
    appleProvider = {
      fetchProfile: vi.fn().mockResolvedValue({
        ...mockProfile,
        provider: 'apple',
      }),
    } as unknown as vi.Mocked<AppleOAuthProvider>;
    qqProvider = {
      buildAuthorizeUrl: vi.fn().mockReturnValue('https://qq/auth?url=1'),
      fetchProfile: vi.fn().mockResolvedValue({
        ...mockProfile,
        provider: 'qq',
      }),
    } as unknown as vi.Mocked<QqOAuthProvider>;
    weiboProvider = {
      buildAuthorizeUrl: vi.fn().mockReturnValue('https://weibo/auth?url=1'),
      fetchProfile: vi.fn().mockResolvedValue({
        ...mockProfile,
        provider: 'weibo',
      }),
    } as unknown as vi.Mocked<WeiboOAuthProvider>;
    googleProvider = {
      buildAuthorizeUrl: vi.fn().mockReturnValue('https://google/auth?url=1'),
      fetchProfile: vi.fn().mockResolvedValue({
        ...mockProfile,
        provider: 'google',
      }),
    } as unknown as vi.Mocked<GoogleOAuthProvider>;
    stateService = {
      createState: vi.fn().mockResolvedValue({
        state: 'state-123',
        ttlSec: 300,
      }),
      peek: vi.fn().mockResolvedValue({
        provider: 'wechat_web',
        state: 'state-123',
        purpose: 'login',
        callbackUri: undefined,
        createdAt: new Date(),
      }),
      consume: vi.fn().mockResolvedValue(undefined),
      buildRedirectUrl: vi.fn().mockReturnValue('https://app/callback'),
    } as unknown as vi.Mocked<AuthOAuthStateService>;
    tokenService = {
      generateTokenPair: vi.fn().mockReturnValue(okAsync(mockTokens)),
    } as unknown as vi.Mocked<AuthTokenService>;
    oauthService = {
      findOrCreateOAuthUser: vi.fn().mockResolvedValue(mockUser),
      updateOAuthLoginUser: vi.fn().mockResolvedValue(mockUser),
      linkOAuthProfileToUser: vi.fn().mockResolvedValue(undefined),
    } as unknown as vi.Mocked<AuthOAuthService>;
    notificationService = {
      notifyOAuthLogin: vi.fn().mockResolvedValue(undefined),
      notifyIdentityLinked: vi.fn().mockResolvedValue(undefined),
    } as unknown as vi.Mocked<AuthNotificationService>;

    service = new AuthOAuthFacadeService(
      userService,
      wechatWebProvider,
      wechatMobileProvider,
      appleProvider,
      qqProvider,
      weiboProvider,
      googleProvider,
      stateService,
      tokenService,
      oauthService,
      notificationService,
    );
  });

  describe('createWechatWebAuthorizeUrl', () => {
    it('creates authorize URL for login purpose', async () => {
      const result = await service.createWechatWebAuthorizeUrl();

      expect(stateService.createState).toHaveBeenCalledWith(
        'wechat_web',
        'login',
        undefined,
      );
      expect(wechatWebProvider.buildAuthorizeUrl).toHaveBeenCalledWith(
        'state-123',
      );
      expect(result.state).toBe('state-123');
      expect(result.expiresIn).toBe(300);
    });

    it('passes callbackUri when provided', async () => {
      stateService.peek.mockResolvedValue({
        provider: 'wechat_web',
        state: 'state-123',
        purpose: 'login',
        callbackUri: 'https://app/cb',
        createdAt: new Date(),
      } as never);

      const result = await service.createWechatWebAuthorizeUrl({
        callbackUri: 'https://app/cb',
      });

      expect(result.callbackUri).toBe('https://app/cb');
    });
  });

  describe('createWechatWebIdentityLinkAuthorizeUrl', () => {
    it('creates authorize URL for link purpose', async () => {
      const result = await service.createWechatWebIdentityLinkAuthorizeUrl();

      expect(stateService.createState).toHaveBeenCalledWith(
        'wechat_web',
        'link',
        undefined,
      );
      expect(result.state).toBe('state-123');
    });
  });

  describe('resolveWechatWebCallbackRedirect', () => {
    it('returns redirect URL', async () => {
      const result = await service.resolveWechatWebCallbackRedirect({
        code: 'auth-code',
        state: 'state-123',
      });

      expect(stateService.peek).toHaveBeenCalledWith('wechat_web', 'state-123');
      expect(stateService.buildRedirectUrl).toHaveBeenCalled();
      expect(result).toBe('https://app/callback');
    });
  });

  describe('loginWithWechatWeb', () => {
    it('consumes state, fetches profile, and returns tokens', async () => {
      const result = await service.loginWithWechatWeb({
        code: 'auth-code',
        state: 'state-123',
      });

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
      expect(result.user).toBe(mockUser);
      expect(result.accessToken).toBe('access-token');
    });
  });

  describe('loginWithWechatMobile', () => {
    it('fetches profile and returns tokens', async () => {
      const result = await service.loginWithWechatMobile({ code: 'wx-code' });

      expect(wechatMobileProvider.fetchProfile).toHaveBeenCalledWith({
        code: 'wx-code',
      });
      expect(result.accessToken).toBe('access-token');
    });
  });

  describe('loginWithApple', () => {
    it('fetches profile and returns tokens', async () => {
      const result = await service.loginWithApple({
        identityToken: 'apple-token',
        authorizationCode: 'auth-code',
      });

      expect(appleProvider.fetchProfile).toHaveBeenCalledWith({
        identityToken: 'apple-token',
        authorizationCode: 'auth-code',
        givenName: undefined,
        familyName: undefined,
      });
      expect(result.accessToken).toBe('access-token');
    });
  });

  describe('createQqAuthorizeUrl', () => {
    it('creates QQ authorize URL', async () => {
      const result = await service.createQqAuthorizeUrl();

      expect(stateService.createState).toHaveBeenCalledWith(
        'qq',
        'login',
        undefined,
      );
      expect(qqProvider.buildAuthorizeUrl).toHaveBeenCalledWith(
        'state-123',
        undefined,
      );
      expect(result.state).toBe('state-123');
    });
  });

  describe('loginWithQq', () => {
    it('consumes state, fetches profile, and returns tokens', async () => {
      const result = await service.loginWithQq({
        code: 'qq-code',
        state: 'state-123',
      });

      expect(stateService.consume).toHaveBeenCalledWith(
        'qq',
        'state-123',
        'login',
      );
      expect(qqProvider.fetchProfile).toHaveBeenCalledWith({ code: 'qq-code' });
      expect(result.accessToken).toBe('access-token');
    });
  });

  describe('linkWechatWebIdentity', () => {
    it('links OAuth profile to user', async () => {
      await service.linkWechatWebIdentity('user-1', {
        code: 'link-code',
        state: 'state-123',
      });

      expect(stateService.consume).toHaveBeenCalledWith(
        'wechat_web',
        'state-123',
        'link',
      );
      expect(oauthService.linkOAuthProfileToUser).toHaveBeenCalledWith(
        'user-1',
        mockProfile,
      );
    });
  });

  describe('linkWechatMobileIdentity', () => {
    it('links OAuth profile to user without state consumption', async () => {
      await service.linkWechatMobileIdentity('user-1', { code: 'link-code' });

      expect(wechatMobileProvider.fetchProfile).toHaveBeenCalledWith({
        code: 'link-code',
      });
      expect(oauthService.linkOAuthProfileToUser).toHaveBeenCalled();
    });
  });
});
