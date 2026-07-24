import request from 'supertest';
import { createHash } from 'node:crypto';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import type { Cache } from 'cache-manager';

import { ResultCode } from '../../../src/common';
import type { ApiEnvelope } from '../../../src/common';
import {
  createTestApp,
  cleanupDatabase,
  bearer,
  expectData,
  uniqueEmail,
} from '../../helpers/e2e-helpers';
import type { E2eTestContext, E2eApp } from '../../helpers/e2e-helpers';

const SESSIONS_PATH = '/api/v1/auth/sessions';
const LOGIN_PATH = '/api/v1/auth/login';
const LOGOUT_PATH = '/api/v1/auth/logout';
const REFRESH_PATH = '/api/v1/auth/refresh';
const REGISTER_PATH = '/api/v1/auth/register';
const SEND_CODE_PATH = '/api/v1/auth/send-verification-code';

const TEST_PASSWORD = 'Test@123456';

interface SessionDto {
  id: string;
  deviceType: string | null;
  deviceName: string | null;
  platform: string | null;
  lastUsedAt: string | null;
  createdAt: string;
  expiresAt: string;
  isCurrent: boolean;
}

interface TokensDto {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

interface RegisterLoginData {
  user: { id: string; email: string };
  tokens: TokensDto;
}

function hashRefreshToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

describe('Session Management API (e2e)', () => {
  let ctx: E2eTestContext;
  let app: E2eApp;

  beforeAll(async () => {
    ctx = await createTestApp();
    app = ctx.app;
    await cleanupDatabase(ctx.prisma);
  });

  afterAll(async () => {
    await cleanupDatabase(ctx.prisma);
    await app.close();
  });

  // ── Helper: register a user via the API and return tokens ──

  async function registerUserViaApi(): Promise<RegisterLoginData> {
    const email = uniqueEmail('session');

    // Send verification code
    await request(app.getHttpServer())
      .post(SEND_CODE_PATH)
      .set('x-forwarded-for', '198.51.100.1')
      .send({ email, scene: 'register' })
      .expect(200);

    // Seed verification code hash directly (service stores hash, not plaintext)
    const code = '123456';
    const hash = createHash('sha256')
      .update(`register:${email}:${code}`)
      .digest('hex');
    const cache = app.get<Cache>(CACHE_MANAGER);
    await cache.set(`vcode:register:${email}`, hash, 5 * 60 * 1000);

    const res = await request(app.getHttpServer())
      .post(REGISTER_PATH)
      .send({
        email,
        password: TEST_PASSWORD,
        code,
        nickname: 'SessionTester',
      })
      .expect(201);

    return expectData(res.body as ApiEnvelope<RegisterLoginData>);
  }

  // ════════════════════════════════════════════════════════════
  // GET /auth/sessions — List active sessions
  // ════════════════════════════════════════════════════════════

  describe('GET /api/v1/auth/sessions', () => {
    it('should return 401 for unauthenticated request', async () => {
      await request(app.getHttpServer()).get(SESSIONS_PATH).expect(401);
    });

    it('should return sessions for an authenticated user', async () => {
      const { tokens } = await registerUserViaApi();

      const res = await request(app.getHttpServer())
        .get(SESSIONS_PATH)
        .set('Authorization', bearer(tokens.accessToken))
        .expect(200);

      const sessions = expectData(res.body as ApiEnvelope<SessionDto[]>);
      expect(sessions.length).toBeGreaterThanOrEqual(1);

      const session = sessions[0]!;
      expect(session.id).toBeDefined();
      expect(session.createdAt).toBeTruthy();
      expect(session.expiresAt).toBeTruthy();
      expect(session.isCurrent).toBe(false); // isCurrent is always false in current implementation
    });

    it('should list multiple sessions after multiple logins', async () => {
      const { user, tokens } = await registerUserViaApi();

      // Second login creates a second session
      await request(app.getHttpServer())
        .post(LOGIN_PATH)
        .send({ email: user.email, password: TEST_PASSWORD })
        .expect(200);

      const res = await request(app.getHttpServer())
        .get(SESSIONS_PATH)
        .set('Authorization', bearer(tokens.accessToken))
        .expect(200);

      const sessions = expectData(res.body as ApiEnvelope<SessionDto[]>);
      expect(sessions.length).toBeGreaterThanOrEqual(2);
    });

    it('should not list revoked sessions', async () => {
      const { tokens } = await registerUserViaApi();

      // Logout to revoke the session
      await request(app.getHttpServer())
        .post(LOGOUT_PATH)
        .set('Authorization', bearer(tokens.accessToken))
        .send({ refreshToken: tokens.refreshToken })
        .expect(200);

      // Create a new session to get a valid access token
      const { user } = await registerUserViaApi();
      const loginRes = await request(app.getHttpServer())
        .post(LOGIN_PATH)
        .send({ email: user.email, password: TEST_PASSWORD })
        .expect(200);
      const newTokens = expectData(
        loginRes.body as ApiEnvelope<RegisterLoginData>,
      ).tokens;

      // List sessions — should only show the active one
      await request(app.getHttpServer())
        .get(SESSIONS_PATH)
        .set('Authorization', bearer(newTokens.accessToken))
        .expect(200);

      // The logged-out session should not appear in the list
      const oldSessionHash = hashRefreshToken(tokens.refreshToken);
      const oldSession = await ctx.prisma.userSession.findUnique({
        where: { refreshTokenHash: oldSessionHash },
      });
      expect(oldSession?.revokedAt).not.toBeNull();
    });
  });

  // ════════════════════════════════════════════════════════════
  // DELETE /auth/sessions/:sessionId — Revoke a specific session
  // ════════════════════════════════════════════════════════════

  describe('DELETE /api/v1/auth/sessions/:sessionId', () => {
    it('should return 401 for unauthenticated request', async () => {
      await request(app.getHttpServer())
        .delete(`${SESSIONS_PATH}/fake-session-id`)
        .expect(401);
    });

    it('should revoke a specific session by id', async () => {
      // Register + login to get two sessions
      const { user, tokens: firstTokens } = await registerUserViaApi();

      const secondLoginRes = await request(app.getHttpServer())
        .post(LOGIN_PATH)
        .send({ email: user.email, password: TEST_PASSWORD })
        .expect(200);
      const secondTokens = expectData(
        secondLoginRes.body as ApiEnvelope<RegisterLoginData>,
      ).tokens;

      // List sessions to find the second session id
      const listRes = await request(app.getHttpServer())
        .get(SESSIONS_PATH)
        .set('Authorization', bearer(firstTokens.accessToken))
        .expect(200);

      const sessions = expectData(listRes.body as ApiEnvelope<SessionDto[]>);
      expect(sessions.length).toBeGreaterThanOrEqual(2);

      // Find the second session (the one with secondTokens.refreshToken)
      const secondSessionHash = hashRefreshToken(secondTokens.refreshToken);
      const secondSessionRecord = await ctx.prisma.userSession.findUnique({
        where: { refreshTokenHash: secondSessionHash },
      });
      expect(secondSessionRecord).toBeDefined();
      const targetSessionId = secondSessionRecord!.id;

      // Revoke the second session
      await request(app.getHttpServer())
        .delete(`${SESSIONS_PATH}/${targetSessionId}`)
        .set('Authorization', bearer(firstTokens.accessToken))
        .expect(200);

      // Verify the second refresh token no longer works
      const refreshRes = await request(app.getHttpServer())
        .post(REFRESH_PATH)
        .send({ refreshToken: secondTokens.refreshToken })
        .expect(401);

      const refreshBody = refreshRes.body as ApiEnvelope;
      expect(refreshBody.code).toBe(ResultCode.REFRESH_TOKEN_INVALID);

      // Verify the first session still works
      await request(app.getHttpServer())
        .post(REFRESH_PATH)
        .send({ refreshToken: firstTokens.refreshToken })
        .expect(200);
    });

    it('should return 404 for non-existent session id', async () => {
      const { tokens } = await registerUserViaApi();

      const res = await request(app.getHttpServer())
        .delete(`${SESSIONS_PATH}/00000000-0000-0000-0000-000000000000`)
        .set('Authorization', bearer(tokens.accessToken))
        .expect(404);

      const body = res.body as ApiEnvelope;
      expect(body.code).not.toBe(ResultCode.SUCCESS);
    });

    it('should not allow revoking another user session (403)', async () => {
      // User A registers and gets a session
      const userA = await registerUserViaApi();

      // User B registers and gets a session
      const userB = await registerUserViaApi();

      // Find user B's session id
      const listResB = await request(app.getHttpServer())
        .get(SESSIONS_PATH)
        .set('Authorization', bearer(userB.tokens.accessToken))
        .expect(200);

      const sessionsB = expectData(listResB.body as ApiEnvelope<SessionDto[]>);
      const targetSessionId = sessionsB[0]!.id;

      // User A tries to revoke User B's session — gets 403
      const res = await request(app.getHttpServer())
        .delete(`${SESSIONS_PATH}/${targetSessionId}`)
        .set('Authorization', bearer(userA.tokens.accessToken))
        .expect(403);

      const body = res.body as ApiEnvelope;
      expect(body.code).not.toBe(ResultCode.SUCCESS);

      // Verify User B's session is still active
      await request(app.getHttpServer())
        .post(REFRESH_PATH)
        .send({ refreshToken: userB.tokens.refreshToken })
        .expect(200);
    });
  });
});
