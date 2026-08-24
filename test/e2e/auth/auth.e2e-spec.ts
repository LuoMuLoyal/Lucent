import { CACHE_MANAGER } from '@nestjs/cache-manager';
import type { Cache } from 'cache-manager';
import request from 'supertest';
import { createHash } from 'node:crypto';

import { DEFAULT_VERIFICATION_RATE_LIMIT_MAX } from '../../../src/config/constants';
import {
  createTestApp,
  cleanupDatabase,
  bearer,
  expectData,
  uniqueEmail,
} from '../../helpers/e2e-helpers';
import type { E2eTestContext, E2eApp } from '../../helpers/e2e-helpers';

// ── Types ─────────────────────────────────────────────────────

interface UserDto {
  id: string;
  email: string;
  nickname: string | null;
  avatar?: string | null;
  emailVerified: boolean;
  createdAt: string;
  updatedAt?: string;
}

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

interface TokensDto {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

interface RegisterLoginData {
  user: UserDto;
  tokens: TokensDto;
}

// ── Constants ─────────────────────────────────────────────────

const AUTH_PATH = {
  register: '/api/v1/auth/register',
  login: '/api/v1/auth/login',
  logout: '/api/v1/auth/logout',
  refresh: '/api/v1/auth/refresh',
  sendVerificationCode: '/api/v1/auth/send-verification-code',
  verifyEmail: '/api/v1/auth/verify-email',
  forgotPassword: '/api/v1/auth/forgot-password',
  resetPassword: '/api/v1/auth/reset-password',
  account: '/api/v1/account',
  accountPassword: '/api/v1/account/password',
  accountEmail: '/api/v1/account/email',
} as const;

const AUTH_SCENE = {
  register: 'register',
  login: 'login',
  changeEmail: 'change-email',
} as const;

type AuthScene = (typeof AUTH_SCENE)[keyof typeof AUTH_SCENE];

const TEST_EMAIL_DOMAIN = 'example.com';
const TEST_PASSWORD = 'Test@123456';
const WRONG_LOGIN_PASSWORD = 'WrongPassword123!';
const WRONG_OLD_PASSWORD = 'WrongOldPass1!';
const WRONG_DELETE_PASSWORD = 'WrongPassword!';
const RESET_PASSWORD = 'NewSecure@Pass1';
const CHANGED_PASSWORD = 'NewSecure@Pass2';
const REJECTED_NEW_PASSWORD = 'NewSecure@Pass3';
const DEFAULT_VERIFICATION_CODE = '123456';
const INVALID_VERIFICATION_CODE = '000000';
const TEST_USER_NICKNAME = 'TestUser';
const NEW_USER_NICKNAME = 'NewUser';
const UPDATED_NICKNAME = 'UpdatedNick';
const UNAUTHENTICATED_NICKNAME = 'Hacker';
const UPDATED_AVATAR_URL = `https://${TEST_EMAIL_DOMAIN}/avatar.png`;
const FAKE_REFRESH_TOKEN = 'fake-token';
const UNKNOWN_REFRESH_TOKEN = 'non-existent-token';
const UNKNOWN_LOGIN_EMAIL = `nonexistent@${TEST_EMAIL_DOMAIN}`;
const UNKNOWN_RESET_EMAIL = `nobody@${TEST_EMAIL_DOMAIN}`;
const INVALID_EMAIL = 'not-an-email';
const AUTHORIZATION_HEADER = 'Authorization';
const VERIFICATION_CODE_TTL_MS = 5 * 60 * 1000;
const VERIFICATION_CODE_COOLDOWN_SECONDS = 60;

let clientIpSeq = 0;
const clientIpSeed = (Date.now() ^ process.pid) >>> 0;
function uniqueClientIp(): string {
  clientIpSeq += 1;
  const thirdOctet = ((clientIpSeed + Math.floor(clientIpSeq / 250)) % 250) + 1;
  const fourthOctet = ((clientIpSeed + clientIpSeq) % 250) + 1;
  return `198.51.${String(thirdOctet)}.${String(fourthOctet)}`;
}

function hashRefreshToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

// ── Test Suite ───────────────────────────────────────────────

describe('Auth API (e2e)', () => {
  let ctx: E2eTestContext;
  let app: E2eApp;
  let cache: Cache;

  beforeAll(async () => {
    ctx = await createTestApp();
    app = ctx.app;
    await cleanupDatabase(ctx.prisma);

    cache = app.get(CACHE_MANAGER);
  });

  afterAll(async () => {
    await cleanupDatabase(ctx.prisma);
    await app.close();
  });

  // ────────────────────────────────────────────────────────────
  // Helper: register a user and return tokens + user info
  // ────────────────────────────────────────────────────────────

  async function registerUser(email?: string) {
    const userEmail = email ?? uniqueEmail('auth');
    const code = await issueVerificationCode(AUTH_SCENE.register, userEmail);
    const res = await request(app.getHttpServer())
      .post(AUTH_PATH.register)
      .send({
        email: userEmail,
        password: TEST_PASSWORD,
        code,
        nickname: TEST_USER_NICKNAME,
      })
      .expect(201);

    const body = res.body as RegisterLoginData;
    const data = expectData(body);
    return { email: userEmail, ...data };
  }

  async function issueVerificationCode(
    scene: AuthScene,
    email: string,
  ): Promise<string> {
    return seedVerificationCode(scene, email);
  }

  async function forgotPasswordRequest(
    email: string,
    clientIp = uniqueClientIp(),
  ) {
    return request(app.getHttpServer())
      .post(AUTH_PATH.forgotPassword)
      .set('x-forwarded-for', clientIp)
      .send({ email })
      .expect(200);
  }

  async function seedVerificationCode(
    scene: AuthScene,
    email: string,
    code = DEFAULT_VERIFICATION_CODE,
  ): Promise<string> {
    // The verification service stores a SHA-256 hash (not plaintext) in cache.
    // We replicate that here so verify() can match correctly.
    const hash = createHash('sha256')
      .update(`${scene}:${email}:${code}`)
      .digest('hex');
    await cache.set(`vcode:${scene}:${email}`, hash, VERIFICATION_CODE_TTL_MS);
    return code;
  }

  // ════════════════════════════════════════════════════════════
  // 1. POST /api/v1/auth/register
  // ════════════════════════════════════════════════════════════

  describe('POST /api/v1/auth/register', () => {
    it('should register a new user successfully', async () => {
      const email = uniqueEmail('auth');
      const code = await issueVerificationCode(AUTH_SCENE.register, email);
      const res = await request(app.getHttpServer())
        .post(AUTH_PATH.register)
        .send({
          email,
          password: TEST_PASSWORD,
          code,
          nickname: NEW_USER_NICKNAME,
        })
        .expect(201);

      const body = res.body as RegisterLoginData;
      const data = expectData(body);
      expect(data.user.email).toBe(email);
      expect(data.user.nickname).toBe(NEW_USER_NICKNAME);
      expect(data.user.emailVerified).toBe(true);
      expect(data.user.id).toBeDefined();
      expect(data.user.createdAt).toBeDefined();
      expect(data.tokens.accessToken).toBeDefined();
      expect(data.tokens.refreshToken).toBeDefined();
      expect(data.tokens.expiresIn).toBeGreaterThan(0);
    });

    it('should reject duplicate email', async () => {
      const email = uniqueEmail('auth');
      await registerUser(email);

      const res = await request(app.getHttpServer())
        .post(AUTH_PATH.register)
        .send({
          email,
          password: TEST_PASSWORD,
          code: DEFAULT_VERIFICATION_CODE,
        })
        .expect(409);

      const body = res.body as Record<string, unknown>;
      expect(body['code']).toBe('CONFLICT');
    });

    it('should reject invalid email format', async () => {
      await request(app.getHttpServer())
        .post(AUTH_PATH.register)
        .send({ email: INVALID_EMAIL, password: TEST_PASSWORD })
        .expect(400);
    });

    it('should reject missing password', async () => {
      const res = await request(app.getHttpServer())
        .post(AUTH_PATH.register)
        .send({ email: uniqueEmail('auth') })
        .expect(400);

      const body = res.body as Record<string, unknown>;
      expect(body['code']).toBe('VALIDATION_FAILED');
    });
  });

  // ════════════════════════════════════════════════════════════
  // 2. POST /api/v1/auth/login
  // ════════════════════════════════════════════════════════════

  describe('POST /api/v1/auth/login', () => {
    it('should login with correct password', async () => {
      const { email } = await registerUser();
      const clientIp = uniqueClientIp();
      const userAgent = 'LuminousE2E/1.0';

      const res = await request(app.getHttpServer())
        .post(AUTH_PATH.login)
        .set('x-forwarded-for', clientIp)
        .set('user-agent', userAgent)
        .send({ email, password: TEST_PASSWORD })
        .expect(200);

      const body = res.body as RegisterLoginData;
      const data = expectData(body);
      expect(data.user.email).toBe(email);
      expect(data.tokens.accessToken).toBeDefined();

      const session = await ctx.prisma.userSession.findUnique({
        where: {
          refreshTokenHash: hashRefreshToken(data.tokens.refreshToken),
        },
      });
      expect(session?.ipAddress).toBe(clientIp);
      expect(session?.userAgent).toBe(userAgent);
    });

    it('should reject wrong password', async () => {
      const { email } = await registerUser();

      const res = await request(app.getHttpServer())
        .post(AUTH_PATH.login)
        .send({ email, password: WRONG_LOGIN_PASSWORD })
        .expect(401);

      const body = res.body as Record<string, unknown>;
      expect(body['code']).toBe('AUTH_REQUIRED');
    });

    it('should reject non-existent email', async () => {
      const res = await request(app.getHttpServer())
        .post(AUTH_PATH.login)
        .send({ email: UNKNOWN_LOGIN_EMAIL, password: TEST_PASSWORD })
        .expect(401);

      const body = res.body as Record<string, unknown>;
      expect(body['code']).toBe('AUTH_REQUIRED');
    });

    it('should login with verification code', async () => {
      const { email } = await registerUser();

      const code = await seedVerificationCode(AUTH_SCENE.login, email);

      const res = await request(app.getHttpServer())
        .post(AUTH_PATH.login)
        .send({ email, code })
        .expect(200);

      const body = res.body as RegisterLoginData;
      const data = expectData(body);
      expect(data.user.email).toBe(email);
    });
  });

  // ════════════════════════════════════════════════════════════
  // 3. POST /api/v1/auth/logout
  // ════════════════════════════════════════════════════════════

  describe('POST /api/v1/auth/logout', () => {
    it('should logout and invalidate refresh token', async () => {
      const { tokens } = await registerUser();

      await request(app.getHttpServer())
        .post(AUTH_PATH.logout)
        .set(AUTHORIZATION_HEADER, bearer(tokens.accessToken))
        .send({ refreshToken: tokens.refreshToken })
        .expect(200);

      const res = await request(app.getHttpServer())
        .post(AUTH_PATH.refresh)
        .send({ refreshToken: tokens.refreshToken })
        .expect(401);

      const body = res.body as Record<string, unknown>;
      expect(body['code']).toBe('AUTH_REFRESH_TOKEN_INVALID');
    });

    it('should reject logout without auth token', async () => {
      await request(app.getHttpServer())
        .post(AUTH_PATH.logout)
        .send({ refreshToken: FAKE_REFRESH_TOKEN })
        .expect(401);
    });

    it('should not invalidate another user session with a foreign refresh token', async () => {
      const firstUser = await registerUser();
      const secondUser = await registerUser();

      await request(app.getHttpServer())
        .post(AUTH_PATH.logout)
        .set(AUTHORIZATION_HEADER, bearer(firstUser.tokens.accessToken))
        .send({ refreshToken: secondUser.tokens.refreshToken })
        .expect(200);

      await request(app.getHttpServer())
        .post(AUTH_PATH.refresh)
        .send({ refreshToken: secondUser.tokens.refreshToken })
        .expect(200);
    });
  });

  // ════════════════════════════════════════════════════════════
  // 4. POST /api/v1/auth/refresh
  // ════════════════════════════════════════════════════════════

  describe('POST /api/v1/auth/refresh', () => {
    it('should refresh tokens and invalidate old refresh token', async () => {
      const { tokens } = await registerUser();

      const res = await request(app.getHttpServer())
        .post(AUTH_PATH.refresh)
        .send({ refreshToken: tokens.refreshToken })
        .expect(200);

      const body = res.body as TokensDto;
      const data = expectData(body);
      expect(data.accessToken).toBeDefined();
      expect(data.refreshToken).toBeDefined();
      expect(data.refreshToken).not.toBe(tokens.refreshToken);
      expect(data.expiresIn).toBeGreaterThan(0);

      const res2 = await request(app.getHttpServer())
        .post(AUTH_PATH.refresh)
        .send({ refreshToken: tokens.refreshToken })
        .expect(401);

      const body2 = res2.body as Record<string, unknown>;
      expect(body2['code']).toBe('AUTH_REFRESH_TOKEN_INVALID');
    });

    it('should not invalidate other sessions when refreshing one token', async () => {
      const email = uniqueEmail('auth');
      const firstSession = await registerUser(email);
      const secondLogin = await request(app.getHttpServer())
        .post(AUTH_PATH.login)
        .send({ email, password: TEST_PASSWORD })
        .expect(200);

      const secondBody = secondLogin.body as RegisterLoginData;
      const secondTokens = expectData(secondBody).tokens;

      await request(app.getHttpServer())
        .post(AUTH_PATH.refresh)
        .send({ refreshToken: firstSession.tokens.refreshToken })
        .expect(200);

      await request(app.getHttpServer())
        .post(AUTH_PATH.refresh)
        .send({ refreshToken: secondTokens.refreshToken })
        .expect(200);
    });

    it('should reject invalid refresh token', async () => {
      const res = await request(app.getHttpServer())
        .post(AUTH_PATH.refresh)
        .send({ refreshToken: UNKNOWN_REFRESH_TOKEN })
        .expect(401);

      const body = res.body as Record<string, unknown>;
      expect(body['code']).toBe('AUTH_REFRESH_TOKEN_INVALID');
    });
  });

  // ════════════════════════════════════════════════════════════
  // 5. POST /api/v1/auth/send-verification-code
  // ════════════════════════════════════════════════════════════

  describe('POST /api/v1/auth/send-verification-code', () => {
    it('should send verification code', async () => {
      const email = uniqueEmail('auth');

      const res = await request(app.getHttpServer())
        .post(AUTH_PATH.sendVerificationCode)
        .set('x-forwarded-for', uniqueClientIp())
        .send({ email, scene: AUTH_SCENE.register })
        .expect(200);

      const body = res.body as {
        cooldown: number;
        message: string;
      };
      const data = expectData(body);
      expect(data.cooldown).toBe(VERIFICATION_CODE_COOLDOWN_SECONDS);
    });

    it('should enforce cooldown', async () => {
      const { email } = await registerUser();

      const clientIp = uniqueClientIp();
      await request(app.getHttpServer())
        .post(AUTH_PATH.sendVerificationCode)
        .set('x-forwarded-for', clientIp)
        .send({ email, scene: AUTH_SCENE.login })
        .expect(200);

      const res = await request(app.getHttpServer())
        .post(AUTH_PATH.sendVerificationCode)
        .set('x-forwarded-for', clientIp)
        .send({ email, scene: AUTH_SCENE.login })
        .expect(400);

      const body = res.body as Record<string, unknown>;
      expect(body['code']).toBe('BAD_REQUEST');
    });

    it('should rate limit repeated requests from the same client', async () => {
      const clientIp = uniqueClientIp();

      for (
        let index = 0;
        index < DEFAULT_VERIFICATION_RATE_LIMIT_MAX;
        index += 1
      ) {
        await request(app.getHttpServer())
          .post(AUTH_PATH.sendVerificationCode)
          .set('x-forwarded-for', clientIp)
          .send({ email: uniqueEmail('auth'), scene: AUTH_SCENE.register })
          .expect(200);
      }

      const res = await request(app.getHttpServer())
        .post(AUTH_PATH.sendVerificationCode)
        .set('x-forwarded-for', clientIp)
        .send({ email: uniqueEmail('auth'), scene: AUTH_SCENE.register })
        .expect(429);

      const body = res.body as Record<string, unknown>;
      expect(body['code']).toBe('RATE_LIMITED');
    });
  });

  // ════════════════════════════════════════════════════════════
  // 6. POST /api/v1/auth/verify-email
  // ════════════════════════════════════════════════════════════

  describe('POST /api/v1/auth/verify-email', () => {
    const INVALID_BETTER_AUTH_TOKEN =
      'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c';

    it('should reject missing token with VALIDATION_FAILED', async () => {
      const res = await request(app.getHttpServer())
        .post(AUTH_PATH.verifyEmail)
        .send({})
        .expect(400);

      const body = res.body as Record<string, unknown>;
      expect(body['code']).toBe('VALIDATION_FAILED');
    });

    it('should reject an invalid or expired Better Auth token with AUTH_VERIFICATION_CODE_EXPIRED', async () => {
      const res = await request(app.getHttpServer())
        .post(AUTH_PATH.verifyEmail)
        .send({ token: INVALID_BETTER_AUTH_TOKEN })
        .expect(401);

      const body = res.body as Record<string, unknown>;
      expect(body['code']).toBe('AUTH_VERIFICATION_CODE_EXPIRED');
    });
  });

  // ════════════════════════════════════════════════════════════
  // 7. POST /api/v1/auth/forgot-password
  // ════════════════════════════════════════════════════════════

  describe('POST /api/v1/auth/forgot-password', () => {
    it('should send reset code for existing email', async () => {
      const { email } = await registerUser();

      await forgotPasswordRequest(email);
    });

    it('should return success even for non-existent email (anti-enumeration)', async () => {
      await forgotPasswordRequest(UNKNOWN_RESET_EMAIL);
    });
  });

  // ════════════════════════════════════════════════════════════
  // 8. POST /api/v1/auth/reset-password
  // ════════════════════════════════════════════════════════════

  describe('POST /api/v1/auth/reset-password', () => {
    it('should reset password with valid Better Auth reset token', async () => {
      const { email, user } = await registerUser();

      await forgotPasswordRequest(email);

      const verification = await ctx.prisma.verification.findFirst({
        where: {
          identifier: { startsWith: 'reset-password:' },
          value: user.id,
        },
        orderBy: { createdAt: 'desc' },
      });
      expect(verification).not.toBeNull();

      const token = verification!.identifier.replace('reset-password:', '');
      const newPassword = RESET_PASSWORD;
      await request(app.getHttpServer())
        .post(AUTH_PATH.resetPassword)
        .send({ token, password: newPassword })
        .expect(204);

      await request(app.getHttpServer())
        .post(AUTH_PATH.login)
        .send({ email, password: TEST_PASSWORD })
        .expect(401);

      await request(app.getHttpServer())
        .post(AUTH_PATH.login)
        .send({ email, password: newPassword })
        .expect(200);
    });
  });

  // ════════════════════════════════════════════════════════════
  // 9. GET /api/v1/account
  // ════════════════════════════════════════════════════════════

  describe('GET /api/v1/account', () => {
    it('should return authenticated account detail', async () => {
      const { email, tokens } = await registerUser();

      const res = await request(app.getHttpServer())
        .get(AUTH_PATH.account)
        .set(AUTHORIZATION_HEADER, bearer(tokens.accessToken))
        .expect(200);

      const body = res.body as AccountDto;
      const data = expectData(body);
      expect(data.email).toBe(email);
      expect(data.id).toBeDefined();
      expect(data.emailVerifiedAt).toEqual(expect.any(String));
      expect(data.hasPassword).toBe(true);
      expect(data.linkedIdentities).toEqual([]);
      expect(data.createdAt).toEqual(expect.any(String));
      expect(data.updatedAt).toEqual(expect.any(String));
    });

    it('should reject unauthenticated account request', async () => {
      await request(app.getHttpServer()).get(AUTH_PATH.account).expect(401);
    });
  });

  // ════════════════════════════════════════════════════════════
  // 10. PATCH /api/v1/account
  // ════════════════════════════════════════════════════════════

  describe('PATCH /api/v1/account', () => {
    it('should update nickname and avatar through account route', async () => {
      const { tokens } = await registerUser();

      const res = await request(app.getHttpServer())
        .patch(AUTH_PATH.account)
        .set(AUTHORIZATION_HEADER, bearer(tokens.accessToken))
        .send({
          nickname: UPDATED_NICKNAME,
          avatar: UPDATED_AVATAR_URL,
        })
        .expect(200);

      const body = res.body as AccountDto;
      const data = expectData(body);
      expect(data.nickname).toBe(UPDATED_NICKNAME);
      expect(data.avatar).toBe(UPDATED_AVATAR_URL);
      expect(data.emailVerifiedAt).toEqual(expect.any(String));
    });

    it('should clear nickname and avatar through account route', async () => {
      const { tokens } = await registerUser();

      const res = await request(app.getHttpServer())
        .patch(AUTH_PATH.account)
        .set(AUTHORIZATION_HEADER, bearer(tokens.accessToken))
        .send({
          nickname: '',
          avatar: '',
        })
        .expect(200);

      const body = res.body as AccountDto;
      const data = expectData(body);
      expect(data.nickname).toBeNull();
      expect(data.avatar).toBeNull();
    });

    it('should reject unauthenticated account update', async () => {
      await request(app.getHttpServer())
        .patch(AUTH_PATH.account)
        .send({ nickname: UNAUTHENTICATED_NICKNAME })
        .expect(401);
    });
  });

  // ════════════════════════════════════════════════════════════
  // 11. POST /api/v1/account/password
  // ════════════════════════════════════════════════════════════

  describe('POST /api/v1/account/password', () => {
    it('should change password through account route', async () => {
      const { email, tokens } = await registerUser();

      await request(app.getHttpServer())
        .post(AUTH_PATH.accountPassword)
        .set(AUTHORIZATION_HEADER, bearer(tokens.accessToken))
        .send({ password: TEST_PASSWORD, newPassword: CHANGED_PASSWORD })
        .expect(204);

      await request(app.getHttpServer())
        .post(AUTH_PATH.login)
        .send({ email, password: CHANGED_PASSWORD })
        .expect(200);
    });

    it('should reject wrong current password', async () => {
      const { tokens } = await registerUser();

      const res = await request(app.getHttpServer())
        .post(AUTH_PATH.accountPassword)
        .set(AUTHORIZATION_HEADER, bearer(tokens.accessToken))
        .send({
          password: WRONG_OLD_PASSWORD,
          newPassword: REJECTED_NEW_PASSWORD,
        })
        .expect(401);

      const body = res.body as Record<string, unknown>;
      expect(body['code']).toBe('AUTH_WRONG_PASSWORD');
    });

    it('should reject unauthenticated password change', async () => {
      await request(app.getHttpServer())
        .post(AUTH_PATH.accountPassword)
        .send({
          password: TEST_PASSWORD,
          newPassword: CHANGED_PASSWORD,
        })
        .expect(401);
    });
  });

  // ════════════════════════════════════════════════════════════
  // 12. POST /api/v1/account/email
  // ════════════════════════════════════════════════════════════

  describe('POST /api/v1/account/email', () => {
    it('should change email through account route and return verification time', async () => {
      const { tokens } = await registerUser();
      const newEmail = uniqueEmail('auth');

      const code = await seedVerificationCode(AUTH_SCENE.changeEmail, newEmail);

      const res = await request(app.getHttpServer())
        .post(AUTH_PATH.accountEmail)
        .set(AUTHORIZATION_HEADER, bearer(tokens.accessToken))
        .send({ newEmail, code, password: TEST_PASSWORD })
        .expect(200);

      const body = res.body as {
        email: string;
        emailVerifiedAt: string;
      };
      const data = expectData(body);
      expect(data.email).toBe(newEmail);
      expect(data.emailVerifiedAt).toEqual(expect.any(String));

      const accountRes = await request(app.getHttpServer())
        .get(AUTH_PATH.account)
        .set(AUTHORIZATION_HEADER, bearer(tokens.accessToken))
        .expect(200);

      const accountBody = accountRes.body as AccountDto;
      const accountData = expectData(accountBody);
      expect(accountData.email).toBe(newEmail);
    });

    it('should reject invalid verification code', async () => {
      const { tokens } = await registerUser();
      const newEmail = uniqueEmail('auth');

      const res = await request(app.getHttpServer())
        .post(AUTH_PATH.accountEmail)
        .set(AUTHORIZATION_HEADER, bearer(tokens.accessToken))
        .send({
          newEmail,
          code: INVALID_VERIFICATION_CODE,
          password: TEST_PASSWORD,
        })
        .expect(400);

      const body = res.body as Record<string, unknown>;
      expect(body['code']).toBe('BAD_REQUEST');
    });

    it('should return normalized email after change', async () => {
      const { tokens } = await registerUser();
      const normalizedEmail = uniqueEmail('auth').toLowerCase();
      const mixedCaseEmail = normalizedEmail.replace(
        /^([^@]+)@(.+)$/,
        (_, localPart: string, domain: string) =>
          `${localPart.toUpperCase()}@${domain.toUpperCase()}`,
      );

      const code = await seedVerificationCode(
        AUTH_SCENE.changeEmail,
        normalizedEmail,
      );

      const res = await request(app.getHttpServer())
        .post(AUTH_PATH.accountEmail)
        .set(AUTHORIZATION_HEADER, bearer(tokens.accessToken))
        .send({ newEmail: mixedCaseEmail, code, password: TEST_PASSWORD })
        .expect(200);

      const body = res.body as {
        email: string;
        emailVerifiedAt: string;
      };
      const data = expectData(body);
      expect(data.email).toBe(normalizedEmail);
    });

    it('should reject unauthenticated email change', async () => {
      await request(app.getHttpServer())
        .post(AUTH_PATH.accountEmail)
        .send({
          newEmail: uniqueEmail('auth'),
          code: DEFAULT_VERIFICATION_CODE,
        })
        .expect(401);
    });
  });

  // ════════════════════════════════════════════════════════════
  // 13. DELETE /api/v1/account
  // ════════════════════════════════════════════════════════════

  describe('DELETE /api/v1/account', () => {
    it('should delete account through account route', async () => {
      const { email, tokens } = await registerUser();

      await request(app.getHttpServer())
        .delete(AUTH_PATH.account)
        .set(AUTHORIZATION_HEADER, bearer(tokens.accessToken))
        .send({ password: TEST_PASSWORD })
        .expect(200);

      await request(app.getHttpServer())
        .post(AUTH_PATH.login)
        .send({ email, password: TEST_PASSWORD })
        .expect(401);
    });

    it('should reject deletion with wrong password', async () => {
      const { tokens } = await registerUser();

      const res = await request(app.getHttpServer())
        .delete(AUTH_PATH.account)
        .set(AUTHORIZATION_HEADER, bearer(tokens.accessToken))
        .send({ password: WRONG_DELETE_PASSWORD })
        .expect(401);

      const body = res.body as Record<string, unknown>;
      expect(body['code']).toBe('AUTH_WRONG_PASSWORD');
    });

    it('should reject unauthenticated account deletion', async () => {
      await request(app.getHttpServer())
        .delete(AUTH_PATH.account)
        .send({ password: TEST_PASSWORD })
        .expect(401);
    });
  });
});
