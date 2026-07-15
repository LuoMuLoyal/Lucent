import { Test, type TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { FastifyAdapter } from '@nestjs/platform-fastify';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import request from 'supertest';

import { AppModule } from '../../../src/app.module';
import { setupApp } from '../../../src/setup-app';
import { ResultCode } from '../../../src/common/api';
import type { ApiEnvelope } from '../../../src/common/api';
import { DailyRecordKind } from '#generated/prisma/client';

const TESTING_PATH = '/api/v1/testing/fullstack-e2e/record-lane/prepare';
const LOGIN_PATH = '/api/v1/auth/login';
const DAILY_RECORDS_PATH = '/api/v1/user/daily-records';
const USER_SETTINGS_PATH = '/api/v1/user/settings';
const AUTHORIZATION_HEADER = 'Authorization';
const BEARER = 'Bearer';

const TEST_EMAIL = 'fullstack-record-lane@example.com';
const TEST_PASSWORD = 'RecordLane123';
const TEST_DATE = '2026-06-12';
const TEST_NICKNAME = 'Record Lane User';

function bearer(accessToken: string): string {
  return `${BEARER} ${accessToken}`;
}

function expectData<T>(body: ApiEnvelope<T>): T {
  expect(body.data).not.toBeNull();
  return body.data as T;
}

describe('Testing Support API (e2e)', () => {
  let app: NestFastifyApplication;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication<NestFastifyApplication>(
      new FastifyAdapter(),
    );
    await setupApp(app, app.get(ConfigService));
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('should prepare a repeatable full-stack record lane user state', async () => {
    const preparePayload = {
      email: TEST_EMAIL,
      password: TEST_PASSWORD,
      date: TEST_DATE,
      nickname: TEST_NICKNAME,
    };

    const firstPrepareRes = await request(app.getHttpServer())
      .post(TESTING_PATH)
      .send(preparePayload)
      .expect(200);

    const firstPrepareBody = firstPrepareRes.body as ApiEnvelope<{
      createdUser: boolean;
      userId: string;
      email: string;
      nickname: string | null;
      date: string;
      clearedRecordCount: number;
    }>;
    expect(firstPrepareBody.code).toBe(ResultCode.SUCCESS);
    const firstPrepareData = expectData(firstPrepareBody);
    expect(firstPrepareData.email).toBe(TEST_EMAIL);
    expect(firstPrepareData.nickname).toBe(TEST_NICKNAME);
    expect(firstPrepareData.date).toBe(TEST_DATE);
    expect(firstPrepareData.clearedRecordCount).toBe(0);

    const loginRes = await request(app.getHttpServer())
      .post(LOGIN_PATH)
      .send({ email: TEST_EMAIL, password: TEST_PASSWORD })
      .expect(200);

    const loginBody = loginRes.body as ApiEnvelope<{
      tokens: { accessToken: string };
    }>;
    expect(loginBody.code).toBe(ResultCode.SUCCESS);
    const accessToken = expectData(loginBody).tokens.accessToken;

    const initialListRes = await request(app.getHttpServer())
      .get(`${DAILY_RECORDS_PATH}?date=${TEST_DATE}`)
      .set(AUTHORIZATION_HEADER, bearer(accessToken))
      .expect(200);

    const initialListBody = initialListRes.body as ApiEnvelope<{
      items: any[];
      total: number;
    }>;
    expect(expectData(initialListBody).items).toHaveLength(0);

    await request(app.getHttpServer())
      .post(DAILY_RECORDS_PATH)
      .set(AUTHORIZATION_HEADER, bearer(accessToken))
      .send({
        kind: DailyRecordKind.water,
        occurredAt: TEST_DATE,
        value: '2',
        unit: 'cups',
      })
      .expect(201);

    const disableAiRes = await request(app.getHttpServer())
      .patch(USER_SETTINGS_PATH)
      .set(AUTHORIZATION_HEADER, bearer(accessToken))
      .send({ aiSummariesEnabled: false })
      .expect(200);

    const disableAiBody = disableAiRes.body as ApiEnvelope<{
      aiSummariesEnabled: boolean;
      dataSharingConsent: boolean;
      updatedAt: string | null;
    }>;
    expect(expectData(disableAiBody).aiSummariesEnabled).toBe(false);

    const createdListRes = await request(app.getHttpServer())
      .get(`${DAILY_RECORDS_PATH}?date=${TEST_DATE}`)
      .set(AUTHORIZATION_HEADER, bearer(accessToken))
      .expect(200);

    const createdListBody = createdListRes.body as ApiEnvelope<{
      items: any[];
      total: number;
    }>;
    expect(expectData(createdListBody).items).toHaveLength(1);

    const secondPrepareRes = await request(app.getHttpServer())
      .post(TESTING_PATH)
      .send(preparePayload)
      .expect(200);

    const secondPrepareBody = secondPrepareRes.body as ApiEnvelope<{
      createdUser: boolean;
      userId: string;
      email: string;
      nickname: string | null;
      date: string;
      clearedRecordCount: number;
    }>;
    expect(secondPrepareBody.code).toBe(ResultCode.SUCCESS);
    const secondPrepareData = expectData(secondPrepareBody);
    expect(secondPrepareData.createdUser).toBe(false);
    expect(secondPrepareData.userId).toBe(firstPrepareData.userId);
    expect(secondPrepareData.clearedRecordCount).toBe(1);

    const secondLoginRes = await request(app.getHttpServer())
      .post(LOGIN_PATH)
      .send({ email: TEST_EMAIL, password: TEST_PASSWORD })
      .expect(200);

    const secondLoginBody = secondLoginRes.body as ApiEnvelope<{
      tokens: { accessToken: string };
    }>;
    const refreshedAccessToken = expectData(secondLoginBody).tokens.accessToken;

    const resetListRes = await request(app.getHttpServer())
      .get(`${DAILY_RECORDS_PATH}?date=${TEST_DATE}`)
      .set(AUTHORIZATION_HEADER, bearer(refreshedAccessToken))
      .expect(200);

    const resetListBody = resetListRes.body as ApiEnvelope<{
      items: any[];
      total: number;
    }>;
    expect(expectData(resetListBody).items).toHaveLength(0);

    const resetSettingsRes = await request(app.getHttpServer())
      .get(USER_SETTINGS_PATH)
      .set(AUTHORIZATION_HEADER, bearer(refreshedAccessToken))
      .expect(200);

    const resetSettingsBody = resetSettingsRes.body as ApiEnvelope<{
      aiSummariesEnabled: boolean;
      dataSharingConsent: boolean;
      updatedAt: string | null;
    }>;
    expect(expectData(resetSettingsBody).aiSummariesEnabled).toBe(true);
  });
});
