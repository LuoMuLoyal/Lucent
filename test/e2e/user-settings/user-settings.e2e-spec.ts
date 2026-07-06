import request from 'supertest';

import type { ApiEnvelope } from '../../../src/common/api';
import {
  createTestApp,
  cleanupDatabase,
  createTestUser,
  createAccessToken,
  bearer,
  expectData,
} from '../../helpers/e2e-helpers';
import type { E2eTestContext, E2eApp } from '../../helpers/e2e-helpers';

const USER_SETTINGS_PATH = '/api/v1/user/settings';

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
  updatedAt: string | null;
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

  describe('GET /api/v1/user/settings', () => {
    it('should return default settings for a new user', async () => {
      const token = await makeToken();
      const response = await request(app.getHttpServer())
        .get(USER_SETTINGS_PATH)
        .set('Authorization', bearer(token))
        .expect(200);

      const settings = expectData(
        response.body as ApiEnvelope<UserSettingsData>,
      );

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

  describe('PATCH /api/v1/user/settings', () => {
    it('should update a single setting and return the new state', async () => {
      const token = await makeToken();
      const response = await request(app.getHttpServer())
        .patch(USER_SETTINGS_PATH)
        .set('Authorization', bearer(token))
        .send({ aiSummariesEnabled: false })
        .expect(200);

      const settings = expectData(
        response.body as ApiEnvelope<UserSettingsData>,
      );

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

      const settings = expectData(
        response.body as ApiEnvelope<UserSettingsData>,
      );

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

      const settings = expectData(
        response.body as ApiEnvelope<UserSettingsData>,
      );

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
});
