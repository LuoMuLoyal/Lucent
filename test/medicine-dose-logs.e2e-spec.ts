/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-non-null-assertion, @typescript-eslint/no-explicit-any, @typescript-eslint/restrict-template-expressions */

import { Test, type TestingModule } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import request from 'supertest';
import type { App } from 'supertest/types';

import { AppModule } from '../src/app.module';
import { setupApp } from '../src/setup-app';
import { ResultCode } from '../src/common/api-envelope';
import type { ApiEnvelope } from '../src/common/api-envelope';
import { PrismaService } from '../src/prisma/prisma.service';
import {
  DoseLogStatus,
  MedicineSource,
  UserStatus,
} from '../src/generated/prisma/client';
import { ConfigKey } from '../src/config/config-keys.enum';

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
    }>(ConfigKey.Jwt);

    return jwtService.signAsync(
      { sub: userId, email },
      {
        secret: jwtConfig.accessSecret,
        expiresIn: jwtConfig.accessTtl,
        algorithm: 'HS512',
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
    const token = await createAccessToken(user.id, user.email);
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
    expect(createBody.data!.currentMedicineId).toBe(medicine.id);
    expect(createBody.data!.status).toBe(DoseLogStatus.taken);

    const listRes = await request(app.getHttpServer())
      .get(`${BASE_PATH}?date=2026-06-04`)
      .set(AUTH_HEADER, bearer(token))
      .expect(200);

    const listBody = listRes.body as ApiEnvelope<{ items: any[] }>;
    expect(listBody.code).toBe(ResultCode.SUCCESS);
    expect(listBody.data!.items).toHaveLength(1);
    expect(listBody.data!.items[0].id).toBe(createBody.data!.id);
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

    const id = (createRes.body as ApiEnvelope<{ id: string }>).data!.id;

    const updateRes = await request(app.getHttpServer())
      .patch(`${BASE_PATH}/${id}`)
      .set(AUTH_HEADER, bearer(token))
      .send({ status: DoseLogStatus.skipped })
      .expect(200);

    const body = updateRes.body as ApiEnvelope<{
      status: DoseLogStatus;
      doseText: string | null;
      note: string | null;
    }>;
    expect(body.data!.status).toBe(DoseLogStatus.skipped);
    expect(body.data!.doseText).toBe('1 tablet');
    expect(body.data!.note).toBe('keep this note');
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

    const id = (createRes.body as ApiEnvelope<{ id: string }>).data!.id;

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

    const id = (createRes.body as ApiEnvelope<{ id: string }>).data!.id;

    await request(app.getHttpServer())
      .delete(`${BASE_PATH}/${id}`)
      .set(AUTH_HEADER, bearer(token))
      .expect(200);

    const listRes = await request(app.getHttpServer())
      .get(`${BASE_PATH}?date=2026-06-04`)
      .set(AUTH_HEADER, bearer(token))
      .expect(200);

    const body = listRes.body as ApiEnvelope<{ items: any[] }>;
    expect(body.data!.items).toHaveLength(0);
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

    const id = (createRes.body as ApiEnvelope<{ id: string }>).data!.id;

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
