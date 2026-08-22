import request from 'supertest';

import {
  createTestApp,
  cleanupDatabase,
  expectData,
  uniqueEmail,
} from '../../helpers/e2e-helpers';
import type { E2eTestContext, E2eApp } from '../../helpers/e2e-helpers';
import { WechatWebOAuthProvider } from '../../../src/modules/auth';
import { WechatMobileOAuthProvider } from '../../../src/modules/auth';
import { AppleOAuthProvider } from '../../../src/modules/auth';
import { QqOAuthProvider } from '../../../src/modules/auth';
import type { OAuthProfile } from '../../../src/modules/auth';

// ── Constants ─────────────────────────────────────────────────

const OAUTH_PATH = {
  wechatWebAuthorize: '/api/v1/auth/oauth/wechat-web/authorize',
  wechatWebCallbackPost: '/api/v1/auth/oauth/wechat-web/callback',
  wechatWebCallbackGet: '/api/v1/auth/oauth/wechat-web/callback',
  wechatMobileCallback: '/api/v1/auth/oauth/wechat-mobile/callback',
  appleCallback: '/api/v1/auth/oauth/apple/callback',
  qqAuthorize: '/api/v1/auth/oauth/qq/authorize',
  qqCallback: '/api/v1/auth/oauth/qq/callback',
} as const;

interface AuthorizeResult {
  authorizeUrl: string;
  state: string;
  expiresIn: number;
  callbackUri?: string;
}

interface AuthResponseData {
  user: {
    id: string;
    email: string;
    nickname: string | null;
    avatar: string | null;
    emailVerified: boolean;
    emailVerifiedAt: string | null;
    createdAt: string;
    updatedAt: string;
  };
  tokens: {
    accessToken: string;
    refreshToken: string;
    expiresIn: number;
  };
}

// ── Test Suite ────────────────────────────────────────────────

