import request from 'supertest';

import type { ApiEnvelope } from '../../../src/common/api';
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

const BASE_PATH = '/api/v1/user/user-devices';

interface DeviceItemDto {
  id: string;
  platform: string;
  deviceName: string | null;
  notificationsEnabled: boolean;
  locale: string | null;
  timezone: string | null;
  lastSeenAt: string | null;
  createdAt: string;
  updatedAt: string;
}

describe('User Devices API (e2e)', () => {
  let ctx: E2eTestContext;
  let app: E2eApp;
  let user: TestUser;
  let accessToken: string;

  beforeAll(async () => {
    ctx = await createTestApp();
    app = ctx.app;
    await cleanupDatabase(ctx.prisma);

    user = await createTestUser(
      ctx.prisma,
      uniqueEmail('devices'),
      'DevicesUser',
    );
    accessToken = await createAccessToken(
      ctx.jwtService,
      ctx.configService,
      user.id,
      user.email,
    );
  });

  afterAll(async () => {
    await cleanupDatabase(ctx.prisma);
    await app.close();
  });

  // ════════════════════════════════════════════════════════════
  // POST /user-devices — Register
  // ════════════════════════════════════════════════════════════

  describe('POST /user-devices', () => {
    it('should return 401 for unauthenticated request', async () => {
      await request(app.getHttpServer())
        .post(BASE_PATH)
        .send({ pushToken: 'token-1', platform: 'ios' })
        .expect(401);
    });

    it('should return 400 for missing required fields', async () => {
      await request(app.getHttpServer())
        .post(BASE_PATH)
        .set('Authorization', bearer(accessToken))
        .send({ platform: 'ios' })
        .expect(400);
    });

    it('should return 400 for invalid platform', async () => {
      await request(app.getHttpServer())
        .post(BASE_PATH)
        .set('Authorization', bearer(accessToken))
        .send({ pushToken: 'token-1', platform: 'invalid-platform' })
        .expect(400);
    });

    it('should register a device and return 201', async () => {
      const res = await request(app.getHttpServer())
        .post(BASE_PATH)
        .set('Authorization', bearer(accessToken))
        .send({
          pushToken: 'push-token-e2e-1',
          platform: 'ios',
          deviceName: 'iPhone 15 Pro',
          locale: 'zh-CN',
          timezone: 'Asia/Shanghai',
          notificationsEnabled: true,
        })
        .expect(201);

      const data = expectData(res.body as ApiEnvelope<DeviceItemDto>);
      expect(data.id).toBeTruthy();
      expect(data.platform).toBe('ios');
      expect(data.deviceName).toBe('iPhone 15 Pro');
      expect(data.notificationsEnabled).toBe(true);
      expect(data.locale).toBe('zh-CN');
      expect(data.timezone).toBe('Asia/Shanghai');
      expect(data.lastSeenAt).toBeTruthy();
      expect(data.createdAt).toBeTruthy();
      expect(data.updatedAt).toBeTruthy();
    });

    it('should upsert device by pushToken (update existing instead of creating duplicate)', async () => {
      // First registration
      await request(app.getHttpServer())
        .post(BASE_PATH)
        .set('Authorization', bearer(accessToken))
        .send({
          pushToken: 'push-token-e2e-upsert',
          platform: 'android',
          deviceName: 'Pixel 8',
        })
        .expect(201);

      // Second registration with same token — should update, not duplicate
      const res = await request(app.getHttpServer())
        .post(BASE_PATH)
        .set('Authorization', bearer(accessToken))
        .send({
          pushToken: 'push-token-e2e-upsert',
          platform: 'android',
          deviceName: 'Pixel 8 Pro',
          notificationsEnabled: true,
        })
        .expect(201);

      const data = expectData(res.body as ApiEnvelope<DeviceItemDto>);
      expect(data.deviceName).toBe('Pixel 8 Pro');
      expect(data.notificationsEnabled).toBe(true);
    });
  });

  // ════════════════════════════════════════════════════════════
  // GET /user-devices — List
  // ════════════════════════════════════════════════════════════

  describe('GET /user-devices', () => {
    it('should return 401 for unauthenticated request', async () => {
      await request(app.getHttpServer()).get(BASE_PATH).expect(401);
    });

    it('should return list of registered devices', async () => {
      const res = await request(app.getHttpServer())
        .get(BASE_PATH)
        .set('Authorization', bearer(accessToken))
        .expect(200);

      const data = expectData(
        res.body as ApiEnvelope<{ items: DeviceItemDto[] }>,
      );
      expect(Array.isArray(data.items)).toBe(true);
      // At least the two devices we registered (token-1 and upsert)
      expect(data.items.length).toBeGreaterThanOrEqual(2);
    });

    it('should return empty list for a new user with no devices', async () => {
      const newUser = await createTestUser(
        ctx.prisma,
        uniqueEmail('devices-empty'),
        'NoDevicesUser',
      );
      const newToken = await createAccessToken(
        ctx.jwtService,
        ctx.configService,
        newUser.id,
        newUser.email,
      );

      const res = await request(app.getHttpServer())
        .get(BASE_PATH)
        .set('Authorization', bearer(newToken))
        .expect(200);

      const data = expectData(
        res.body as ApiEnvelope<{ items: DeviceItemDto[] }>,
      );
      expect(data.items).toHaveLength(0);
    });
  });

  // ════════════════════════════════════════════════════════════
  // DELETE /user-devices/:id — Remove
  // ════════════════════════════════════════════════════════════

  describe('DELETE /user-devices/:id', () => {
    it('should return 401 for unauthenticated request', async () => {
      await request(app.getHttpServer())
        .delete(`${BASE_PATH}/some-id`)
        .expect(401);
    });

    it('should delete a device and return 204', async () => {
      // Register a device to delete
      const createRes = await request(app.getHttpServer())
        .post(BASE_PATH)
        .set('Authorization', bearer(accessToken))
        .send({
          pushToken: 'push-token-e2e-delete',
          platform: 'web',
        })
        .expect(201);

      const device = expectData(createRes.body as ApiEnvelope<DeviceItemDto>);

      // Delete it
      await request(app.getHttpServer())
        .delete(`${BASE_PATH}/${device.id}`)
        .set('Authorization', bearer(accessToken))
        .expect(204);

      // Verify it's gone from the list
      const listRes = await request(app.getHttpServer())
        .get(BASE_PATH)
        .set('Authorization', bearer(accessToken))
        .expect(200);

      const list = expectData(
        listRes.body as ApiEnvelope<{ items: DeviceItemDto[] }>,
      );
      expect(list.items.find((d) => d.id === device.id)).toBeUndefined();
    });

    it('should return 404 for non-existent device id', async () => {
      await request(app.getHttpServer())
        .delete(`${BASE_PATH}/non-existent-id`)
        .set('Authorization', bearer(accessToken))
        .expect(404);
    });

    it('should return 403 when deleting another user device', async () => {
      // Register a device as the main user
      const createRes = await request(app.getHttpServer())
        .post(BASE_PATH)
        .set('Authorization', bearer(accessToken))
        .send({
          pushToken: 'push-token-e2e-cross-user',
          platform: 'ios',
        })
        .expect(201);

      const device = expectData(createRes.body as ApiEnvelope<DeviceItemDto>);

      // Create a second user
      const otherUser = await createTestUser(
        ctx.prisma,
        uniqueEmail('devices-other'),
        'OtherUser',
      );
      const otherToken = await createAccessToken(
        ctx.jwtService,
        ctx.configService,
        otherUser.id,
        otherUser.email,
      );

      // Other user tries to delete — should be forbidden (403)
      await request(app.getHttpServer())
        .delete(`${BASE_PATH}/${device.id}`)
        .set('Authorization', bearer(otherToken))
        .expect(403);

      // Verify the device still exists for the original user
      const listRes = await request(app.getHttpServer())
        .get(BASE_PATH)
        .set('Authorization', bearer(accessToken))
        .expect(200);

      const list = expectData(
        listRes.body as ApiEnvelope<{ items: DeviceItemDto[] }>,
      );
      expect(list.items.find((d) => d.id === device.id)).toBeDefined();
    });

    it('should return 403 when registering a pushToken owned by another user', async () => {
      // Register a device as the main user
      await request(app.getHttpServer())
        .post(BASE_PATH)
        .set('Authorization', bearer(accessToken))
        .send({
          pushToken: 'push-token-e2e-hijack',
          platform: 'ios',
        })
        .expect(201);

      // Create a second user
      const otherUser = await createTestUser(
        ctx.prisma,
        uniqueEmail('devices-hijack'),
        'HijackUser',
      );
      const otherToken = await createAccessToken(
        ctx.jwtService,
        ctx.configService,
        otherUser.id,
        otherUser.email,
      );

      // Other user tries to register with the same pushToken — should be forbidden
      await request(app.getHttpServer())
        .post(BASE_PATH)
        .set('Authorization', bearer(otherToken))
        .send({
          pushToken: 'push-token-e2e-hijack',
          platform: 'android',
        })
        .expect(403);
    });
  });
});
