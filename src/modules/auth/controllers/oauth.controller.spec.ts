import { Test, type TestingModule } from '@nestjs/testing';
import type { FastifyRequest, FastifyReply } from 'fastify';
import { OAuthController } from './oauth.controller.js';
import { AuthService } from '../services/auth.service.js';
import {
  createDomainFailure,
  errAsync,
  okAsync,
} from '../../../common/result/index.js';

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

const stateInvalidFailure = createDomainFailure({
  kind: 'authentication',
  code: 'AUTH_OAUTH_STATE_INVALID',
});

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
    it('returns the authorize URL resource', async () => {
      authService.createWechatWebAuthorizeUrl.mockReturnValue(
        okAsync({
          authorizeUrl: 'https://wx/auth',
          state: 'state-123',
          expiresIn: 300,
        }),
      );

      const result = await controller.createWechatWebAuthorizeUrl({
        callbackUri: 'https://app/cb',
      });

      expect(result).toHaveProperty('authorizeUrl');
    });
  });

  describe('POST /auth/oauth/wechat-web/callback', () => {
    it('returns an auth resource', async () => {
      authService.loginWithWechatWeb.mockReturnValue(
        okAsync(mockAuthResult as never),
      );

      const result = await controller.loginWithWechatWeb(
        { code: 'wx-code', state: 'state-123' },
        mockRequest,
      );

      expect(authService.loginWithWechatWeb).toHaveBeenCalled();
      expect(result).toHaveProperty('user');
    });

    it('folds an invalid state into a DomainFailureException', async () => {
      authService.loginWithWechatWeb.mockReturnValue(
        errAsync(stateInvalidFailure),
      );

      await expect(
        controller.loginWithWechatWeb({ code: 'x', state: 'bad' }, mockRequest),
      ).rejects.toMatchObject({ failure: stateInvalidFailure });
    });
  });

  describe('GET /auth/oauth/wechat-web/callback (redirect)', () => {
    it('redirects to the resolved URL', async () => {
      authService.resolveWechatWebCallbackRedirect.mockReturnValue(
        okAsync('https://app/cb?code=wx-code&state=state-123'),
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

    it('folds an invalid state into a DomainFailureException instead of redirecting', async () => {
      authService.resolveWechatWebCallbackRedirect.mockReturnValue(
        errAsync(stateInvalidFailure),
      );

      const mockReply = {
        redirect: vi.fn(),
      } as unknown as FastifyReply;

      await expect(
        controller.redirectWechatWebCallback(
          { code: 'wx-code', state: 'bad-state' },
          mockReply,
        ),
      ).rejects.toMatchObject({ failure: stateInvalidFailure });
      expect(mockReply.redirect).not.toHaveBeenCalled();
    });
  });

  describe('POST /auth/oauth/wechat-mobile/callback', () => {
    it('returns an auth resource', async () => {
      authService.loginWithWechatMobile.mockReturnValue(
        okAsync(mockAuthResult as never),
      );

      const result = await controller.loginWithWechatMobile(
        { code: 'wx-code' },
        mockRequest,
      );

      expect(result).toHaveProperty('user');
    });
  });

  describe('POST /auth/oauth/apple/callback', () => {
    it('returns an auth resource', async () => {
      authService.loginWithApple.mockReturnValue(
        okAsync(mockAuthResult as never),
      );

      const result = await controller.loginWithApple(
        { identityToken: 'apple-token', authorizationCode: 'code' },
        mockRequest,
      );

      expect(result).toHaveProperty('user');
    });
  });

  describe('POST /auth/oauth/qq/authorize', () => {
    it('returns the authorize URL resource', async () => {
      authService.createQqAuthorizeUrl.mockReturnValue(
        okAsync({
          authorizeUrl: 'https://qq/auth',
          state: 'state-qq',
          expiresIn: 300,
        }),
      );

      const result = await controller.createQqAuthorizeUrl();

      expect(result).toHaveProperty('authorizeUrl');
    });
  });

  describe('POST /auth/oauth/qq/callback', () => {
    it('returns an auth resource', async () => {
      authService.loginWithQq.mockReturnValue(okAsync(mockAuthResult as never));

      const result = await controller.loginWithQq(
        { code: 'qq-code', state: 'state-qq' },
        mockRequest,
      );

      expect(result).toHaveProperty('user');
    });
  });

  describe('POST /auth/oauth/weibo/authorize', () => {
    it('returns the authorize URL resource', async () => {
      authService.createWeiboAuthorizeUrl.mockReturnValue(
        okAsync({
          authorizeUrl: 'https://weibo/auth',
          state: 'state-weibo',
          expiresIn: 300,
        }),
      );

      const result = await controller.createWeiboAuthorizeUrl({
        callbackUri: 'https://app/cb',
      });

      expect(result).toHaveProperty('authorizeUrl');
    });
  });

  describe('POST /auth/oauth/weibo/callback', () => {
    it('returns an auth resource', async () => {
      authService.loginWithWeibo.mockReturnValue(
        okAsync(mockAuthResult as never),
      );

      const result = await controller.loginWithWeibo(
        { code: 'weibo-code', state: 'state-weibo' },
        mockRequest,
      );

      expect(result).toHaveProperty('user');
    });
  });

  describe('POST /auth/oauth/google/authorize', () => {
    it('returns the authorize URL resource', async () => {
      authService.createGoogleAuthorizeUrl.mockReturnValue(
        okAsync({
          authorizeUrl: 'https://google/auth',
          state: 'state-google',
          expiresIn: 300,
        }),
      );

      const result = await controller.createGoogleAuthorizeUrl({
        callbackUri: 'https://app/cb',
      });

      expect(result).toHaveProperty('authorizeUrl');
    });
  });

  describe('POST /auth/oauth/google/callback', () => {
    it('returns an auth resource', async () => {
      authService.loginWithGoogle.mockReturnValue(
        okAsync(mockAuthResult as never),
      );

      const result = await controller.loginWithGoogle(
        { code: 'google-code', state: 'state-google' },
        mockRequest,
      );

      expect(result).toHaveProperty('user');
    });
  });
});
