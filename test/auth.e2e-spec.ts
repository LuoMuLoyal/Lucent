import { Test, type TestingModule } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import type { Cache } from 'cache-manager';
import request from 'supertest';
import type { App } from 'supertest/types';

import { AppModule } from '../src/app.module';
import { setupApp } from '../src/setup-app';
import { PrismaService } from '../src/prisma/prisma.service';
import { ResultCode } from '../src/common/api-envelope';
import type { ApiEnvelope } from '../src/common/api-envelope';
import { VERIFICATION_CODE_RATE_LIMIT_MAX_REQUESTS } from '../src/auth/verification-code.service';

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

interface TokensDto {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

interface RegisterLoginData {
  user: UserDto;
  tokens: TokensDto;
}

// ── Helpers ──────────────────────────────────────────────────

const AUTH_PATH = {
  register: '/api/v1/auth/register',
  login: '/api/v1/auth/login',
  logout: '/api/v1/auth/logout',
  refresh: '/api/v1/auth/refresh',
  sendVerificationCode: '/api/v1/auth/send-verification-code',
  verifyEmail: '/api/v1/auth/verify-email',
  forgotPassword: '/api/v1/auth/forgot-password',
  resetPassword: '/api/v1/auth/reset-password',
  me: '/api/v1/auth/me',
  mePassword: '/api/v1/auth/me/password',
  meEmail: '/api/v1/auth/me/email',
} as const;

const AUTH_SCENE = {
  register: 'register',
  login: 'login',
  resetPassword: 'reset-password',
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
const BEARER_AUTH_SCHEME = 'Bearer';
const VERIFICATION_CODE_TTL_MS = 5 * 60 * 1000;
const VERIFICATION_CODE_COOLDOWN_SECONDS = 60;

let userSeq = 0;
function uniqueEmail(): string {
  userSeq += 1;
  return `testuser${String(userSeq)}_${String(Date.now())}@${TEST_EMAIL_DOMAIN}`;
}

let clientIpSeq = 0;
function uniqueClientIp(): string {
  clientIpSeq += 1;
  return `198.51.100.${String(clientIpSeq)}`;
}

/** Assert envelope.data is not null and return typed data. */

function expectData<T>(body: ApiEnvelope<T>): T {
  expect(body.data).not.toBeNull();
  // body.data is guaranteed non-null by the expect above
  return body.data as T;
}

function expectDefined<T>(value: T | undefined, message: string): T {
  expect(value).toBeDefined();
  if (value === undefined) {
    throw new Error(message);
  }
  return value;
}

function bearer(accessToken: string): string {
  return `${BEARER_AUTH_SCHEME} ${accessToken}`;
}

// ── Test Suite ───────────────────────────────────────────────

describe('Auth API (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let cache: Cache;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    setupApp(app, app.get(ConfigService));
    await app.init();

    prisma = app.get(PrismaService);
    cache = app.get(CACHE_MANAGER);

    // Clean test data (delete in correct order for FK constraints)
    await prisma.userSession.deleteMany();
    await prisma.user.deleteMany();
  });

  afterAll(async () => {
    // Final cleanup
    await prisma.userSession.deleteMany();
    await prisma.user.deleteMany();
    await app.close();
  });

  // ────────────────────────────────────────────────────────────
  // Helper: register a user and return tokens + user info
  // ────────────────────────────────────────────────────────────

  async function registerUser(email?: string) {
    const userEmail = email ?? uniqueEmail();
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

    const body = res.body as ApiEnvelope<RegisterLoginData>;
    expect(body.code).toBe(ResultCode.SUCCESS);
    const data = expectData(body);
    return { email: userEmail, ...data };
  }

  // ────────────────────────────────────────────────────────────
  // Helper: extract verification code from in-memory cache
  // ────────────────────────────────────────────────────────────

  async function getVerificationCode(
    scene: AuthScene,
    email: string,
  ): Promise<string | undefined> {
    const key = `vcode:${scene}:${email}`;
    return cache.get<string>(key);
  }

