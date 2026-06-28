import { Test, type TestingModule } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import request from 'supertest';
import type { App } from 'supertest/types';

import { AppModule } from '../../../src/app.module';
import { setupApp } from '../../../src/setup-app';
import { PrismaService } from '../../../src/prisma/prisma.service';
import { ResultCode } from '../../../src/common/api-envelope';
import type { ApiEnvelope } from '../../../src/common/api-envelope';
import { ConfigKey } from '../../../src/config/config-keys.enum';
import { UserStatus } from '../../../src/generated/prisma/client';

const DASHBOARD_PATH = '/api/v1/user/reports/dashboard';
const AUTHORIZATION_HEADER = 'Authorization';
const BEARER_AUTH_SCHEME = 'Bearer';

function bearer(token: string): string {
  return `${BEARER_AUTH_SCHEME} ${token}`;
}

function expectData<T>(body: ApiEnvelope<T>): T {
  expect(body.data).not.toBeNull();
  return body.data as T;
}

describe('Reports API (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let jwtService: JwtService;
  let configService: ConfigService;
  let userId: string;
  let userEmail: string;
  let accessToken: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    setupApp(app, app.get(ConfigService));
    await app.init();

    prisma = app.get(PrismaService);
    jwtService = app.get(JwtService);
    configService = app.get(ConfigService);

    // Clean test data
    await prisma.userSetting.deleteMany();
    await prisma.userCurrentMedicine.deleteMany();
    await prisma.userCondition.deleteMany();
    await prisma.userAllergy.deleteMany();
    await prisma.userDailyRecord.deleteMany();
    await prisma.userSession.deleteMany();
    await prisma.user.deleteMany();

    // Create test user
    userEmail = `reports_${String(Date.now())}@example.com`;
    const user = await prisma.user.create({
      data: {
        email: userEmail,
        passwordHash: '$argon2id$mock',
        nickname: 'ReportsUser',
        status: UserStatus.active,
      },
    });
    userId = user.id;

    // Generate JWT
    const jwtCfg = configService.getOrThrow<{
      accessSecret: string;
      accessTtl: number;
      issuer: string;
      audience: string;
    }>(ConfigKey.Jwt);

    accessToken = await jwtService.signAsync(
      { sub: userId, email: userEmail },
      {
        secret: jwtCfg.accessSecret,
        expiresIn: jwtCfg.accessTtl,
        algorithm: 'HS512',
        issuer: jwtCfg.issuer,
        audience: jwtCfg.audience,
      },
    );
  });

  afterAll(async () => {
    await prisma.userSetting.deleteMany();
    await prisma.userCurrentMedicine.deleteMany();
    await prisma.userCondition.deleteMany();
    await prisma.userAllergy.deleteMany();
    await prisma.userDailyRecord.deleteMany();
    await prisma.userSession.deleteMany();
    await prisma.user.deleteMany();
    await app.close();
  });

  describe('GET /api/v1/user/reports/dashboard', () => {
    it('should return 401 without authorization', async () => {
      await request(app.getHttpServer()).get(DASHBOARD_PATH).expect(401);
    });

    it('should return dashboard for last_7_days by default', async () => {
      const response = await request(app.getHttpServer())
        .get(DASHBOARD_PATH)
        .set(AUTHORIZATION_HEADER, bearer(accessToken))
        .expect(200);

      const body = response.body as ApiEnvelope<{
        range: string;
        startDate: string;
        endDate: string;
        generatedAt: string;
        score: unknown;
        metrics: unknown;
        aiSummaryEnabled: boolean;
      }>;

      expect(body.code).toBe(ResultCode.SUCCESS);
      const data = expectData(body);
      expect(data.range).toBe('last_7_days');
      expect(data.startDate).toBeTruthy();
      expect(data.endDate).toBeTruthy();
      expect(data.generatedAt).toBeTruthy();
      expect(data.aiSummaryEnabled).toBeDefined();
    });

    it('should accept custom range parameter', async () => {
      const response = await request(app.getHttpServer())
        .get(`${DASHBOARD_PATH}?range=last_30_days`)
        .set(AUTHORIZATION_HEADER, bearer(accessToken))
        .expect(200);

      const data = expectData(response.body as ApiEnvelope<{ range: string }>);
      expect(data.range).toBe('last_30_days');
    });

    it('should accept custom date range', async () => {
      const response = await request(app.getHttpServer())
        .get(
          `${DASHBOARD_PATH}?range=custom&startDate=2026-06-01&endDate=2026-06-14`,
        )
        .set(AUTHORIZATION_HEADER, bearer(accessToken))
        .expect(200);

      const data = expectData(
        response.body as ApiEnvelope<{
          range: string;
          startDate: string;
          endDate: string;
        }>,
      );
      expect(data.range).toBe('custom');
      expect(data.startDate).toBe('2026-06-01');
      expect(data.endDate).toBe('2026-06-14');
    });

    it('should reject invalid date format', async () => {
      await request(app.getHttpServer())
        .get(`${DASHBOARD_PATH}?range=custom&startDate=invalid-date`)
        .set(AUTHORIZATION_HEADER, bearer(accessToken))
        .expect(400);
    });
  });

  describe('POST /api/v1/user/reports/summary/generate', () => {
    it('should return 401 without authorization', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/user/reports/summary/generate')
        .expect(401);
    });

    it('should accept generate request and return response (may be fallback)', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/v1/user/reports/summary/generate')
        .set(AUTHORIZATION_HEADER, bearer(accessToken))
        .send({ range: 'last_7_days' })
        .expect(201);

      const body = response.body as ApiEnvelope<{ summary?: string }>;
      expect(body.code).toBe(ResultCode.SUCCESS);
      expect(body.data).toBeDefined();
      // The AI summary may be a fallback when no API key is configured
    });
  });
});
