import request from 'supertest';

import type { ApiEnvelope } from '../../../src/common/api-envelope';
import { createTestApp, expectData } from '../../helpers/e2e-helpers';
import type { E2eTestContext, E2eApp } from '../../helpers/e2e-helpers';

const ENV_PATH = '/api/v1/environment/snapshot';

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
  let ctx: E2eTestContext;
  let app: E2eApp;

  beforeAll(async () => {
    ctx = await createTestApp();
    app = ctx.app;
  });

  afterAll(async () => {
    await app.close();
  });

  it('should return static baseline snapshot without coordinates', async () => {
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

  it('should accept lat/lon query parameters', async () => {
    const response = await request(app.getHttpServer())
      .get(`${ENV_PATH}?lat=31.2304&lon=121.4737`)
      .expect(200);

    const data = expectData(response.body as ApiEnvelope<SnapshotData>);

    expect(data.dataSource).toBe('static');
    expect(data.regionHint).toBe('China temperate latitude band');
    expect(data.uv.index).toBeGreaterThanOrEqual(0);
  });

  it('should reject out-of-range latitude', async () => {
    await request(app.getHttpServer()).get(`${ENV_PATH}?lat=100`).expect(400);
  });

  it('should reject out-of-range longitude', async () => {
    await request(app.getHttpServer()).get(`${ENV_PATH}?lon=200`).expect(400);
  });
});
