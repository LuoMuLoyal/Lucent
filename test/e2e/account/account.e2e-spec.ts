import request from 'supertest';
import { createHash } from 'node:crypto';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import type { Cache } from 'cache-manager';

import {
  createTestApp,
  cleanupDatabase,
  createTestUser,
  createAccessToken,
  bearer,
  expectData,
  uniqueEmail,
} from '../../helpers/e2e-helpers';
import type {
  E2eTestContext,
  E2eApp,
  TestUser,
} from '../../helpers/e2e-helpers';
import { UserStatus } from '#generated/prisma/client';
import { WechatWebOAuthProvider } from '../../../src/modules/auth';
import { WechatMobileOAuthProvider } from '../../../src/modules/auth';
import type { OAuthProfile } from '../../../src/modules/auth';
import { okAsync } from '../../../src/common/result';

const ACCOUNT_PATH = '/api/v1/account';
const SET_PASSWORD_PATH = `${ACCOUNT_PATH}/set-password`;
const WECHAT_WEB_AUTHORIZE_PATH = `${ACCOUNT_PATH}/identities/wechat-web/authorize`;
const WECHAT_WEB_CALLBACK_PATH = `${ACCOUNT_PATH}/identities/wechat-web/callback`;
const WECHAT_MOBILE_CALLBACK_PATH = `${ACCOUNT_PATH}/identities/wechat-mobile/callback`;
const SEND_VERIFICATION_CODE_PATH = '/api/v1/auth/send-verification-code';
const LOGIN_PATH = '/api/v1/auth/login';

const VERIFICATION_CODE_TTL_MS = 5 * 60 * 1000;
const TEST_PASSWORD = 'Test@123456';

interface AccountDto {
  id: string;
  email: string | null;
  nickname: string | null;
  avatar: string | null;
  emailVerifiedAt: string | null;
  hasPassword: boolean;
  lastLoginAt: string | null;
  linkedIdentities: Array<{
    id: string;
    provider: string;
    email: string | null;
    emailVerifiedAt: string | null;
    linkedAt: string;
  }>;
  createdAt: string;
  updatedAt: string;
}

