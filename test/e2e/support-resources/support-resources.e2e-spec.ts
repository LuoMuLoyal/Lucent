import request from 'supertest';

import type { ApiEnvelope } from '../../../src/common/api-envelope';
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

    it('should return campus resources when scoped', async () => {
      const response = await request(app.getHttpServer())
        .get(`${SUPPORT_RESOURCES_PATH}?scope=campus`)
        .expect(200);

      const data = expectData(
        response.body as ApiEnvelope<{ items: unknown[] }>,
      );
      expect(data.items.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('GET /api/v1/public/app-info', () => {
    it('should return application metadata', async () => {
      const response = await request(app.getHttpServer())
        .get(APP_INFO_PATH)
        .expect(200);

      const data = expectData(
        response.body as ApiEnvelope<{
          name: string;
          version: string;
          description: string;
          buildDate: string;
        }>,
      );
      expect(data.name).toBe('lucent');
      expect(data.version).toBeTruthy();
      expect(data.buildDate).toBeTruthy();
    });
  });
});
