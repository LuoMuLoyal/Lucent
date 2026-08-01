import { Test, type TestingModule } from '@nestjs/testing';
import { ResultCode } from '../../../common';
import type { FastifyRequest, FastifyReply } from 'fastify';
import { OAuthController } from './oauth.controller';
import { AuthService } from '../services/auth.service';

const mockRequest = {
  headers: { 'user-agent': 'test-agent' },
  ip: '127.0.0.1',
  raw: { socket: { remoteAddress: '127.0.0.1' } },
} as unknown as FastifyRequest;

const mockAuthResult = {
  user: {
    id: 'user-1',
    email: 'test@example.com',
    nickname: 'TestUser',
    avatar: null,
    emailVerifiedAt: null,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
  },
  accessToken: 'access-token',
  refreshToken: 'refresh-token',
  accessTokenExpiresAt: '2026-07-11T00:00:00Z',
  refreshTokenExpiresAt: '2026-07-18T00:00:00Z',
};

describe('OAuthController', () => {
  let controller: OAuthController;
  let authService: vi.Mocked<AuthService>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [OAuthController],
      providers: [
        {
          provide: AuthService,
          useValue: {
            createWechatWebAuthorizeUrl: vi.fn(),
            loginWithWechatWeb: vi.fn(),
            resolveWechatWebCallbackRedirect: vi.fn(),
            loginWithWechatMobile: vi.fn(),
            loginWithApple: vi.fn(),
            createQqAuthorizeUrl: vi.fn(),
            loginWithQq: vi.fn(),
            createWeiboAuthorizeUrl: vi.fn(),
            loginWithWeibo: vi.fn(),
            createGoogleAuthorizeUrl: vi.fn(),
            loginWithGoogle: vi.fn(),
          },
        },
      ],
    }).compile();

    controller = module.get(OAuthController);
    authService = module.get(AuthService);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('POST /auth/oauth/wechat-web/authorize', () => {
    it('returns authorize URL envelope', async () => {
      authService.createWechatWebAuthorizeUrl.mockResolvedValue({
        authorizeUrl: 'https://wx/auth',
        state: 'state-123',
        expiresIn: 300,
      } as never);

      const result = await controller.createWechatWebAuthorizeUrl({
        callbackUri: 'https://app/cb',
      });

      expect(result.code).toBe(ResultCode.SUCCESS);
      expect(result.data).toHaveProperty('authorizeUrl');
    });
  });

  describe('POST /auth/oauth/wechat-web/callback', () => {
    it('returns auth response envelope', async () => {
      authService.loginWithWechatWeb.mockResolvedValue(mockAuthResult as never);

      const result = await controller.loginWithWechatWeb(
        { code: 'wx-code', state: 'state-123' },
        mockRequest,
      );

      expect(authService.loginWithWechatWeb).toHaveBeenCalled();
      expect(result.code).toBe(ResultCode.SUCCESS);
      expect(result.data).toHaveProperty('user');
    });
  });

  describe('GET /auth/oauth/wechat-web/callback (redirect)', () => {
    it('redirects to the resolved URL', async () => {
      authService.resolveWechatWebCallbackRedirect.mockResolvedValue(
        'https://app/cb?code=wx-code&state=state-123',
      );

      const mockReply = {
        redirect: vi.fn(),
      } as unknown as FastifyReply;

      await controller.redirectWechatWebCallback(
        { code: 'wx-code', state: 'state-123' },
        mockReply,
      );

      expect(mockReply.redirect).toHaveBeenCalledWith(
        'https://app/cb?code=wx-code&state=state-123',
        302,
      );
    });
  });

  describe('POST /auth/oauth/wechat-mobile/callback', () => {
    it('returns auth response envelope', async () => {
      authService.loginWithWechatMobile.mockResolvedValue(
        mockAuthResult as never,
      );

      const result = await controller.loginWithWechatMobile(
        { code: 'wx-code' },
        mockRequest,
      );

      expect(result.data).toHaveProperty('user');
    });
  });

  describe('POST /auth/oauth/apple/callback', () => {
    it('returns auth response envelope', async () => {
      authService.loginWithApple.mockResolvedValue(mockAuthResult as never);

      const result = await controller.loginWithApple(
        { identityToken: 'apple-token', authorizationCode: 'code' },
        mockRequest,
      );

      expect(result.data).toHaveProperty('user');
    });
  });

  describe('POST /auth/oauth/qq/authorize', () => {
    it('returns authorize URL envelope', async () => {
      authService.createQqAuthorizeUrl.mockResolvedValue({
        authorizeUrl: 'https://qq/auth',
        state: 'state-qq',
        expiresIn: 300,
      } as never);

      const result = await controller.createQqAuthorizeUrl();

      expect(result.data).toHaveProperty('authorizeUrl');
    });
  });

  describe('POST /auth/oauth/qq/callback', () => {
    it('returns auth response envelope', async () => {
      authService.loginWithQq.mockResolvedValue(mockAuthResult as never);

      const result = await controller.loginWithQq(
        { code: 'qq-code', state: 'state-qq' },
        mockRequest,
      );

      expect(result.data).toHaveProperty('user');
    });
  });

  describe('POST /auth/oauth/weibo/authorize', () => {
    it('returns authorize URL envelope', async () => {
      authService.createWeiboAuthorizeUrl.mockResolvedValue({
        authorizeUrl: 'https://weibo/auth',
        state: 'state-weibo',
        expiresIn: 300,
      } as never);

      const result = await controller.createWeiboAuthorizeUrl({
        callbackUri: 'https://app/cb',
      });

      expect(result.data).toHaveProperty('authorizeUrl');
    });
  });

  describe('POST /auth/oauth/weibo/callback', () => {
    it('returns auth response envelope', async () => {
      authService.loginWithWeibo.mockResolvedValue(mockAuthResult as never);

      const result = await controller.loginWithWeibo(
        { code: 'weibo-code', state: 'state-weibo' },
        mockRequest,
      );

      expect(result.data).toHaveProperty('user');
    });
  });

  describe('POST /auth/oauth/google/authorize', () => {
    it('returns authorize URL envelope', async () => {
      authService.createGoogleAuthorizeUrl.mockResolvedValue({
        authorizeUrl: 'https://google/auth',
        state: 'state-google',
        expiresIn: 300,
      } as never);

      const result = await controller.createGoogleAuthorizeUrl({
        callbackUri: 'https://app/cb',
      });

      expect(result.data).toHaveProperty('authorizeUrl');
    });
  });

  describe('POST /auth/oauth/google/callback', () => {
    it('returns auth response envelope', async () => {
      authService.loginWithGoogle.mockResolvedValue(mockAuthResult as never);

      const result = await controller.loginWithGoogle(
        { code: 'google-code', state: 'state-google' },
        mockRequest,
      );

      expect(result.data).toHaveProperty('user');
    });
  });

  describe('provider failure propagation', () => {
    it('propagates OAuth login failures without catching', async () => {
      authService.loginWithWechatWeb.mockRejectedValue(
        new Error('OAUTH_STATE_MISSING'),
      );

      await expect(
        controller.loginWithWechatWeb({ code: 'x', state: 'bad' }, mockRequest),
      ).rejects.toThrow('OAUTH_STATE_MISSING');
    });
  });
});
