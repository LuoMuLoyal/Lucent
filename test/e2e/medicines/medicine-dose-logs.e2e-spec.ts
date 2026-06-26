/* eslint-disable @typescript-eslint/restrict-template-expressions */

import { Test, type TestingModule } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import request from 'supertest';
import type { App } from 'supertest/types';

import { AppModule } from '../../../src/app.module';
import { setupApp } from '../../../src/setup-app';
import { ResultCode } from '../../../src/common/api-envelope';
import type { ApiEnvelope } from '../../../src/common/api-envelope';
import { PrismaService } from '../../../src/prisma/prisma.service';
import {
  DoseLogStatus,
  MedicineSource,
  UserStatus,
} from '../../../src/generated/prisma/client';
import { ConfigKey } from '../../../src/config/config-keys.enum';

const BASE_PATH = '/api/v1/user/medicine-dose-logs';
const AUTH_HEADER = 'Authorization';
const BEARER = 'Bearer';

let seededSeq = 0;

function uniqueEmail(): string {
  seededSeq += 1;
  return `doselog${seededSeq}_${Date.now()}@example.com`;
}

function bearer(token: string): string {
  return `${BEARER} ${token}`;
}

function expectDefined<T>(value: T | undefined | null, message: string): T {
  expect(value).toBeDefined();
  expect(value).not.toBeNull();
  if (value == null) {
    throw new Error(message);
  }
  return value;
}

function expectData<T>(body: ApiEnvelope<T>): T {
  expect(body.data).not.toBeNull();
  return expectDefined(body.data, 'Expected envelope data');
}