  async function issueVerificationCode(
    scene: AuthScene,
    email: string,
  ): Promise<string> {
    await request(app.getHttpServer())
      .post(AUTH_PATH.sendVerificationCode)
      .set('x-forwarded-for', uniqueClientIp())
      .send({ email, scene })
      .expect(200);

    const code = await getVerificationCode(scene, email);
    return expectDefined(
      code,
      `Verification code was not cached for ${scene}:${email}`,
    );
  }

  async function seedVerificationCode(
    scene: AuthScene,
    email: string,
    code = DEFAULT_VERIFICATION_CODE,
  ): Promise<string> {
    await cache.set(`vcode:${scene}:${email}`, code, VERIFICATION_CODE_TTL_MS);
    return code;
  }

  // ════════════════════════════════════════════════════════════
  // 1. POST /api/v1/auth/register
  // ════════════════════════════════════════════════════════════

  describe('POST /api/v1/auth/register', () => {
    it('should register a new user successfully', async () => {
      const email = uniqueEmail();
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

      const body = res.body as ApiEnvelope<RegisterLoginData>;
      expect(body.code).toBe(ResultCode.SUCCESS);
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
      const email = uniqueEmail();
      // Register first
      await registerUser(email);

      // Try again with same email
      const res = await request(app.getHttpServer())
        .post(AUTH_PATH.register)
        .send({
          email,
          password: TEST_PASSWORD,
          code: DEFAULT_VERIFICATION_CODE,
        })
        .expect(409);

      const body = res.body as ApiEnvelope;
      expect(body.code).toBe(ResultCode.CONFLICT);
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
        .send({ email: uniqueEmail() })
        .expect(400);

      const body = res.body as ApiEnvelope;
      expect(body.code).toBe(ResultCode.VALIDATION_FAILED);
    });
  });

  // ════════════════════════════════════════════════════════════
  // 2. POST /api/v1/auth/login
  // ════════════════════════════════════════════════════════════

  describe('POST /api/v1/auth/login', () => {
    it('should login with correct password', async () => {
      const { email } = await registerUser();

      const res = await request(app.getHttpServer())
        .post(AUTH_PATH.login)
        .send({ email, password: TEST_PASSWORD })
        .expect(200);

      const body = res.body as ApiEnvelope<RegisterLoginData>;
      expect(body.code).toBe(ResultCode.SUCCESS);
      const data = expectData(body);
      expect(data.user.email).toBe(email);
      expect(data.tokens.accessToken).toBeDefined();
    });

    it('should reject wrong password', async () => {
      const { email } = await registerUser();

      const res = await request(app.getHttpServer())
        .post(AUTH_PATH.login)
        .send({ email, password: WRONG_LOGIN_PASSWORD })
        .expect(401);

      const body = res.body as ApiEnvelope;
      expect(body.code).toBe(ResultCode.UNAUTHORIZED);
    });

    it('should reject non-existent email', async () => {
      const res = await request(app.getHttpServer())
        .post(AUTH_PATH.login)
        .send({ email: UNKNOWN_LOGIN_EMAIL, password: TEST_PASSWORD })
        .expect(401);

      const body = res.body as ApiEnvelope;
      expect(body.code).toBe(ResultCode.UNAUTHORIZED);
    });

    it('should login with verification code', async () => {
      const { email } = await registerUser();

      // Send verification code (login scene)
      await request(app.getHttpServer())
        .post(AUTH_PATH.sendVerificationCode)
        .send({ email, scene: AUTH_SCENE.login })
        .expect(200);

      // Get code from cache
      const code = expectDefined(
        await getVerificationCode(AUTH_SCENE.login, email),
        `Verification code was not cached for ${AUTH_SCENE.login}:${email}`,
      );

      // Login with code
      const res = await request(app.getHttpServer())
        .post(AUTH_PATH.login)
        .send({ email, code })
        .expect(200);

      const body = res.body as ApiEnvelope<RegisterLoginData>;
      expect(body.code).toBe(ResultCode.SUCCESS);
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

      // Logout
      await request(app.getHttpServer())
        .post(AUTH_PATH.logout)
        .set(AUTHORIZATION_HEADER, bearer(tokens.accessToken))
        .send({ refreshToken: tokens.refreshToken })
        .expect(200);

      // Refresh with the same token should fail
      const res = await request(app.getHttpServer())
        .post(AUTH_PATH.refresh)
        .send({ refreshToken: tokens.refreshToken })
        .expect(401);

      const body = res.body as ApiEnvelope;
      expect(body.code).toBe(ResultCode.REFRESH_TOKEN_INVALID);
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

      const body = res.body as ApiEnvelope<TokensDto>;
      expect(body.code).toBe(ResultCode.SUCCESS);
      const data = expectData(body);
      expect(data.accessToken).toBeDefined();
      expect(data.refreshToken).toBeDefined();
      expect(data.refreshToken).not.toBe(tokens.refreshToken); // rotated
      expect(data.expiresIn).toBeGreaterThan(0);

      // Old refresh token should be invalidated
      const res2 = await request(app.getHttpServer())
        .post(AUTH_PATH.refresh)
        .send({ refreshToken: tokens.refreshToken })
        .expect(401);

      const body2 = res2.body as ApiEnvelope;
      expect(body2.code).toBe(ResultCode.REFRESH_TOKEN_INVALID);
    });

    it('should not invalidate other sessions when refreshing one token', async () => {
      const email = uniqueEmail();
      const firstSession = await registerUser(email);
      const secondLogin = await request(app.getHttpServer())
        .post(AUTH_PATH.login)
        .send({ email, password: TEST_PASSWORD })
        .expect(200);

      const secondBody = secondLogin.body as ApiEnvelope<RegisterLoginData>;
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

      const body = res.body as ApiEnvelope;
      expect(body.code).toBe(ResultCode.REFRESH_TOKEN_INVALID);
    });
  });

