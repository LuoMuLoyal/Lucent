import { Test, type TestingModule } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import request from 'supertest';
import type { App } from 'supertest/types';

import { AppModule } from '../../../src/app.module';
import { setupApp } from '../../../src/setup-app';
import type { ApiEnvelope } from '../../../src/common/api-envelope';

const SUPPORT_RESOURCES_PATH = '/api/v1/public/support-resources';
const APP_INFO_PATH = '/api/v1/public/app-info';

function expectData<T>(body: ApiEnvelope<T>): T {
  expect(body.data).not.toBeNull();
  return body.data as T;
}

describe('Support Resources API (e2e)', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    setupApp(app, app.get(ConfigService));
    await app.init();
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