describe('Medicine Dose Logs API (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let jwtService: JwtService;
  let configService: ConfigService;

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

    await cleanUserDoseLogData();
  });

  afterAll(async () => {
    await cleanUserDoseLogData();
    await app.close();
  });

  async function cleanUserDoseLogData() {
    await prisma.userMedicineDoseLog.deleteMany();
    await prisma.userDailyRecord.deleteMany();
    await prisma.userCurrentMedicine.deleteMany();
    await prisma.userCondition.deleteMany();
    await prisma.userAllergy.deleteMany();
    await prisma.userSession.deleteMany();
    await prisma.user.deleteMany();
  }

  async function createAccessToken(userId: string, email: string) {
    const jwtConfig = configService.getOrThrow<{
      accessSecret: string;
      accessTtl: number;
      issuer: string;
      audience: string;
    }>(ConfigKey.Jwt);

    return jwtService.signAsync(
      { sub: userId, email },
      {
        secret: jwtConfig.accessSecret,
        expiresIn: jwtConfig.accessTtl,
        algorithm: 'HS512',
        issuer: jwtConfig.issuer,
        audience: jwtConfig.audience,
      },
    );
  }

  async function createUserWithToken() {
    const user = await prisma.user.create({
      data: {
        email: uniqueEmail(),
        passwordHash: '$argon2id$mock',
        status: UserStatus.active,
      },
    });
    const token = await createAccessToken(
      user.id,
      expectDefined(user.email, 'Expected user email'),
    );
    return { user, token };
  }

  async function createCurrentMedicine(
    userId: string,
    displayName = 'Metformin',
  ) {
    return prisma.userCurrentMedicine.create({
      data: {
        userId,
        source: MedicineSource.manual,
        displayName,
        doseText: '1 tablet',
      },
    });
  }

  it('should create and list linked dose logs', async () => {
    const { user, token } = await createUserWithToken();
    const medicine = await createCurrentMedicine(user.id);

    const createRes = await request(app.getHttpServer())
      .post(BASE_PATH)
      .set(AUTH_HEADER, bearer(token))
      .send({
        currentMedicineId: medicine.id,
        status: DoseLogStatus.taken,
        scheduledFor: '2026-06-04',
        doseText: '1 tablet',
        note: 'with breakfast',
      })
      .expect(201);

    const createBody = createRes.body as ApiEnvelope<{
      id: string;
      currentMedicineId: string;
      status: DoseLogStatus;
    }>;
    expect(createBody.code).toBe(ResultCode.SUCCESS);
    const created = expectData(createBody);
    expect(created.currentMedicineId).toBe(medicine.id);
    expect(created.status).toBe(DoseLogStatus.taken);

    const listRes = await request(app.getHttpServer())
      .get(`${BASE_PATH}?date=2026-06-04`)
      .set(AUTH_HEADER, bearer(token))
      .expect(200);

    const listEnvelope = listRes.body as ApiEnvelope<{
      items: Array<{ id: string }>;
    }>;
    expect(listEnvelope.code).toBe(ResultCode.SUCCESS);
    const listBody = expectData(listEnvelope);
    expect(listBody.items).toHaveLength(1);
    expect(listBody.items[0]?.id).toBe(created.id);
  });

  it('should reject dose logs linked to another user medicine', async () => {
    const { token } = await createUserWithToken();
    const { user: otherUser } = await createUserWithToken();
    const otherMedicine = await createCurrentMedicine(otherUser.id);

    await request(app.getHttpServer())
      .post(BASE_PATH)
      .set(AUTH_HEADER, bearer(token))
      .send({
        currentMedicineId: otherMedicine.id,
        status: DoseLogStatus.taken,
        scheduledFor: '2026-06-04',
      })
      .expect(404);
  });

  it('should update status without clearing omitted nullable fields', async () => {
    const { user, token } = await createUserWithToken();
    const medicine = await createCurrentMedicine(user.id);

    const createRes = await request(app.getHttpServer())
      .post(BASE_PATH)
      .set(AUTH_HEADER, bearer(token))
      .send({
        currentMedicineId: medicine.id,
        status: DoseLogStatus.planned,
        scheduledFor: '2026-06-04',
        doseText: '1 tablet',
        note: 'keep this note',
      })
      .expect(201);

    const id = expectData(createRes.body as ApiEnvelope<{ id: string }>).id;

    const updateRes = await request(app.getHttpServer())
      .patch(`${BASE_PATH}/${id}`)
      .set(AUTH_HEADER, bearer(token))
      .send({ status: DoseLogStatus.skipped })
      .expect(200);

    const body = expectData(
      updateRes.body as ApiEnvelope<{
        status: DoseLogStatus;
        doseText: string | null;
        note: string | null;
      }>,
    );
    expect(body.status).toBe(DoseLogStatus.skipped);
    expect(body.doseText).toBe('1 tablet');
    expect(body.note).toBe('keep this note');
  });

  it('should clear nullable fields when null is sent', async () => {
    const { user, token } = await createUserWithToken();
    const medicine = await createCurrentMedicine(user.id);

    const createRes = await request(app.getHttpServer())
      .post(BASE_PATH)
      .set(AUTH_HEADER, bearer(token))
      .send({
        currentMedicineId: medicine.id,
        status: DoseLogStatus.taken,
        scheduledFor: '2026-06-04',
        doseText: '1 tablet',
        note: 'clear me',
      })
      .expect(201);

    const id = expectData(createRes.body as ApiEnvelope<{ id: string }>).id;

    await request(app.getHttpServer())
      .patch(`${BASE_PATH}/${id}`)
      .set(AUTH_HEADER, bearer(token))
      .send({ doseText: null, note: null })
      .expect(200);

    const stored = await prisma.userMedicineDoseLog.findUniqueOrThrow({
      where: { id },
    });
    expect(stored.doseText).toBeNull();
    expect(stored.note).toBeNull();
  });

  it('should soft-delete dose logs', async () => {
    const { token } = await createUserWithToken();

    const createRes = await request(app.getHttpServer())
      .post(BASE_PATH)
      .set(AUTH_HEADER, bearer(token))
      .send({
        status: DoseLogStatus.planned,
        scheduledFor: '2026-06-04',
      })
      .expect(201);

    const id = expectData(createRes.body as ApiEnvelope<{ id: string }>).id;

    await request(app.getHttpServer())
      .delete(`${BASE_PATH}/${id}`)
      .set(AUTH_HEADER, bearer(token))
      .expect(200);

    const listRes = await request(app.getHttpServer())
      .get(`${BASE_PATH}?date=2026-06-04`)
      .set(AUTH_HEADER, bearer(token))
      .expect(200);

    const body = expectData(listRes.body as ApiEnvelope<{ items: unknown[] }>);
    expect(body.items).toHaveLength(0);
  });

  it('should return 404 for foreign dose-log updates', async () => {
    const { token } = await createUserWithToken();
    const { token: otherToken } = await createUserWithToken();

    const createRes = await request(app.getHttpServer())
      .post(BASE_PATH)
      .set(AUTH_HEADER, bearer(token))
      .send({
        status: DoseLogStatus.planned,
        scheduledFor: '2026-06-04',
      })
      .expect(201);

    const id = expectData(createRes.body as ApiEnvelope<{ id: string }>).id;

    await request(app.getHttpServer())
      .patch(`${BASE_PATH}/${id}`)
      .set(AUTH_HEADER, bearer(otherToken))
      .send({ status: DoseLogStatus.taken })
      .expect(404);
  });

  it('should require auth', async () => {
    await request(app.getHttpServer())
      .get(`${BASE_PATH}?date=2026-06-04`)
      .expect(401);
  });
});