  // ════════════════════════════════════════════════════════════
  // 5. POST /api/v1/auth/send-verification-code
  // ════════════════════════════════════════════════════════════

  describe('POST /api/v1/auth/send-verification-code', () => {
    it('should send verification code', async () => {
      const email = uniqueEmail();

      const res = await request(app.getHttpServer())
        .post(AUTH_PATH.sendVerificationCode)
        .send({ email, scene: AUTH_SCENE.register })
        .expect(200);

      const body = res.body as ApiEnvelope<{
        cooldown: number;
        message: string;
      }>;
      expect(body.code).toBe(ResultCode.SUCCESS);
      const data = expectData(body);
      expect(data.cooldown).toBe(VERIFICATION_CODE_COOLDOWN_SECONDS);
    });

    it('should enforce cooldown', async () => {
      const { email } = await registerUser();

      // First send
      await request(app.getHttpServer())
        .post(AUTH_PATH.sendVerificationCode)
        .send({ email, scene: AUTH_SCENE.login })
        .expect(200);

      // Second send within cooldown
      const res = await request(app.getHttpServer())
        .post(AUTH_PATH.sendVerificationCode)
        .send({ email, scene: AUTH_SCENE.login })
        .expect(400);

      const body = res.body as ApiEnvelope;
      expect(body.code).toBe(ResultCode.VERIFICATION_CODE_COOLDOWN);
    });

    it('should rate limit repeated requests from the same client', async () => {
      const clientIp = '203.0.113.10';

      for (
        let index = 0;
        index < VERIFICATION_CODE_RATE_LIMIT_MAX_REQUESTS;
        index += 1
      ) {
        await request(app.getHttpServer())
          .post(AUTH_PATH.sendVerificationCode)
          .set('x-forwarded-for', clientIp)
          .send({ email: uniqueEmail(), scene: AUTH_SCENE.register })
          .expect(200);
      }

      const res = await request(app.getHttpServer())
        .post(AUTH_PATH.sendVerificationCode)
        .set('x-forwarded-for', clientIp)
        .send({ email: uniqueEmail(), scene: AUTH_SCENE.register })
        .expect(429);

      const body = res.body as ApiEnvelope;
      expect(body.code).toBe(ResultCode.VERIFICATION_CODE_RATE_LIMITED);
    });
  });

  // ════════════════════════════════════════════════════════════
  // 6. POST /api/v1/auth/verify-email
  // ════════════════════════════════════════════════════════════