describe('OAuth API (e2e)', () => {
  let ctx: E2eTestContext;
  let app: E2eApp;
  let wechatWebProvider: WechatWebOAuthProvider;
  let wechatMobileProvider: WechatMobileOAuthProvider;
  let appleProvider: AppleOAuthProvider;
  let qqProvider: QqOAuthProvider;

  beforeAll(async () => {
    ctx = await createTestApp();
    app = ctx.app;
    await cleanupDatabase(ctx.prisma);

    wechatWebProvider = app.get(WechatWebOAuthProvider);
    wechatMobileProvider = app.get(WechatMobileOAuthProvider);
    appleProvider = app.get(AppleOAuthProvider);
    qqProvider = app.get(QqOAuthProvider);
  });

  afterAll(async () => {
    await cleanupDatabase(ctx.prisma);
    await app.close();
  });

  // ════════════════════════════════════════════════════════════
  // 1. POST /api/v1/auth/oauth/wechat-web/authorize
  // ════════════════════════════════════════════════════════════

  describe('POST /api/v1/auth/oauth/wechat-web/authorize', () => {
    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('should return 503 when WeChat OAuth is not configured', async () => {
      await request(app.getHttpServer())
        .post(OAUTH_PATH.wechatWebAuthorize)
        .expect(503);
    });

    it('should return authorize URL with state when configured (mocked)', async () => {
      vi.spyOn(wechatWebProvider, 'buildAuthorizeUrl').mockReturnValue(
        'https://open.weixin.qq.com/connect/qrconnect?appid=wx123&state=mock-state',
      );

      const res = await request(app.getHttpServer())
        .post(OAUTH_PATH.wechatWebAuthorize)
        .expect(200);

      const data = expectData(res.body as AuthorizeResult);
      expect(data.authorizeUrl).toContain('open.weixin.qq.com');
      expect(data.state).toBeTruthy();
      expect(data.expiresIn).toBeGreaterThan(0);
    });

    it('should include callbackUri in response when provided', async () => {
      vi.spyOn(wechatWebProvider, 'buildAuthorizeUrl').mockReturnValue(
        'https://open.weixin.qq.com/connect/qrconnect',
      );

      const callbackUri = 'http://localhost:3000/login/oauth/wechat';
      const res = await request(app.getHttpServer())
        .post(OAUTH_PATH.wechatWebAuthorize)
        .send({ callbackUri })
        .expect(200);

      const data = expectData(res.body as AuthorizeResult);
      expect(data.callbackUri).toBe(callbackUri);
    });
  });

  // ════════════════════════════════════════════════════════════
  // 2. POST /api/v1/auth/oauth/wechat-web/callback
  // ════════════════════════════════════════════════════════════

  describe('POST /api/v1/auth/oauth/wechat-web/callback', () => {
    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('should reject missing code with 400', async () => {
      await request(app.getHttpServer())
        .post(OAUTH_PATH.wechatWebCallbackPost)
        .send({ state: 'test-state' })
        .expect(400);
    });

    it('should reject missing state with 400', async () => {
      await request(app.getHttpServer())
        .post(OAUTH_PATH.wechatWebCallbackPost)
        .send({ code: 'test-code' })
        .expect(400);
    });

    it('should reject empty body with 400', async () => {
      await request(app.getHttpServer())
        .post(OAUTH_PATH.wechatWebCallbackPost)
        .send({})
        .expect(400);
    });

    it('should reject invalid state with 401', async () => {
      await request(app.getHttpServer())
        .post(OAUTH_PATH.wechatWebCallbackPost)
        .send({ code: 'test-code', state: 'non-existent-state' })
        .expect(401);
    });

    it('should create new user and return tokens with valid state and code', async () => {
      vi.spyOn(wechatWebProvider, 'buildAuthorizeUrl').mockReturnValue(
        'https://open.weixin.qq.com/connect/qrconnect',
      );

      const mockProfile: OAuthProfile = {
        provider: 'wechat_web',
        providerUserId: `wx-openid-${Date.now()}`,
        unionId: `wx-union-${Date.now()}`,
        nickname: 'WeChat Login User',
        avatar: 'https://wx.qlogo.cn/login-avatar',
      };
      vi.spyOn(wechatWebProvider, 'fetchProfile').mockResolvedValue(
        mockProfile,
      );

      // Step 1: Get a valid state from the authorize endpoint
      const authorizeRes = await request(app.getHttpServer())
        .post(OAUTH_PATH.wechatWebAuthorize)
        .expect(200);
      const { state } = expectData(authorizeRes.body as AuthorizeResult);

      // Step 2: Call the callback with the state and a code
      const res = await request(app.getHttpServer())
        .post(OAUTH_PATH.wechatWebCallbackPost)
        .send({ code: 'mock-wechat-code', state })
        .expect(200);

      const data = expectData(res.body as AuthResponseData);
      expect(data.user.id).toBeDefined();
      expect(data.user.nickname).toBe('WeChat Login User');
      expect(data.user.avatar).toBe('https://wx.qlogo.cn/login-avatar');
      expect(data.tokens.accessToken).toBeDefined();
      expect(data.tokens.refreshToken).toBeDefined();
      expect(data.tokens.expiresIn).toBeGreaterThan(0);
    });

    it('should login existing OAuth user with valid state and code', async () => {
      vi.spyOn(wechatWebProvider, 'buildAuthorizeUrl').mockReturnValue(
        'https://open.weixin.qq.com/connect/qrconnect',
      );

      // First, register a user via OAuth to create the identity
      const firstProfile: OAuthProfile = {
        provider: 'wechat_web',
        providerUserId: `wx-openid-returning-${Date.now()}`,
        unionId: `wx-union-returning-${Date.now()}`,
        nickname: 'Returning WeChat User',
        avatar: 'https://wx.qlogo.cn/returning-avatar',
      };
      vi.spyOn(wechatWebProvider, 'fetchProfile').mockResolvedValue(
        firstProfile,
      );

      const authorizeRes1 = await request(app.getHttpServer())
        .post(OAUTH_PATH.wechatWebAuthorize)
        .expect(200);
      const state1 = expectData(authorizeRes1.body as AuthorizeResult).state;

      const loginRes1 = await request(app.getHttpServer())
        .post(OAUTH_PATH.wechatWebCallbackPost)
        .send({ code: 'mock-wechat-code-1', state: state1 })
        .expect(200);
      const firstData = expectData(loginRes1.body as AuthResponseData);
      const userId = firstData.user.id;

      // Second login with same profile should return same user
      const authorizeRes2 = await request(app.getHttpServer())
        .post(OAUTH_PATH.wechatWebAuthorize)
        .expect(200);
      const state2 = expectData(authorizeRes2.body as AuthorizeResult).state;

      const loginRes2 = await request(app.getHttpServer())
        .post(OAUTH_PATH.wechatWebCallbackPost)
        .send({ code: 'mock-wechat-code-2', state: state2 })
        .expect(200);

      const secondData = expectData(loginRes2.body as AuthResponseData);
      expect(secondData.user.id).toBe(userId);
    });
  });

  // ════════════════════════════════════════════════════════════
  // 3. GET /api/v1/auth/oauth/wechat-web/callback
  // ════════════════════════════════════════════════════════════

  describe('GET /api/v1/auth/oauth/wechat-web/callback', () => {
    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('should reject invalid state with 401', async () => {
      await request(app.getHttpServer())
        .get(OAUTH_PATH.wechatWebCallbackGet)
        .query({ code: 'test-code', state: 'non-existent-state' })
        .expect(401);
    });

    it('should redirect to callback URI with code and state (302)', async () => {
      vi.spyOn(wechatWebProvider, 'buildAuthorizeUrl').mockReturnValue(
        'https://open.weixin.qq.com/connect/qrconnect',
      );

      const callbackUri = 'http://localhost:3000/login/oauth/wechat';

      // Step 1: Get a valid state from the authorize endpoint with a callbackUri
      const authorizeRes = await request(app.getHttpServer())
        .post(OAUTH_PATH.wechatWebAuthorize)
        .send({ callbackUri })
        .expect(200);
      const { state } = expectData(authorizeRes.body as AuthorizeResult);

      // Step 2: Call the GET callback with code and state
      const res = await request(app.getHttpServer())
        .get(OAUTH_PATH.wechatWebCallbackGet)
        .query({ code: 'auth-code-from-wechat', state })
        .expect(302);

      expect(res.header['location']).toContain(callbackUri);
      expect(res.header['location']).toContain('code=auth-code-from-wechat');
      expect(res.header['location']).toContain(`state=${state}`);
    });
  });

  // ════════════════════════════════════════════════════════════
  // 4. POST /api/v1/auth/oauth/wechat-mobile/callback
  // ════════════════════════════════════════════════════════════

  describe('POST /api/v1/auth/oauth/wechat-mobile/callback', () => {
    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('should reject missing code with 400', async () => {
      await request(app.getHttpServer())
        .post(OAUTH_PATH.wechatMobileCallback)
        .send({})
        .expect(400);
    });

    it('should return 503 when WeChat mobile OAuth is not configured', async () => {
      await request(app.getHttpServer())
        .post(OAUTH_PATH.wechatMobileCallback)
        .send({ code: 'test-code' })
        .expect(503);
    });

    it('should create new user and return tokens with valid code (mocked)', async () => {
      const mockProfile: OAuthProfile = {
        provider: 'wechat_mobile',
        providerUserId: `wx-mobile-openid-${Date.now()}`,
        unionId: `wx-mobile-union-${Date.now()}`,
        nickname: 'WeChat Mobile User',
        avatar: 'https://wx.qlogo.cn/mobile-avatar',
      };
      vi.spyOn(wechatMobileProvider, 'fetchProfile').mockResolvedValue(
        mockProfile,
      );

      const res = await request(app.getHttpServer())
        .post(OAUTH_PATH.wechatMobileCallback)
        .send({ code: 'mock-wechat-mobile-code' })
        .expect(200);

      const data = expectData(res.body as AuthResponseData);
      expect(data.user.id).toBeDefined();
      expect(data.user.nickname).toBe('WeChat Mobile User');
      expect(data.tokens.accessToken).toBeDefined();
      expect(data.tokens.refreshToken).toBeDefined();
    });
  });

  // ════════════════════════════════════════════════════════════
  // 5. POST /api/v1/auth/oauth/apple/callback
  // ════════════════════════════════════════════════════════════

  describe('POST /api/v1/auth/oauth/apple/callback', () => {
    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('should reject missing identityToken with 400', async () => {
      await request(app.getHttpServer())
        .post(OAUTH_PATH.appleCallback)
        .send({})
        .expect(400);
    });

    it('should create new user and return tokens with valid identityToken (mocked)', async () => {
      const mockProfile: OAuthProfile = {
        provider: 'apple',
        providerUserId: `apple-sub-${Date.now()}`,
        email: uniqueEmail('apple'),
        emailVerifiedAt: new Date(),
        nickname: 'Apple User',
      };
      vi.spyOn(appleProvider, 'fetchProfile').mockResolvedValue(mockProfile);

      const res = await request(app.getHttpServer())
        .post(OAUTH_PATH.appleCallback)
        .send({
          identityToken: 'mock-apple-identity-token',
          givenName: 'Apple',
          familyName: 'User',
        })
        .expect(200);

      const data = expectData(res.body as AuthResponseData);
      expect(data.user.id).toBeDefined();
      expect(data.user.email).toBe(mockProfile.email);
      expect(data.user.emailVerified).toBe(true);
      expect(data.tokens.accessToken).toBeDefined();
      expect(data.tokens.refreshToken).toBeDefined();
    });

    it('should login existing Apple user on second callback (mocked)', async () => {
      const appleSub = `apple-sub-returning-${Date.now()}`;
      const profile: OAuthProfile = {
        provider: 'apple',
        providerUserId: appleSub,
        email: uniqueEmail('apple-return'),
        emailVerifiedAt: new Date(),
        nickname: 'Apple Return User',
      };
      vi.spyOn(appleProvider, 'fetchProfile').mockResolvedValue(profile);

      const res1 = await request(app.getHttpServer())
        .post(OAUTH_PATH.appleCallback)
        .send({ identityToken: 'mock-token-1' })
        .expect(200);
      const data1 = expectData(res1.body as AuthResponseData);

      // Second login — Apple returns no name after first login
      const profileNoName: OAuthProfile = {
        provider: 'apple',
        providerUserId: appleSub,
        email: profile.email ?? null,
        emailVerifiedAt: new Date(),
        nickname: null,
      };
      vi.spyOn(appleProvider, 'fetchProfile').mockResolvedValue(profileNoName);

      const res2 = await request(app.getHttpServer())
        .post(OAUTH_PATH.appleCallback)
        .send({ identityToken: 'mock-token-2' })
        .expect(200);
      const data2 = expectData(res2.body as AuthResponseData);

      expect(data2.user.id).toBe(data1.user.id);
    });
  });

  // ════════════════════════════════════════════════════════════
  // 6. POST /api/v1/auth/oauth/qq/authorize
  // ════════════════════════════════════════════════════════════

  describe('POST /api/v1/auth/oauth/qq/authorize', () => {
    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('should return 503 when QQ OAuth is not configured', async () => {
      await request(app.getHttpServer())
        .post(OAUTH_PATH.qqAuthorize)
        .expect(503);
    });

    it('should return authorize URL with state when configured (mocked)', async () => {
      vi.spyOn(qqProvider, 'buildAuthorizeUrl').mockReturnValue(
        'https://graph.qq.com/oauth2.0/authorize?client_id=qq123',
      );

      const res = await request(app.getHttpServer())
        .post(OAUTH_PATH.qqAuthorize)
        .expect(200);

      const data = expectData(res.body as AuthorizeResult);
      expect(data.authorizeUrl).toContain('graph.qq.com');
      expect(data.state).toBeTruthy();
      expect(data.expiresIn).toBeGreaterThan(0);
    });

    it('should include callbackUri in response when provided', async () => {
      vi.spyOn(qqProvider, 'buildAuthorizeUrl').mockReturnValue(
        'https://graph.qq.com/oauth2.0/authorize',
      );

      const callbackUri = 'http://localhost:3000/login/oauth/qq';
      const res = await request(app.getHttpServer())
        .post(OAUTH_PATH.qqAuthorize)
        .send({ callbackUri })
        .expect(200);

      const data = expectData(res.body as AuthorizeResult);
      expect(data.callbackUri).toBe(callbackUri);
    });
  });

  // ════════════════════════════════════════════════════════════
  // 7. POST /api/v1/auth/oauth/qq/callback
  // ════════════════════════════════════════════════════════════

  describe('POST /api/v1/auth/oauth/qq/callback', () => {
    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('should reject missing code with 400', async () => {
      await request(app.getHttpServer())
        .post(OAUTH_PATH.qqCallback)
        .send({ state: 'test-state' })
        .expect(400);
    });

    it('should reject missing state with 400', async () => {
      await request(app.getHttpServer())
        .post(OAUTH_PATH.qqCallback)
        .send({ code: 'test-code' })
        .expect(400);
    });

    it('should reject empty body with 400', async () => {
      await request(app.getHttpServer())
        .post(OAUTH_PATH.qqCallback)
        .send({})
        .expect(400);
    });

    it('should reject invalid state with 401', async () => {
      await request(app.getHttpServer())
        .post(OAUTH_PATH.qqCallback)
        .send({ code: 'test-code', state: 'non-existent-state' })
        .expect(401);
    });

    it('should create new user and return tokens with valid state and code', async () => {
      vi.spyOn(qqProvider, 'buildAuthorizeUrl').mockReturnValue(
        'https://graph.qq.com/oauth2.0/authorize',
      );

      const mockProfile: OAuthProfile = {
        provider: 'qq',
        providerUserId: `qq-openid-${Date.now()}`,
        nickname: 'QQ Login User',
        avatar: 'https://q.qlogo.cn/qq-avatar',
      };
      vi.spyOn(qqProvider, 'fetchProfile').mockResolvedValue(mockProfile);

      // Step 1: Get a valid state from the authorize endpoint
      const authorizeRes = await request(app.getHttpServer())
        .post(OAUTH_PATH.qqAuthorize)
        .expect(200);
      const { state } = expectData(authorizeRes.body as AuthorizeResult);

      // Step 2: Call the callback with the state and a code
      const res = await request(app.getHttpServer())
        .post(OAUTH_PATH.qqCallback)
        .send({ code: 'mock-qq-code', state })
        .expect(200);

      const data = expectData(res.body as AuthResponseData);
      expect(data.user.id).toBeDefined();
      expect(data.user.nickname).toBe('QQ Login User');
      expect(data.tokens.accessToken).toBeDefined();
      expect(data.tokens.refreshToken).toBeDefined();
    });
  });
});
