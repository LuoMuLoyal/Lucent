import request from 'supertest';

import type { ApiEnvelope } from '../../../src/common';
import { createTestApp, expectData } from '../../helpers/e2e-helpers';
import type { E2eTestContext, E2eApp } from '../../helpers/e2e-helpers';

const SUPPORT_RESOURCES_PATH = '/api/v1/public/support-resources';
const APP_INFO_PATH = '/api/v1/public/app-info';

describe('Support Resources API (e2e)', () => {
  let ctx: E2eTestContext;
  let app: E2eApp;

  beforeAll(async () => {
    ctx = await createTestApp();
    app = ctx.app;
  });

  afterAll(async () => {
    await app.close();
  });

  describe('GET /api/v1/public/support-resources', () => {
    it('should return help resources by default', async () => {
      const response = await request(app.getHttpServer())
        .get(SUPPORT_RESOURCES_PATH)
        .expect(200);

      const data = expectData(
        response.body as ApiEnvelope<{ items: unknown[] }>,
      );
      expect(Array.isArray(data.items)).toBe(true);
      expect(data.items.length).toBeGreaterThanOrEqual(1);
    });

    it('should filter resources by scope', async () => {
      const response = await request(app.getHttpServer())
        .get(`${SUPPORT_RESOURCES_PATH}?scope=help`)
        .expect(200);

      const data = expectData(
        response.body as ApiEnvelope<{ items: unknown[] }>,
      );
      expect(Array.isArray(data.items)).toBe(true);
    });

    it('should return 400 for invalid scope', async () => {
      await request(app.getHttpServer())
        .get(`${SUPPORT_RESOURCES_PATH}?scope=nonexistent`)
        .expect(400);
    });

    it('should return 400 for removed campus scope', async () => {
      await request(app.getHttpServer())
        .get(`${SUPPORT_RESOURCES_PATH}?scope=campus`)
        .expect(400);
    });
  });

  describe('GET /api/v1/public/app-info', () => {
    it('should return application metadata', async () => {
      const response = await request(app.getHttpServer())
        .get(APP_INFO_PATH)
        .expect(200);

      const data = expectData(
        response.body as ApiEnvelope<{
          minClientVersion: string | null;
          latestVersion: string | null;
          downloadUrl: string | null;
          supportEmail: string | null;
        }>,
      );
      // 契约只约束字段集合与可空类型，值由环境变量决定（测试环境通常为 null）。
      expect(Object.keys(data).sort()).toEqual([
        'downloadUrl',
        'latestVersion',
        'minClientVersion',
        'supportEmail',
      ]);
      for (const value of Object.values(data)) {
        expect(value === null || typeof value === 'string').toBe(true);
      }
    });
  });
});
