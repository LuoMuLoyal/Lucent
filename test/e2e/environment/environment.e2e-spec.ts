import { Test, type TestingModule } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import request from 'supertest';
import type { App } from 'supertest/types';

import { AppModule } from '../../../src/app.module';
import { setupApp } from '../../../src/setup-app';
import type { ApiEnvelope } from '../../../src/common/api-envelope';

const ENV_PATH = '/api/v1/environment/snapshot';

function expectData<T>(body: ApiEnvelope<T>): T {
  expect(body.data).not.toBeNull();
  return body.data as T;
}

interface SnapshotData {
  dataSource: string;
  regionHint: string;
  pollen: { level: string; primaryType: string };
  uv: { index: number; level: string };
  airQuality: { level: string; primaryPollutant: string };
  temperature: { celsius: number };
  humidity: { percent: number };
}

describe('Environment API (e2e)', () => {
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

  it('GET /api/v1/environment/snapshot returns static baseline without coordinates', async () => {
    const response = await request(app.getHttpServer())
      .get(ENV_PATH)
      .expect(200);

    const data = expectData(response.body as ApiEnvelope<SnapshotData>);

    expect(data.dataSource).toBe('static');
    expect(data.regionHint).toBe('Global reference baseline');
    expect(data.pollen.level).toBe('medium');
    expect(data.pollen.primaryType).toBe('grass');
    expect(data.uv.index).toBe(6);
    expect(data.uv.level).toBe('high');
    expect(data.airQuality.level).toBe('moderate');
    expect(data.airQuality.primaryPollutant).toBe('pm2.5');
    expect(data.temperature.celsius).toBe(24);
    expect(data.humidity.percent).toBe(58);
  });

  it('GET /api/v1/environment/snapshot accepts lat/lon query parameters', async () => {
    const response = await request(app.getHttpServer())
      .get(`${ENV_PATH}?lat=31.2304&lon=121.4737`)
      .expect(200);

    const data = expectData(response.body as ApiEnvelope<SnapshotData>);

    expect(data.dataSource).toBe('static');
    expect(data.regionHint).toBe('China temperate latitude band');
    expect(data.uv.index).toBeGreaterThanOrEqual(0);
  });

  it('GET /api/v1/environment/snapshot rejects out-of-range latitude', async () => {
    await request(app.getHttpServer()).get(`${ENV_PATH}?lat=100`).expect(400);
  });

  it('GET /api/v1/environment/snapshot rejects out-of-range longitude', async () => {
    await request(app.getHttpServer()).get(`${ENV_PATH}?lon=200`).expect(400);
  });
});
