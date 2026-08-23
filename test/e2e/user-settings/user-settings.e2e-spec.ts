import request from 'supertest';

import {
  createTestApp,
  cleanupDatabase,
  createTestUser,
  createAccessToken,
  bearer,
  expectData,
  uniqueEmail,
} from '../../helpers/e2e-helpers';
import type { E2eTestContext, E2eApp } from '../../helpers/e2e-helpers';
import { UserStatus } from '#generated/prisma/client';

const USER_SETTINGS_PATH = '/api/v1/user/settings';
const SECURITY_PIN_PATH = `${USER_SETTINGS_PATH}/security-pin`;
const SECURITY_PIN_VERIFY_PATH = `${SECURITY_PIN_PATH}/verify`;
const SECURITY_PIN_CHANGE_PATH = `${SECURITY_PIN_PATH}/change`;
const SECURITY_PIN_DISABLE_PATH = `${SECURITY_PIN_PATH}/disable`;

const TEST_PIN = '123456';
const NEW_PIN = '654321';
const WRONG_PIN = '999999';

interface UserSettingsData {
  aiSummariesEnabled: boolean;
  dataSharingConsent: boolean;
  assistantEnabled: boolean;
  assistantMemoryEnabled: boolean;
  assistantContext: {
    healthProfile: boolean;
    dailyRecords: boolean;
    sleepRecords: boolean;
    currentMedicines: boolean;
  };
  securityPin: {
    enabled: boolean;
    lastChangedAt: string | null;
  };
  updatedAt: string | null;
}

interface ElevationResult {
  elevationToken: string;
  expiresAt: string;
}