describe('Account API (e2e)', () => {
  let ctx: E2eTestContext;
  let app: E2eApp;
  let user: TestUser;
  let accessToken: string;
  let cache: Cache;
  let wechatWebProvider: WechatWebOAuthProvider;
  let wechatMobileProvider: WechatMobileOAuthProvider;

  beforeAll(async () => {
    ctx = await createTestApp();
    app = ctx.app;
    await cleanupDatabase(ctx.prisma);

    user = await createTestUser(ctx.prisma, undefined, 'AccountUser');
    accessToken = await createAccessToken(
      ctx.jwtService,
      ctx.configService,
      user.id,
      user.email,
    );

    cache = app.get(CACHE_MANAGER);
    wechatWebProvider = app.get(WechatWebOAuthProvider);
    wechatMobileProvider = app.get(WechatMobileOAuthProvider);
  });

  afterAll(async () => {
    await cleanupDatabase(ctx.prisma);
    await app.close();
  });

  // ════════════════════════════════════════════════════════════
  // Existing tests: GET /account + PATCH /account
  // ════════════════════════════════════════════════════════════

  describe('GET /api/v1/account', () => {
    it('should return 401 for unauthenticated request', async () => {
      await request(app.getHttpServer()).get(ACCOUNT_PATH).expect(401);
    });

    it('should return account profile for authenticated user', async () => {
      const res = await request(app.getHttpServer())
        .get(ACCOUNT_PATH)
        .set('Authorization', bearer(accessToken))
        .expect(200);

      const data = expectData(
        res.body as {
          id: string;
          email: string;
          nickname: string;
          hasPassword: boolean;
        },
      );
      expect(data.id).toBe(user.id);
      expect(data.email).toBe(user.email);
      expect(data.nickname).toBe('AccountUser');
      expect(data.hasPassword).toBe(true);
    });
  });

  describe('PATCH /api/v1/account', () => {
    it('should update nickname successfully', async () => {
      const res = await request(app.getHttpServer())
        .patch(ACCOUNT_PATH)
        .set('Authorization', bearer(accessToken))
        .send({ nickname: 'UpdatedName' })
        .expect(200);

      const data = expectData(res.body as { nickname: string });
      expect(data.nickname).toBe('UpdatedName');
    });

    it('should normalize empty string nickname to null', async () => {
      const res = await request(app.getHttpServer())
        .patch(ACCOUNT_PATH)
        .set('Authorization', bearer(accessToken))
        .send({ nickname: '' })
        .expect(200);

      const data = expectData(res.body as { nickname: string | null });
      expect(data.nickname).toBeNull();
    });

    it('should reject unauthenticated update request', async () => {
      await request(app.getHttpServer())
        .patch(ACCOUNT_PATH)
        .send({ nickname: 'Hacker' })
        .expect(401);
    });
  });

  // ════════════════════════════════════════════════════════════
  // POST /account/set-password — Set initial password for OAuth-only users
  // ════════════════════════════════════════════════════════════

  describe('POST /account/set-password', () => {
    it('should return 401 for unauthenticated request', async () => {
      await request(app.getHttpServer())
        .post(SET_PASSWORD_PATH)
        .send({ code: '123456', password: TEST_PASSWORD })
        .expect(401);
    });

    it('should set password for an OAuth-only user (no existing password)', async () => {
      // Create an OAuth-only user (no credential account)
      const oauthEmail = uniqueEmail('oauth-setpw');
      const oauthUser = await ctx.prisma.user.create({
        data: {
          email: oauthEmail,
          nickname: 'OAuthUser',
          status: UserStatus.active,
        },
      });
      const oauthToken = await createAccessToken(
        ctx.jwtService,
        ctx.configService,
        oauthUser.id,
        oauthUser.email!,
      );

      // Seed verification code hash directly (service stores hash, not plaintext)
      const code = '123456';
      const hash = createHash('sha256')
        .update(`set-password:${oauthEmail}:${code}`)
        .digest('hex');
      await cache.set(
        `vcode:set-password:${oauthEmail}`,
        hash,
        VERIFICATION_CODE_TTL_MS,
      );

      // Set password
      await request(app.getHttpServer())
        .post(SET_PASSWORD_PATH)
        .set('Authorization', bearer(oauthToken))
        .send({ email: oauthEmail, code, password: TEST_PASSWORD })
        .expect(204);

      // Verify user can now login with the new password
      await request(app.getHttpServer())
        .post(LOGIN_PATH)
        .send({ email: oauthEmail, password: TEST_PASSWORD })
        .expect(200);

      // Verify account shows hasPassword: true
      const accountRes = await request(app.getHttpServer())
        .get(ACCOUNT_PATH)
        .set('Authorization', bearer(oauthToken))
        .expect(200);

      const accountData = expectData(accountRes.body as AccountDto);
      expect(accountData.hasPassword).toBe(true);
    });

    it('should reject set-password when user already has a password (409)', async () => {
      // The main test user has a credential account
      // Seed verification code hash (service stores hash, not plaintext)
      const code = '123456';
      const hash = createHash('sha256')
        .update(`set-password:${user.email}:${code}`)
        .digest('hex');
      await cache.set(
        `vcode:set-password:${user.email}`,
        hash,
        VERIFICATION_CODE_TTL_MS,
      );

      const res = await request(app.getHttpServer())
        .post(SET_PASSWORD_PATH)
        .set('Authorization', bearer(accessToken))
        .send({ email: user.email, code, password: TEST_PASSWORD })
        .expect(409);

      const body = res.body as Record<string, unknown>;
      expect(body['code']).toBe('RESOURCE_CONFLICT');
    });

    it('should reject set-password with non-existent verification code (400)', async () => {
      // Create another OAuth-only user
      const oauthEmail = uniqueEmail('oauth-bad-code');
      const oauthUser = await ctx.prisma.user.create({
        data: {
          email: oauthEmail,
          nickname: 'OAuthUser2',
          status: UserStatus.active,
        },
      });
      const oauthToken = await createAccessToken(
        ctx.jwtService,
        ctx.configService,
        oauthUser.id,
        oauthUser.email!,
      );

      // Don't send a verification code — the code won't exist in cache
      await request(app.getHttpServer())
        .post(SET_PASSWORD_PATH)
        .set('Authorization', bearer(oauthToken))
        .send({
          email: oauthEmail,
          code: '000000',
          password: TEST_PASSWORD,
        })
        .expect(400);
    });

    it('should reject set-password with wrong verification code (400)', async () => {
      // Create another OAuth-only user
      const oauthEmail = uniqueEmail('oauth-wrong-code');
      const oauthUser = await ctx.prisma.user.create({
        data: {
          email: oauthEmail,
          nickname: 'OAuthUser3',
          status: UserStatus.active,
        },
      });
      const oauthToken = await createAccessToken(
        ctx.jwtService,
        ctx.configService,
        oauthUser.id,
        oauthUser.email!,
      );

      // Send a verification code so one exists in cache
      await request(app.getHttpServer())
        .post(SEND_VERIFICATION_CODE_PATH)
        .send({ email: oauthEmail, scene: 'set-password' })
        .expect(200);

      // Use a wrong code
      const res = await request(app.getHttpServer())
        .post(SET_PASSWORD_PATH)
        .set('Authorization', bearer(oauthToken))
        .send({
          email: oauthEmail,
          code: '000000',
          password: TEST_PASSWORD,
        })
        .expect(400);

      const body = res.body as Record<string, unknown>;
      expect(body['code']).toBe('AUTH_VERIFICATION_CODE_MISMATCH');
    });

    it('should reject set-password with weak password (400)', async () => {
      const oauthEmail = uniqueEmail('oauth-weak-pw');
      const oauthUser = await ctx.prisma.user.create({
        data: {
          email: oauthEmail,
          nickname: 'OAuthUser4',
          status: UserStatus.active,
        },
      });
      const oauthToken = await createAccessToken(
        ctx.jwtService,
        ctx.configService,
        oauthUser.id,
        oauthUser.email!,
      );

      await request(app.getHttpServer())
        .post(SET_PASSWORD_PATH)
        .set('Authorization', bearer(oauthToken))
        .send({
          email: oauthEmail,
          code: '123456',
          password: 'weak',
        })
        .expect(400);
    });

    it('should reject set-password with missing fields (400)', async () => {
      await request(app.getHttpServer())
        .post(SET_PASSWORD_PATH)
        .set('Authorization', bearer(accessToken))
        .send({})
        .expect(400);
    });
  });

  // ════════════════════════════════════════════════════════════
  // POST /account/identities/wechat-web/authorize — Create WeChat authorize URL
  // ════════════════════════════════════════════════════════════

  describe('POST /account/identities/wechat-web/authorize', () => {
    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('should return 401 for unauthenticated request', async () => {
      await request(app.getHttpServer())
        .post(WECHAT_WEB_AUTHORIZE_PATH)
        .expect(401);
    });

    it('should return 503 when WeChat OAuth is not configured', async () => {
      // In test environment, WeChat OAuth env vars are not set
      await request(app.getHttpServer())
        .post(WECHAT_WEB_AUTHORIZE_PATH)
        .set('Authorization', bearer(accessToken))
        .expect(503);
    });

    it('should return authorize URL when WeChat OAuth is configured (mocked)', async () => {
      vi.spyOn(wechatWebProvider, 'buildAuthorizeUrl').mockReturnValue(
        'https://open.weixin.qq.com/connect/qrconnect?appid=wx123&state=mock-state',
      );

      const res = await request(app.getHttpServer())
        .post(WECHAT_WEB_AUTHORIZE_PATH)
        .set('Authorization', bearer(accessToken))
        .expect(200);

      const data = expectData(
        res.body as {
          authorizeUrl: string;
          state: string;
          expiresIn: number;
        },
      );
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
        .post(WECHAT_WEB_AUTHORIZE_PATH)
        .set('Authorization', bearer(accessToken))
        .send({ callbackUri })
        .expect(200);

      const data = expectData(
        res.body as {
          authorizeUrl: string;
          state: string;
          expiresIn: number;
          callbackUri?: string;
        },
      );
      expect(data.callbackUri).toBe(callbackUri);
    });
  });

  // ════════════════════════════════════════════════════════════
  // POST /account/identities/wechat-web/callback — Link WeChat web identity
  // ════════════════════════════════════════════════════════════

  describe('POST /account/identities/wechat-web/callback', () => {
    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('should return 401 for unauthenticated request', async () => {
      await request(app.getHttpServer())
        .post(WECHAT_WEB_CALLBACK_PATH)
        .send({ code: 'test-code', state: 'test-state' })
        .expect(401);
    });

    it('should reject missing code with 400', async () => {
      await request(app.getHttpServer())
        .post(WECHAT_WEB_CALLBACK_PATH)
        .set('Authorization', bearer(accessToken))
        .send({ state: 'test-state' })
        .expect(400);
    });

    it('should reject missing state with 400', async () => {
      await request(app.getHttpServer())
        .post(WECHAT_WEB_CALLBACK_PATH)
        .set('Authorization', bearer(accessToken))
        .send({ code: 'test-code' })
        .expect(400);
    });

    it('should reject empty body with 400', async () => {
      await request(app.getHttpServer())
        .post(WECHAT_WEB_CALLBACK_PATH)
        .set('Authorization', bearer(accessToken))
        .send({})
        .expect(400);
    });

    it('should reject with 400 for invalid state', async () => {
      const res = await request(app.getHttpServer())
        .post(WECHAT_WEB_CALLBACK_PATH)
        .set('Authorization', bearer(accessToken))
        .send({ code: 'test-code', state: 'non-existent-state' })
        .expect(400);

      const body = res.body as Record<string, unknown>;
      expect(body['code']).toBe('AUTH_OAUTH_STATE_INVALID');
    });

    it('should link WeChat web identity with valid state and code', async () => {
      // Mock buildAuthorizeUrl so authorize endpoint creates a valid state
      vi.spyOn(wechatWebProvider, 'buildAuthorizeUrl').mockReturnValue(
        'https://open.weixin.qq.com/connect/qrconnect',
      );

      // Mock fetchProfile to return a fake WeChat profile
      const mockProfile: OAuthProfile = {
        provider: 'wechat_web',
        providerUserId: 'wx-openid-web-link',
        unionId: 'wx-union-web-link',
        nickname: 'WeChat Web User',
        avatar: 'https://wx.qlogo.cn/web-avatar',
      };
      vi.spyOn(wechatWebProvider, 'fetchProfile').mockReturnValue(
        okAsync(mockProfile),
      );

      // Create a fresh user for this test
      const linkEmail = uniqueEmail('wx-web-link');
      const linkUser = await ctx.prisma.user.create({
        data: {
          email: linkEmail,
          nickname: 'WxWebLinkUser',
          status: UserStatus.active,
        },
      });
      const linkToken = await createAccessToken(
        ctx.jwtService,
        ctx.configService,
        linkUser.id,
        linkUser.email!,
      );

      // Step 1: Get a valid state from the authorize endpoint
      const authorizeRes = await request(app.getHttpServer())
        .post(WECHAT_WEB_AUTHORIZE_PATH)
        .set('Authorization', bearer(linkToken))
        .expect(200);
      const { state } = expectData(authorizeRes.body as { state: string });

      // Step 2: Call the callback with the state and a code
      const res = await request(app.getHttpServer())
        .post(WECHAT_WEB_CALLBACK_PATH)
        .set('Authorization', bearer(linkToken))
        .send({ code: 'mock-wechat-code', state })
        .expect(200);

      // Step 3: Verify the identity is linked in the account response
      const accountData = expectData(res.body as AccountDto);
      expect(accountData.linkedIdentities).toHaveLength(1);
      expect(accountData.linkedIdentities[0]!.provider).toBe('wechat_web');
      expect(accountData.linkedIdentities[0]!.id).toBeTruthy();
    });
  });

  // ════════════════════════════════════════════════════════════
  // POST /account/identities/wechat-mobile/callback — Link WeChat mobile identity
  // ════════════════════════════════════════════════════════════

  describe('POST /account/identities/wechat-mobile/callback', () => {
    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('should return 401 for unauthenticated request', async () => {
      await request(app.getHttpServer())
        .post(WECHAT_MOBILE_CALLBACK_PATH)
        .send({ code: 'test-code' })
        .expect(401);
    });

    it('should reject missing code with 400', async () => {
      await request(app.getHttpServer())
        .post(WECHAT_MOBILE_CALLBACK_PATH)
        .set('Authorization', bearer(accessToken))
        .send({})
        .expect(400);
    });

    it('should return 503 when WeChat mobile OAuth is not configured', async () => {
      // Don't mock fetchProfile — real provider calls getConfig() → 503
      await request(app.getHttpServer())
        .post(WECHAT_MOBILE_CALLBACK_PATH)
        .set('Authorization', bearer(accessToken))
        .send({ code: 'test-code' })
        .expect(503);
    });

    it('should link WeChat mobile identity with valid code', async () => {
      // Mock fetchProfile to return a fake WeChat mobile profile
      const mockProfile: OAuthProfile = {
        provider: 'wechat_mobile',
        providerUserId: 'wx-openid-mobile-link',
        unionId: 'wx-union-mobile-link',
        nickname: 'WeChat Mobile User',
        avatar: 'https://wx.qlogo.cn/mobile-avatar',
      };
      vi.spyOn(wechatMobileProvider, 'fetchProfile').mockReturnValue(
        okAsync(mockProfile),
      );

      // Create a fresh user for this test
      const linkEmail = uniqueEmail('wx-mobile-link');
      const linkUser = await ctx.prisma.user.create({
        data: {
          email: linkEmail,
          nickname: 'WxMobileLinkUser',
          status: UserStatus.active,
        },
      });
      const linkToken = await createAccessToken(
        ctx.jwtService,
        ctx.configService,
        linkUser.id,
        linkUser.email!,
      );

      const res = await request(app.getHttpServer())
        .post(WECHAT_MOBILE_CALLBACK_PATH)
        .set('Authorization', bearer(linkToken))
        .send({ code: 'mock-wechat-mobile-code' })
        .expect(200);

      // Verify the identity is linked in the account response
      const accountData = expectData(res.body as AccountDto);
      expect(accountData.linkedIdentities).toHaveLength(1);
      expect(accountData.linkedIdentities[0]!.provider).toBe('wechat_mobile');
    });
  });
});
