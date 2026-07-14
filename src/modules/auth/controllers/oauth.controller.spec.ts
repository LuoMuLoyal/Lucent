import { Test, type TestingModule } from '@nestjs/testing';
import { ResultCode } from '../../../common/api';
import type { Request, Response } from 'express';
import { OAuthController } from './oauth.controller';
import { AuthService } from '../services/auth.service';

const mockRequest = {
  headers: { 'user-agent': 'test-agent' },
  ip: '127.0.0.1',
  socket: { remoteAddress: '127.0.0.1' },
} as unknown as Request;

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

      const mockResponse = {
        redirect: vi.fn(),
      } as unknown as Response;

      await controller.redirectWechatWebCallback(
        { code: 'wx-code', state: 'state-123' },
        mockResponse,
      );

      expect(mockResponse.redirect).toHaveBeenCalledWith(
        302,
        'https://app/cb?code=wx-code&state=state-123',
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
});