describe('User Settings API (e2e)', () => {
  let ctx: E2eTestContext;
  let app: E2eApp;
  let userId: string;
  let userEmail: string;

  beforeAll(async () => {
    ctx = await createTestApp();
    app = ctx.app;
    await cleanupDatabase(ctx.prisma);

    const user = await createTestUser(ctx.prisma, undefined, 'SettingsUser');
    userId = user.id;
    userEmail = user.email;
  });

  afterAll(async () => {
    await cleanupDatabase(ctx.prisma);
    await app.close();
  });

  async function makeToken(): Promise<string> {
    return createAccessToken(
      ctx.jwtService,
      ctx.configService,
      userId,
      userEmail,
    );
  }

  // ════════════════════════════════════════════════════════════
  // GET /settings — existing tests
  // ════════════════════════════════════════════════════════════

  describe('GET /api/v1/user/settings', () => {
    it('should return default settings for a new user', async () => {
      const token = await makeToken();
      const response = await request(app.getHttpServer())
        .get(USER_SETTINGS_PATH)
        .set('Authorization', bearer(token))
        .expect(200);

      const settings = expectData(response.body as UserSettingsData);

      expect(settings.aiSummariesEnabled).toBe(true);
      expect(settings.dataSharingConsent).toBe(false);
      expect(settings.assistantEnabled).toBe(true);
      expect(settings.assistantMemoryEnabled).toBe(false);
      expect(settings.assistantContext).toEqual({
        healthProfile: true,
        dailyRecords: true,
        sleepRecords: true,
        currentMedicines: true,
      });
      expect(settings.securityPin.enabled).toBe(false);
      expect(settings.securityPin.lastChangedAt).toBeNull();
      expect(settings.updatedAt).toBeNull();
    });

    it('should return 401 for unauthenticated request', async () => {
      await request(app.getHttpServer()).get(USER_SETTINGS_PATH).expect(401);
    });

    it('should return 401 with an invalid token', async () => {
      await request(app.getHttpServer())
        .get(USER_SETTINGS_PATH)
        .set('Authorization', bearer('invalid-token'))
        .expect(401);
    });
  });

  // ════════════════════════════════════════════════════════════
  // PATCH /settings — existing tests
  // ════════════════════════════════════════════════════════════

  describe('PATCH /api/v1/user/settings', () => {
    it('should update a single setting and return the new state', async () => {
      const token = await makeToken();
      const response = await request(app.getHttpServer())
        .patch(USER_SETTINGS_PATH)
        .set('Authorization', bearer(token))
        .send({ aiSummariesEnabled: false })
        .expect(200);

      const settings = expectData(response.body as UserSettingsData);

      expect(settings.aiSummariesEnabled).toBe(false);
      expect(settings.dataSharingConsent).toBe(false);
      expect(settings.assistantEnabled).toBe(true);
      expect(settings.updatedAt).not.toBeNull();
    });

    it('should update multiple settings at once', async () => {
      const token = await makeToken();
      const response = await request(app.getHttpServer())
        .patch(USER_SETTINGS_PATH)
        .set('Authorization', bearer(token))
        .send({
          dataSharingConsent: true,
          assistantEnabled: false,
          assistantMemoryEnabled: false,
        })
        .expect(200);

      const settings = expectData(response.body as UserSettingsData);

      expect(settings.dataSharingConsent).toBe(true);
      expect(settings.assistantEnabled).toBe(false);
      expect(settings.assistantMemoryEnabled).toBe(false);
    });

    it('should update assistant context permissions', async () => {
      const token = await makeToken();
      const response = await request(app.getHttpServer())
        .patch(USER_SETTINGS_PATH)
        .set('Authorization', bearer(token))
        .send({
          assistantContext: {
            healthProfile: false,
            dailyRecords: false,
          },
        })
        .expect(200);

      const settings = expectData(response.body as UserSettingsData);

      expect(settings.assistantContext.healthProfile).toBe(false);
      expect(settings.assistantContext.dailyRecords).toBe(false);
      expect(settings.assistantContext.sleepRecords).toBe(true);
      expect(settings.assistantContext.currentMedicines).toBe(true);
    });

    it('should reject non-boolean values', async () => {
      const token = await makeToken();
      await request(app.getHttpServer())
        .patch(USER_SETTINGS_PATH)
        .set('Authorization', bearer(token))
        .send({ aiSummariesEnabled: 'not-a-boolean' })
        .expect(400);
    });
  });

  // ════════════════════════════════════════════════════════════
  // POST /settings/security-pin — Enable Security PIN
  // ════════════════════════════════════════════════════════════

  describe('POST /settings/security-pin (enable)', () => {
    it('should return 401 for unauthenticated request', async () => {
      await request(app.getHttpServer())
        .post(SECURITY_PIN_PATH)
        .send({ pin: TEST_PIN })
        .expect(401);
    });

    it('should reject invalid PIN format (non-6-digit)', async () => {
      const token = await makeToken();
      await request(app.getHttpServer())
        .post(SECURITY_PIN_PATH)
        .set('Authorization', bearer(token))
        .send({ pin: '12345' })
        .expect(400);
    });

    it('should reject non-numeric PIN', async () => {
      const token = await makeToken();
      await request(app.getHttpServer())
        .post(SECURITY_PIN_PATH)
        .set('Authorization', bearer(token))
        .send({ pin: 'abcdef' })
        .expect(400);
    });

    it('should enable Security PIN and reflect in settings', async () => {
      const token = await makeToken();
      const res = await request(app.getHttpServer())
        .post(SECURITY_PIN_PATH)
        .set('Authorization', bearer(token))
        .send({ pin: TEST_PIN })
        .expect(200);

      const settings = expectData(res.body as UserSettingsData);
      expect(settings.securityPin.enabled).toBe(true);
      expect(settings.securityPin.lastChangedAt).toBeTruthy();
    });
  });

  // ════════════════════════════════════════════════════════════
  // POST /settings/security-pin/verify — Verify PIN & get elevation
  // ════════════════════════════════════════════════════════════

  describe('POST /settings/security-pin/verify', () => {
    it('should return 401 for unauthenticated request', async () => {
      await request(app.getHttpServer())
        .post(SECURITY_PIN_VERIFY_PATH)
        .send({ pin: TEST_PIN })
        .expect(401);
    });

    it('should return elevation token with correct PIN', async () => {
      const token = await makeToken();
      const res = await request(app.getHttpServer())
        .post(SECURITY_PIN_VERIFY_PATH)
        .set('Authorization', bearer(token))
        .send({ pin: TEST_PIN })
        .expect(200);

      const data = expectData(res.body as ElevationResult);
      expect(data.elevationToken).toBeTruthy();
      expect(data.expiresAt).toBeTruthy();

      // Token should be a JWT (three base64 segments)
      const parts = data.elevationToken.split('.');
      expect(parts).toHaveLength(3);
    });

    it('should reject wrong PIN with 403 AUTH_ELEVATION_REQUIRED', async () => {
      const token = await makeToken();
      const res = await request(app.getHttpServer())
        .post(SECURITY_PIN_VERIFY_PATH)
        .set('Authorization', bearer(token))
        .send({ pin: WRONG_PIN })
        .expect(403);

      expect((res.body as Record<string, unknown>)['code']).toBe(
        'AUTH_ELEVATION_REQUIRED',
      );
    });

    it('should reject invalid PIN format with 400', async () => {
      const token = await makeToken();
      await request(app.getHttpServer())
        .post(SECURITY_PIN_VERIFY_PATH)
        .set('Authorization', bearer(token))
        .send({ pin: '12' })
        .expect(400);
    });
  });

  // ════════════════════════════════════════════════════════════
  // POST /settings/security-pin/change — Change PIN
  // ════════════════════════════════════════════════════════════

  describe('POST /settings/security-pin/change', () => {
    it('should return 401 for unauthenticated request', async () => {
      await request(app.getHttpServer())
        .post(SECURITY_PIN_CHANGE_PATH)
        .send({ oldPin: TEST_PIN, newPin: NEW_PIN })
        .expect(401);
    });

    it('should change PIN with correct old PIN', async () => {
      const token = await makeToken();
      const res = await request(app.getHttpServer())
        .post(SECURITY_PIN_CHANGE_PATH)
        .set('Authorization', bearer(token))
        .send({ oldPin: TEST_PIN, newPin: NEW_PIN })
        .expect(200);

      const settings = expectData(res.body as UserSettingsData);
      expect(settings.securityPin.enabled).toBe(true);
      expect(settings.securityPin.lastChangedAt).toBeTruthy();
    });

    it('should verify with the new PIN after change', async () => {
      const token = await makeToken();
      const res = await request(app.getHttpServer())
        .post(SECURITY_PIN_VERIFY_PATH)
        .set('Authorization', bearer(token))
        .send({ pin: NEW_PIN })
        .expect(200);

      const data = expectData(res.body as ElevationResult);
      expect(data.elevationToken).toBeTruthy();
    });

    it('should reject verify with the old PIN after change', async () => {
      const token = await makeToken();
      const res = await request(app.getHttpServer())
        .post(SECURITY_PIN_VERIFY_PATH)
        .set('Authorization', bearer(token))
        .send({ pin: TEST_PIN })
        .expect(403);

      expect((res.body as Record<string, unknown>)['code']).toBe(
        'AUTH_ELEVATION_REQUIRED',
      );
    });

    it('should reject change with wrong old PIN', async () => {
      const token = await makeToken();
      const res = await request(app.getHttpServer())
        .post(SECURITY_PIN_CHANGE_PATH)
        .set('Authorization', bearer(token))
        .send({ oldPin: WRONG_PIN, newPin: '111111' })
        .expect(403);

      expect((res.body as Record<string, unknown>)['code']).toBe(
        'AUTH_ELEVATION_REQUIRED',
      );
    });

    it('should reject invalid new PIN format', async () => {
      const token = await makeToken();
      await request(app.getHttpServer())
        .post(SECURITY_PIN_CHANGE_PATH)
        .set('Authorization', bearer(token))
        .send({ oldPin: NEW_PIN, newPin: 'abc' })
        .expect(400);
    });
  });

  // ════════════════════════════════════════════════════════════
  // POST /settings/security-pin/disable — Disable PIN
  // ════════════════════════════════════════════════════════════

  describe('POST /settings/security-pin/disable', () => {
    it('should return 401 for unauthenticated request', async () => {
      await request(app.getHttpServer())
        .post(SECURITY_PIN_DISABLE_PATH)
        .send({ pin: NEW_PIN })
        .expect(401);
    });

    it('should reject disable with wrong PIN', async () => {
      const token = await makeToken();
      const res = await request(app.getHttpServer())
        .post(SECURITY_PIN_DISABLE_PATH)
        .set('Authorization', bearer(token))
        .send({ pin: WRONG_PIN })
        .expect(403);

      expect((res.body as Record<string, unknown>)['code']).toBe(
        'AUTH_ELEVATION_REQUIRED',
      );
    });

    it('should disable PIN with correct PIN', async () => {
      const token = await makeToken();
      const res = await request(app.getHttpServer())
        .post(SECURITY_PIN_DISABLE_PATH)
        .set('Authorization', bearer(token))
        .send({ pin: NEW_PIN })
        .expect(200);

      const settings = expectData(res.body as UserSettingsData);
      expect(settings.securityPin.enabled).toBe(false);
      expect(settings.securityPin.lastChangedAt).toBeNull();
    });

    it('should reject verify after PIN is disabled (403)', async () => {
      const token = await makeToken();
      await request(app.getHttpServer())
        .post(SECURITY_PIN_VERIFY_PATH)
        .set('Authorization', bearer(token))
        .send({ pin: NEW_PIN })
        .expect(403);
    });
  });

  // ════════════════════════════════════════════════════════════
  // Security PIN — isolation: another user cannot interfere
  // ════════════════════════════════════════════════════════════

  describe('Security PIN — user isolation', () => {
    it('should not affect another user when one user enables PIN', async () => {
      // Main user enables PIN
      const mainToken = await makeToken();
      await request(app.getHttpServer())
        .post(SECURITY_PIN_PATH)
        .set('Authorization', bearer(mainToken))
        .send({ pin: TEST_PIN })
        .expect(200);

      // Create a second user
      const otherEmail = uniqueEmail('pin-isolation');
      const otherUser = await ctx.prisma.user.create({
        data: {
          email: otherEmail,
          passwordHash: '$argon2id$mock',
          status: UserStatus.active,
        },
      });
      const otherToken = await createAccessToken(
        ctx.jwtService,
        ctx.configService,
        otherUser.id,
        otherUser.email!,
      );

      // Other user's settings should show PIN disabled
      const res = await request(app.getHttpServer())
        .get(USER_SETTINGS_PATH)
        .set('Authorization', bearer(otherToken))
        .expect(200);

      const settings = expectData(res.body as UserSettingsData);
      expect(settings.securityPin.enabled).toBe(false);

      // Other user cannot verify (PIN not enabled → 403)
      await request(app.getHttpServer())
        .post(SECURITY_PIN_VERIFY_PATH)
        .set('Authorization', bearer(otherToken))
        .send({ pin: TEST_PIN })
        .expect(403);
    });
  });
});
