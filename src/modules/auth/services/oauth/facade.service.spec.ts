import type { UserService } from '../../../user/services/user.service';
import type { WechatWebOAuthProvider } from '../../providers/wechat-web-oauth.provider';
import type { WechatMobileOAuthProvider } from '../../providers/wechat-mobile-oauth.provider';
import type { AppleOAuthProvider } from '../../providers/apple-oauth.provider';
import type { QqOAuthProvider } from '../../providers/qq-oauth.provider';
import type { AuthOAuthStateService } from './state.service';
import type { AuthTokenService } from '../token.service';
import type { AuthOAuthService } from './oauth.service';
import type { AuthNotificationService } from '../notification.service';
import type { OAuthProfile } from '../../types/oauth.types';
import { AuthOAuthFacadeService } from './facade.service';

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
  let userService: jest.Mocked<UserService>;
  let wechatWebProvider: jest.Mocked<WechatWebOAuthProvider>;
  let wechatMobileProvider: jest.Mocked<WechatMobileOAuthProvider>;
  let appleProvider: jest.Mocked<AppleOAuthProvider>;
  let qqProvider: jest.Mocked<QqOAuthProvider>;
  let stateService: jest.Mocked<AuthOAuthStateService>;
  let tokenService: jest.Mocked<AuthTokenService>;
  let oauthService: jest.Mocked<AuthOAuthService>;
  let notificationService: jest.Mocked<AuthNotificationService>;

  beforeEach(() => {
    userService = {
      findById: jest.fn().mockResolvedValue(mockUser),
    } as unknown as jest.Mocked<UserService>;
    wechatWebProvider = {
      buildAuthorizeUrl: jest.fn().mockReturnValue('https://wx/auth?url=1'),
      fetchProfile: jest.fn().mockResolvedValue(mockProfile),
    } as unknown as jest.Mocked<WechatWebOAuthProvider>;
    wechatMobileProvider = {
      fetchProfile: jest.fn().mockResolvedValue({
        ...mockProfile,
        provider: 'wechat_mobile',
      }),
    } as unknown as jest.Mocked<WechatMobileOAuthProvider>;
    appleProvider = {
      fetchProfile: jest.fn().mockResolvedValue({
        ...mockProfile,
        provider: 'apple',
      }),
    } as unknown as jest.Mocked<AppleOAuthProvider>;
    qqProvider = {
      buildAuthorizeUrl: jest.fn().mockReturnValue('https://qq/auth?url=1'),
      fetchProfile: jest.fn().mockResolvedValue({
        ...mockProfile,
        provider: 'qq',
      }),
    } as unknown as jest.Mocked<QqOAuthProvider>;
    stateService = {
      createState: jest.fn().mockResolvedValue({
        state: 'state-123',
        ttlSec: 300,
      }),
      peek: jest.fn().mockResolvedValue({
        provider: 'wechat_web',
        state: 'state-123',
        purpose: 'login',
        callbackUri: undefined,
        createdAt: new Date(),
      }),
      consume: jest.fn().mockResolvedValue(undefined),
      buildRedirectUrl: jest.fn().mockReturnValue('https://app/callback'),
    } as unknown as jest.Mocked<AuthOAuthStateService>;
    tokenService = {
      generateTokenPair: jest.fn().mockResolvedValue(mockTokens),
    } as unknown as jest.Mocked<AuthTokenService>;
    oauthService = {
      findOrCreateOAuthUser: jest.fn().mockResolvedValue(mockUser),
      updateOAuthLoginUser: jest.fn().mockResolvedValue(mockUser),
      linkOAuthProfileToUser: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<AuthOAuthService>;
    notificationService = {
      notifyOAuthLogin: jest.fn().mockResolvedValue(undefined),
      notifyIdentityLinked: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<AuthNotificationService>;

    service = new AuthOAuthFacadeService(
      userService,
      wechatWebProvider,
      wechatMobileProvider,
      appleProvider,
      qqProvider,
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
      });

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
