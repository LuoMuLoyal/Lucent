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

let userSeq = 0;
function uniqueEmail(): string {
  userSeq += 1;
  return `testuser${String(userSeq)}_${String(Date.now())}@example.com`;
}

const TEST_PASSWORD = 'Test@123456';

/** Assert envelope.data is not null and return typed data. */

function expectData<T>(body: ApiEnvelope<T>): T {
  expect(body.data).not.toBeNull();
  // body.data is guaranteed non-null by the expect above
  return body.data as T;
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
    await prisma.refreshToken.deleteMany();
    await prisma.user.deleteMany();
  });

  afterAll(async () => {
    // Final cleanup
    await prisma.refreshToken.deleteMany();
    await prisma.user.deleteMany();
    await app.close();
  });

  // ────────────────────────────────────────────────────────────
  // Helper: register a user and return tokens + user info
  // ────────────────────────────────────────────────────────────

  async function registerUser(email?: string) {
    const userEmail = email ?? uniqueEmail();
    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({ email: userEmail, password: TEST_PASSWORD, nickname: 'TestUser' })
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
    scene: string,
    email: string,
  ): Promise<string | undefined> {
    const key = `vcode:${scene}:${email}`;
    return cache.get<string>(key);
  }

  // ════════════════════════════════════════════════════════════
  // 1. POST /api/v1/auth/register
  // ════════════════════════════════════════════════════════════

  describe('POST /api/v1/auth/register', () => {
    it('should register a new user successfully', async () => {
      const email = uniqueEmail();
      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/register')
        .send({ email, password: TEST_PASSWORD, nickname: 'NewUser' })
        .expect(201);

      const body = res.body as ApiEnvelope<RegisterLoginData>;
      expect(body.code).toBe(ResultCode.SUCCESS);
      const data = expectData(body);
      expect(data.user.email).toBe(email);
      expect(data.user.nickname).toBe('NewUser');
      expect(data.user.id).toBeDefined();
      expect(data.user.createdAt).toBeDefined();
      expect(data.tokens.accessToken).toBeDefined();
      expect(data.tokens.refreshToken).toBeDefined();
      expect(data.tokens.expiresIn).toBeGreaterThan(0);
    });

    it('should reject duplicate email', async () => {
      const email = uniqueEmail();
      // Register first
      await request(app.getHttpServer())
        .post('/api/v1/auth/register')
        .send({ email, password: TEST_PASSWORD })
        .expect(201);

      // Try again with same email
      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/register')
        .send({ email, password: TEST_PASSWORD })
        .expect(409);

      const body = res.body as ApiEnvelope;
      expect(body.code).toBe(ResultCode.CONFLICT);
    });

    it('should reject invalid email format', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/auth/register')
        .send({ email: 'not-an-email', password: TEST_PASSWORD })
        .expect(400);
    });

    it('should reject missing password', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/auth/register')
        .send({ email: uniqueEmail() })
        .expect(400);
    });
  });

  // ════════════════════════════════════════════════════════════
  // 2. POST /api/v1/auth/login
  // ════════════════════════════════════════════════════════════

  describe('POST /api/v1/auth/login', () => {
    it('should login with correct password', async () => {
      const { email } = await registerUser();

      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
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
        .post('/api/v1/auth/login')
        .send({ email, password: 'WrongPassword123!' })
        .expect(401);

      const body = res.body as ApiEnvelope;
      expect(body.code).toBe(ResultCode.UNAUTHORIZED);
    });

    it('should reject non-existent email', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email: 'nonexistent@example.com', password: TEST_PASSWORD })
        .expect(401);

      const body = res.body as ApiEnvelope;
      expect(body.code).toBe(ResultCode.UNAUTHORIZED);
    });

    it('should login with verification code', async () => {
      const { email } = await registerUser();

      // Send verification code (login scene)
      await request(app.getHttpServer())
        .post('/api/v1/auth/send-verification-code')
        .send({ email, scene: 'login' })
        .expect(200);

      // Get code from cache
      const code = await getVerificationCode('login', email);
      expect(code).toBeDefined();

      // Login with code
      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
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
        .post('/api/v1/auth/logout')
        .set('Authorization', `Bearer ${tokens.accessToken}`)
        .send({ refreshToken: tokens.refreshToken })
        .expect(200);

      // Refresh with the same token should fail
      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/refresh')
        .send({ refreshToken: tokens.refreshToken })
        .expect(401);

      const body = res.body as ApiEnvelope;
      expect(body.code).toBe(ResultCode.REFRESH_TOKEN_INVALID);
    });

    it('should reject logout without auth token', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/auth/logout')
        .send({ refreshToken: 'fake-token' })
        .expect(401);
    });
  });

  // ════════════════════════════════════════════════════════════
  // 4. POST /api/v1/auth/refresh
  // ════════════════════════════════════════════════════════════

  describe('POST /api/v1/auth/refresh', () => {
    it('should refresh tokens and invalidate old refresh token', async () => {
      const { tokens } = await registerUser();

      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/refresh')
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
        .post('/api/v1/auth/refresh')
        .send({ refreshToken: tokens.refreshToken })
        .expect(401);

      const body2 = res2.body as ApiEnvelope;
      expect(body2.code).toBe(ResultCode.REFRESH_TOKEN_INVALID);
    });

    it('should reject invalid refresh token', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/refresh')
        .send({ refreshToken: 'non-existent-token' })
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
      const { email } = await registerUser();

      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/send-verification-code')
        .send({ email, scene: 'register' })
        .expect(200);

      const body = res.body as ApiEnvelope<{
        cooldown: number;
        message: string;
      }>;
      expect(body.code).toBe(ResultCode.SUCCESS);
      const data = expectData(body);
      expect(data.cooldown).toBe(60);
    });

    it('should enforce cooldown', async () => {
      const { email } = await registerUser();

      // First send
      await request(app.getHttpServer())
        .post('/api/v1/auth/send-verification-code')
        .send({ email, scene: 'login' })
        .expect(200);

      // Second send within cooldown
      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/send-verification-code')
        .send({ email, scene: 'login' })
        .expect(400);

      const body = res.body as ApiEnvelope;
      expect(body.code).toBe(ResultCode.VERIFICATION_CODE_COOLDOWN);
    });
  });

  // ════════════════════════════════════════════════════════════
  // 6. POST /api/v1/auth/verify-email
  // ════════════════════════════════════════════════════════════

  describe('POST /api/v1/auth/verify-email', () => {
    it('should verify email with correct code', async () => {
      const { email } = await registerUser();

      // Send verification code
      await request(app.getHttpServer())
        .post('/api/v1/auth/send-verification-code')
        .send({ email, scene: 'register' })
        .expect(200);

      const code = await getVerificationCode('register', email);
      expect(code).toBeDefined();

      // Verify email
      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/verify-email')
        .send({ email, code })
        .expect(200);

      const body = res.body as ApiEnvelope<{ emailVerified: boolean }>;
      expect(body.code).toBe(ResultCode.SUCCESS);
      const data = expectData(body);
      expect(data.emailVerified).toBe(true);
    });

    it('should reject invalid verification code', async () => {
      const { email } = await registerUser();

      await request(app.getHttpServer())
        .post('/api/v1/auth/send-verification-code')
        .send({ email, scene: 'register' })
        .expect(200);

      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/verify-email')
        .send({ email, code: '000000' })
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
        .post('/api/v1/auth/forgot-password')
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
        .post('/api/v1/auth/forgot-password')
        .send({ email: 'nobody@example.com' })
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
        .post('/api/v1/auth/forgot-password')
        .send({ email })
        .expect(200);

      const code = await getVerificationCode('reset-password', email);
      expect(code).toBeDefined();

      // Reset password
      const newPassword = 'NewSecure@Pass1';
      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/reset-password')
        .send({ email, code, password: newPassword })
        .expect(200);

      const body = res.body as ApiEnvelope;
      expect(body.code).toBe(ResultCode.SUCCESS);

      // Login with new password should work
      await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email, password: newPassword })
        .expect(200);

      // Old password should fail
      await request(app.getHttpServer())
        .post('/api/v1/auth/login')
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
        .get('/api/v1/auth/me')
        .set('Authorization', `Bearer ${tokens.accessToken}`)
        .expect(200);

      const body = res.body as ApiEnvelope<UserDto>;
      expect(body.code).toBe(ResultCode.SUCCESS);
      const data = expectData(body);
      expect(data.email).toBe(email);
      expect(data.id).toBeDefined();
    });

    it('should reject unauthenticated request', async () => {
      await request(app.getHttpServer()).get('/api/v1/auth/me').expect(401);
    });
  });

  // ════════════════════════════════════════════════════════════
  // 10. PATCH /api/v1/auth/me
  // ════════════════════════════════════════════════════════════

  describe('PATCH /api/v1/auth/me', () => {
    it('should update nickname and avatar', async () => {
      const { tokens } = await registerUser();

      const res = await request(app.getHttpServer())
        .patch('/api/v1/auth/me')
        .set('Authorization', `Bearer ${tokens.accessToken}`)
        .send({
          nickname: 'UpdatedNick',
          avatar: 'https://example.com/avatar.png',
        })
        .expect(200);

      const body = res.body as ApiEnvelope<UserDto>;
      expect(body.code).toBe(ResultCode.SUCCESS);
      const data = expectData(body);
      expect(data.nickname).toBe('UpdatedNick');
      expect(data.avatar).toBe('https://example.com/avatar.png');
    });

    it('should reject unauthenticated request', async () => {
      await request(app.getHttpServer())
        .patch('/api/v1/auth/me')
        .send({ nickname: 'Hacker' })
        .expect(401);
    });
  });

  // ════════════════════════════════════════════════════════════
  // 11. POST /api/v1/auth/me/password
  // ════════════════════════════════════════════════════════════

  describe('POST /api/v1/auth/me/password', () => {
    it('should change password', async () => {
      const { email, tokens } = await registerUser();
      const newPassword = 'NewSecure@Pass2';

      // Change password
      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/me/password')
        .set('Authorization', `Bearer ${tokens.accessToken}`)
        .send({ oldPassword: TEST_PASSWORD, newPassword })
        .expect(200);

      const body = res.body as ApiEnvelope;
      expect(body.code).toBe(ResultCode.SUCCESS);

      // Login with new password
      await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email, password: newPassword })
        .expect(200);

      // Old password should fail
      await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email, password: TEST_PASSWORD })
        .expect(401);
    });

    it('should reject wrong old password', async () => {
      const { tokens } = await registerUser();

      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/me/password')
        .set('Authorization', `Bearer ${tokens.accessToken}`)
        .send({ oldPassword: 'WrongOldPass1!', newPassword: 'NewSecure@Pass3' })
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
      const { email: oldEmail, tokens } = await registerUser();
      const newEmail = uniqueEmail();

      // Send verification code for change-email scene (sent to current email)
      await request(app.getHttpServer())
        .post('/api/v1/auth/send-verification-code')
        .send({ email: oldEmail, scene: 'change-email' })
        .expect(200);

      const code = await getVerificationCode('change-email', oldEmail);
      expect(code).toBeDefined();

      // Change email
      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/me/email')
        .set('Authorization', `Bearer ${tokens.accessToken}`)
        .send({ currentEmail: oldEmail, newEmail, code })
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
        .get('/api/v1/auth/me')
        .set('Authorization', `Bearer ${tokens.accessToken}`)
        .expect(200);

      const meBody = meRes.body as ApiEnvelope<UserDto>;
      const meData = expectData(meBody);
      expect(meData.email).toBe(newEmail);
    });

    it('should reject invalid verification code', async () => {
      const { email, tokens } = await registerUser();
      const newEmail = uniqueEmail();

      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/me/email')
        .set('Authorization', `Bearer ${tokens.accessToken}`)
        .send({ currentEmail: email, newEmail, code: '000000' })
        .expect(401);

      const body = res.body as ApiEnvelope;
      expect(body.code).toBe(ResultCode.VERIFICATION_CODE_INVALID);
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
        .delete('/api/v1/auth/me')
        .set('Authorization', `Bearer ${tokens.accessToken}`)
        .send({ password: TEST_PASSWORD })
        .expect(200);

      const body = res.body as ApiEnvelope;
      expect(body.code).toBe(ResultCode.SUCCESS);

      // Login should fail after deletion
      await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email, password: TEST_PASSWORD })
        .expect(401);
    });

    it('should reject deletion with wrong password', async () => {
      const { tokens } = await registerUser();

      const res = await request(app.getHttpServer())
        .delete('/api/v1/auth/me')
        .set('Authorization', `Bearer ${tokens.accessToken}`)
        .send({ password: 'WrongPassword!' })
        .expect(401);

      const body = res.body as ApiEnvelope;
      expect(body.code).toBe(ResultCode.WRONG_PASSWORD);
    });
  });
});