  describe('POST /api/v1/auth/verify-email', () => {
    it('should verify email with correct code', async () => {
      const { email } = await registerUser();
      const code = await seedVerificationCode(AUTH_SCENE.register, email);

      // Verify email
      const res = await request(app.getHttpServer())
        .post(AUTH_PATH.verifyEmail)
        .send({ email, code })
        .expect(200);

      const body = res.body as ApiEnvelope<{ emailVerified: boolean }>;
      expect(body.code).toBe(ResultCode.SUCCESS);
      const data = expectData(body);
      expect(data.emailVerified).toBe(true);
    });

    it('should reject invalid verification code', async () => {
      const { email } = await registerUser();
      await seedVerificationCode(AUTH_SCENE.register, email);

      const res = await request(app.getHttpServer())
        .post(AUTH_PATH.verifyEmail)
        .send({ email, code: INVALID_VERIFICATION_CODE })
        .expect(401);

      const body = res.body as ApiEnvelope;
      expect(body.code).toBe(ResultCode.VERIFICATION_CODE_INVALID);
    });
  });

  // ════════════════════════════════════════════════════════════
  // 7. POST /api/v1/auth/forgot-password
  // ════════════════════════════════════════════════════════════

  describe('POST /api/v1/auth/forgot-password', () => {
    it('should send reset code for existing email', async () => {
      const { email } = await registerUser();

      const res = await request(app.getHttpServer())
        .post(AUTH_PATH.forgotPassword)
        .send({ email })
        .expect(200);

      const body = res.body as ApiEnvelope<{
        cooldown: number;
        message: string;
      }>;
      expect(body.code).toBe(ResultCode.SUCCESS);
    });

    it('should return success even for non-existent email (anti-enumeration)', async () => {
      const res = await request(app.getHttpServer())
        .post(AUTH_PATH.forgotPassword)
        .send({ email: UNKNOWN_RESET_EMAIL })
        .expect(200);

      const body = res.body as ApiEnvelope<{
        cooldown: number;
        message: string;
      }>;
      expect(body.code).toBe(ResultCode.SUCCESS);
    });
  });

  // ════════════════════════════════════════════════════════════
  // 8. POST /api/v1/auth/reset-password
  // ════════════════════════════════════════════════════════════

  describe('POST /api/v1/auth/reset-password', () => {
    it('should reset password with valid code', async () => {
      const { email } = await registerUser();

      // Send forgot-password code
      await request(app.getHttpServer())
        .post(AUTH_PATH.forgotPassword)
        .send({ email })
        .expect(200);

      const code = expectDefined(
        await getVerificationCode(AUTH_SCENE.resetPassword, email),
        `Verification code was not cached for ${AUTH_SCENE.resetPassword}:${email}`,
      );

      // Reset password
      const newPassword = RESET_PASSWORD;
      const res = await request(app.getHttpServer())
        .post(AUTH_PATH.resetPassword)
        .send({ email, code, password: newPassword })
        .expect(200);

      const body = res.body as ApiEnvelope;
      expect(body.code).toBe(ResultCode.SUCCESS);

      // Login with new password should work
      await request(app.getHttpServer())
        .post(AUTH_PATH.login)
        .send({ email, password: newPassword })
        .expect(200);

      // Old password should fail
      await request(app.getHttpServer())
        .post(AUTH_PATH.login)
        .send({ email, password: TEST_PASSWORD })
        .expect(401);
    });
  });

  // ════════════════════════════════════════════════════════════
  // 9. GET /api/v1/auth/me
  // ════════════════════════════════════════════════════════════

  describe('GET /api/v1/auth/me', () => {
    it('should return current user info', async () => {
      const { email, tokens } = await registerUser();

      const res = await request(app.getHttpServer())
        .get(AUTH_PATH.me)
        .set(AUTHORIZATION_HEADER, bearer(tokens.accessToken))
        .expect(200);

      const body = res.body as ApiEnvelope<UserDto>;
      expect(body.code).toBe(ResultCode.SUCCESS);
      const data = expectData(body);
      expect(data.email).toBe(email);
      expect(data.id).toBeDefined();
    });

    it('should reject unauthenticated request', async () => {
      await request(app.getHttpServer()).get(AUTH_PATH.me).expect(401);
    });
  });

