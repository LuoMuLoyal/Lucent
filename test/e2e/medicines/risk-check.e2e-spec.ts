import { Test, type TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { FastifyAdapter } from '@nestjs/platform-fastify';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import request from 'supertest';

import { AppModule } from '../../../src/app.module.js';
import { setupApp } from '../../../src/setup-app.js';
import { PrismaService } from '../../../src/prisma/index.js';
import {
  bearer,
  cleanupDatabase,
  createAccessToken,
  createTestUser,
  type TestUser,
} from '../../helpers/e2e-helpers.js';

const RISK_CHECK_PATH = '/api/v1/medicines/risk-check';
const AUTH_HEADER = 'Authorization';

interface RiskCheckRecord {
  checkType: 'static' | 'llm';
  result: Record<string, unknown>;
  riskScore: number;
  riskLevel: string;
  stale: boolean;
}

interface RiskCheckRecordsData {
  static: RiskCheckRecord | null;
  llm: RiskCheckRecord | null;
}

function expectData<T>(body: T): T {
  expect(body).not.toBeNull();
  return body as T;
}

describe('Medicine Risk Check API (e2e)', () => {
  let app: NestFastifyApplication;
  let prisma: PrismaService;
  let jwtService: JwtService;
  let configService: ConfigService;
  let user: TestUser;
  let token: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication<NestFastifyApplication>(
      new FastifyAdapter({ trustProxy: true }),
      { bodyParser: false },
    );
    await setupApp(app, app.get(ConfigService));
    await app.init();
    await app.getHttpAdapter().getInstance().ready();

    prisma = app.get(PrismaService);
    jwtService = app.get(JwtService);
    configService = app.get(ConfigService);

    await cleanupDatabase(prisma);
    await prisma.medicineRiskCheckRecord.deleteMany();

    user = await createTestUser(prisma);
    token = await createAccessToken(
      jwtService,
      configService,
      user.id,
      user.email,
    );
  });

  afterAll(async () => {
    await prisma.medicineRiskCheckRecord.deleteMany();
    await cleanupDatabase(prisma);
    await app.close();
  });

  beforeEach(async () => {
    await prisma.medicineRiskCheckRecord.deleteMany();
  });

  it('rejects unauthenticated GET', async () => {
    const res = await request(app.getHttpServer()).get(RISK_CHECK_PATH);
    expect(res.statusCode).toBe(401);
  });

  it('rejects unauthenticated POST', async () => {
    const res = await request(app.getHttpServer())
      .post(RISK_CHECK_PATH)
      .send({ type: 'static' });
    expect(res.statusCode).toBe(401);
  });

  it('returns empty records on first GET', async () => {
    const res = await request(app.getHttpServer())
      .get(RISK_CHECK_PATH)
      .set(AUTH_HEADER, bearer(token))
      .expect(200);

    const body = res.body as RiskCheckRecordsData;
    const data = expectData(body);
    expect(data.static).toBeNull();
    expect(data.llm).toBeNull();
  });

  it('runs a static check, persists the record, and serves it on next GET', async () => {
    const run = await request(app.getHttpServer())
      .post(RISK_CHECK_PATH)
      .set(AUTH_HEADER, bearer(token))
      .send({ type: 'static' })
      .expect(200);

    const runBody = run.body as RiskCheckRecord;
    const record = expectData(runBody);
    expect(record.checkType).toBe('static');
    expect(typeof record.riskScore).toBe('number');

    const next = await request(app.getHttpServer())
      .get(RISK_CHECK_PATH)
      .set(AUTH_HEADER, bearer(token))
      .expect(200);

    const nextBody = next.body as RiskCheckRecordsData;
    expect(expectData(nextBody).static?.checkType).toBe('static');
  });

  it('returns a service error for LLM check when the analysis model is not configured', async () => {
    const res = await request(app.getHttpServer())
      .post(RISK_CHECK_PATH)
      .set(AUTH_HEADER, bearer(token))
      .send({ type: 'llm' });

    // 测试环境未配置 analysis 模型角色 → 服务抛错 → 5xx
    expect(res.statusCode).toBeGreaterThanOrEqual(500);
  });
});