  // ════════════════════════════════════════════════════════════
  // 10. PATCH /api/v1/auth/me
  // ════════════════════════════════════════════════════════════

  describe('PATCH /api/v1/auth/me', () => {
    it('should update nickname and avatar', async () => {
      const { tokens } = await registerUser();

      const res = await request(app.getHttpServer())
        .patch(AUTH_PATH.me)
        .set(AUTHORIZATION_HEADER, bearer(tokens.accessToken))
        .send({
          nickname: UPDATED_NICKNAME,
          avatar: UPDATED_AVATAR_URL,
        })
        .expect(200);

      const body = res.body as ApiEnvelope<UserDto>;
      expect(body.code).toBe(ResultCode.SUCCESS);
      const data = expectData(body);
      expect(data.nickname).toBe(UPDATED_NICKNAME);
      expect(data.avatar).toBe(UPDATED_AVATAR_URL);
    });

    it('should reject unauthenticated request', async () => {
      await request(app.getHttpServer())
        .patch(AUTH_PATH.me)
        .send({ nickname: UNAUTHENTICATED_NICKNAME })
        .expect(401);
    });

    it('should clear nickname and avatar when empty strings are provided', async () => {
      const { tokens } = await registerUser();

      const res = await request(app.getHttpServer())
        .patch(AUTH_PATH.me)
        .set(AUTHORIZATION_HEADER, bearer(tokens.accessToken))
        .send({
          nickname: '',
          avatar: '',
        })
        .expect(200);

      const body = res.body as ApiEnvelope<UserDto>;
      const data = expectData(body);
      expect(data.nickname).toBeNull();
      expect(data.avatar).toBeNull();
    });
  });

  // ════════════════════════════════════════════════════════════
  // 11. POST /api/v1/auth/me/password
  // ════════════════════════════════════════════════════════════

  describe('POST /api/v1/auth/me/password', () => {
    it('should change password', async () => {
      const { email, tokens } = await registerUser();
      const newPassword = CHANGED_PASSWORD;

      // Change password
      const res = await request(app.getHttpServer())
        .post(AUTH_PATH.mePassword)
        .set(AUTHORIZATION_HEADER, bearer(tokens.accessToken))
        .send({ oldPassword: TEST_PASSWORD, newPassword })
        .expect(200);

      const body = res.body as ApiEnvelope;
      expect(body.code).toBe(ResultCode.SUCCESS);

      // Login with new password
      await request(app.getHttpServer())
        .post(AUTH_PATH.login)
        .send({ email, password: newPassword })
        .expect(200);

      // Old password should fail
      await request(app.getHttpServer())
        .post(AUTH_PATH.login)
        .send({ email, password: TEST_PASSWORD })
        .expect(401);
    });

    it('should reject wrong old password', async () => {
      const { tokens } = await registerUser();

      const res = await request(app.getHttpServer())
        .post(AUTH_PATH.mePassword)
        .set(AUTHORIZATION_HEADER, bearer(tokens.accessToken))
        .send({
          oldPassword: WRONG_OLD_PASSWORD,
          newPassword: REJECTED_NEW_PASSWORD,
        })
        .expect(401);

      const body = res.body as ApiEnvelope;
      expect(body.code).toBe(ResultCode.WRONG_PASSWORD);
    });
  });

  // ════════════════════════════════════════════════════════════
  // 12. POST /api/v1/auth/me/email
  // ════════════════════════════════════════════════════════════

  describe('POST /api/v1/auth/me/email', () => {
    it('should change email with valid verification code', async () => {
      const { tokens } = await registerUser();
      const newEmail = uniqueEmail();

      // Send verification code for change-email scene (sent to new email)
      await request(app.getHttpServer())
        .post(AUTH_PATH.sendVerificationCode)
        .send({ email: newEmail, scene: AUTH_SCENE.changeEmail })
        .expect(200);

      const code = expectDefined(
        await getVerificationCode(AUTH_SCENE.changeEmail, newEmail),
        `Verification code was not cached for ${AUTH_SCENE.changeEmail}:${newEmail}`,
      );

      // Change email
      const res = await request(app.getHttpServer())
        .post(AUTH_PATH.meEmail)
        .set(AUTHORIZATION_HEADER, bearer(tokens.accessToken))
        .send({ newEmail, code })
        .expect(200);

      const body = res.body as ApiEnvelope<{
        email: string;
        emailVerified: boolean;
      }>;
      expect(body.code).toBe(ResultCode.SUCCESS);
      const data = expectData(body);
      expect(data.email).toBe(newEmail);
      expect(data.emailVerified).toBe(true);

      // Verify updated profile reflects new email
      const meRes = await request(app.getHttpServer())
        .get(AUTH_PATH.me)
        .set(AUTHORIZATION_HEADER, bearer(tokens.accessToken))
        .expect(200);

      const meBody = meRes.body as ApiEnvelope<UserDto>;
      const meData = expectData(meBody);
      expect(meData.email).toBe(newEmail);
    });

    it('should reject invalid verification code', async () => {
      const { tokens } = await registerUser();
      const newEmail = uniqueEmail();

      const res = await request(app.getHttpServer())
        .post(AUTH_PATH.meEmail)
        .set(AUTHORIZATION_HEADER, bearer(tokens.accessToken))
        .send({ newEmail, code: INVALID_VERIFICATION_CODE })
        .expect(400);

      const body = res.body as ApiEnvelope;
      expect(body.code).toBe(ResultCode.VERIFICATION_CODE_INVALID);
    });

    it('should return normalized email after change', async () => {
      const { tokens } = await registerUser();
      const normalizedEmail = uniqueEmail().toLowerCase();
      const mixedCaseEmail = normalizedEmail.replace(
        /^([^@]+)@(.+)$/,
        (_, localPart: string, domain: string) =>
          `${localPart.toUpperCase()}@${domain.toUpperCase()}`,
      );

      await request(app.getHttpServer())
        .post(AUTH_PATH.sendVerificationCode)
        .send({ email: mixedCaseEmail, scene: AUTH_SCENE.changeEmail })
        .expect(200);

      const code = expectDefined(
        await getVerificationCode(AUTH_SCENE.changeEmail, normalizedEmail),
        `Verification code was not cached for ${AUTH_SCENE.changeEmail}:${normalizedEmail}`,
      );

      const res = await request(app.getHttpServer())
        .post(AUTH_PATH.meEmail)
        .set(AUTHORIZATION_HEADER, bearer(tokens.accessToken))
        .send({ newEmail: mixedCaseEmail, code })
        .expect(200);

      const body = res.body as ApiEnvelope<{
        email: string;
        emailVerified: boolean;
      }>;
      const data = expectData(body);
      expect(data.email).toBe(normalizedEmail);
    });
  });

  // ════════════════════════════════════════════════════════════
  // 13. DELETE /api/v1/auth/me
  // ════════════════════════════════════════════════════════════

  describe('DELETE /api/v1/auth/me', () => {
    it('should delete account with correct password', async () => {
      const { email, tokens } = await registerUser();

      // Delete account
      const res = await request(app.getHttpServer())
        .delete(AUTH_PATH.me)
        .set(AUTHORIZATION_HEADER, bearer(tokens.accessToken))
        .send({ password: TEST_PASSWORD })
        .expect(200);

      const body = res.body as ApiEnvelope;
      expect(body.code).toBe(ResultCode.SUCCESS);

      // Login should fail after deletion
      await request(app.getHttpServer())
        .post(AUTH_PATH.login)
        .send({ email, password: TEST_PASSWORD })
        .expect(401);
    });

    it('should reject deletion with wrong password', async () => {
      const { tokens } = await registerUser();

      const res = await request(app.getHttpServer())
        .delete(AUTH_PATH.me)
        .set(AUTHORIZATION_HEADER, bearer(tokens.accessToken))
        .send({ password: WRONG_DELETE_PASSWORD })
        .expect(401);

      const body = res.body as ApiEnvelope;
      expect(body.code).toBe(ResultCode.WRONG_PASSWORD);
    });
  });
});
