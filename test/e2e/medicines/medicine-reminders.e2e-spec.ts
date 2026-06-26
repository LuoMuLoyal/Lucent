/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-non-null-assertion, @typescript-eslint/no-explicit-any, @typescript-eslint/restrict-template-expressions */

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
  MedicineSource,
  UserStatus,
} from '../../../src/generated/prisma/client';
import { ConfigKey } from '../../../src/config/config-keys.enum';

const BASE_PATH = '/api/v1/user/medicine-reminders';
const AUTH_HEADER = 'Authorization';
const BEARER = 'Bearer';

let seededSeq = 0;

function uniqueEmail(): string {
  seededSeq += 1;
  return `reminder${seededSeq}_${Date.now()}@example.com`;
}

function bearer(token: string): string {
  return `${BEARER} ${token}`;
}

describe('Medicine Reminders API (e2e)', () => {
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

    await cleanUserReminderData();
  });

  afterAll(async () => {
    await cleanUserReminderData();
    await app.close();
  });

  async function cleanUserReminderData() {
    await prisma.userMedicineReminder.deleteMany();
    await prisma.userMedicineDoseLog.deleteMany();
    await prisma.userDailyRecord.deleteMany();
    await prisma.userCurrentMedicine.deleteMany();
    await prisma.userCondition.deleteMany();
    await prisma.userAllergy.deleteMany();
    await prisma.userSession.deleteMany();
    await prisma.user.deleteMany();
  }

  async function createAccessToken(userId: string, email: string | null) {
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

  it('should create and list linked reminders', async () => {
    const { user, token } = await createUserWithToken();
    const medicine = await createCurrentMedicine(user.id);

    const createRes = await request(app.getHttpServer())
      .post(BASE_PATH)
      .set(AUTH_HEADER, bearer(token))
      .send({
        currentMedicineId: medicine.id,
        label: ' Morning dose ',
        scheduledHour: 8,
        scheduledMinute: 30,
        daysOfWeek: [5, 1, 3, 1],
        note: ' After breakfast ',
      })
      .expect(201);

    const createBody = createRes.body as ApiEnvelope<{
      id: string;
      currentMedicineId: string;
      label: string;
      scheduledHour: number;
      scheduledMinute: number;
      daysOfWeek: number[];
      note: string;
    }>;
    expect(createBody.code).toBe(ResultCode.SUCCESS);
    expect(createBody.data!.currentMedicineId).toBe(medicine.id);
    expect(createBody.data!.label).toBe('Morning dose');
    expect(createBody.data!.daysOfWeek).toEqual([1, 3, 5]);
    expect(createBody.data!.note).toBe('After breakfast');

    const listRes = await request(app.getHttpServer())
      .get(BASE_PATH)
      .set(AUTH_HEADER, bearer(token))
      .expect(200);

    const listBody = listRes.body as ApiEnvelope<{ items: any[] }>;
    expect(listBody.code).toBe(ResultCode.SUCCESS);
    expect(listBody.data!.items).toHaveLength(1);
    expect(listBody.data!.items[0].id).toBe(createBody.data!.id);
  });

  it('should treat null weekdays as every day', async () => {
    const { token } = await createUserWithToken();

    const createRes = await request(app.getHttpServer())
      .post(BASE_PATH)
      .set(AUTH_HEADER, bearer(token))
      .send({
        scheduledHour: 21,
        scheduledMinute: 0,
        daysOfWeek: null,
      })
      .expect(201);

    const body = createRes.body as ApiEnvelope<{ daysOfWeek: number[] | null }>;
    expect(body.data!.daysOfWeek).toBeNull();
  });

  it('should honor activeOnly query', async () => {
    const { token } = await createUserWithToken();

    await request(app.getHttpServer())
      .post(BASE_PATH)
      .set(AUTH_HEADER, bearer(token))
      .send({
        label: 'Active',
        scheduledHour: 8,
        scheduledMinute: 0,
      })
      .expect(201);

    await request(app.getHttpServer())
      .post(BASE_PATH)
      .set(AUTH_HEADER, bearer(token))
      .send({
        label: 'Paused',
        scheduledHour: 9,
        scheduledMinute: 0,
        isActive: false,
      })
      .expect(201);

    const listRes = await request(app.getHttpServer())
      .get(`${BASE_PATH}?activeOnly=true`)
      .set(AUTH_HEADER, bearer(token))
      .expect(200);

    const body = listRes.body as ApiEnvelope<{ items: any[] }>;
    expect(body.data!.items).toHaveLength(1);
    expect(body.data!.items[0].label).toBe('Active');
  });

  it('should reject reminders linked to another user medicine', async () => {
    const { token } = await createUserWithToken();
    const { user: otherUser } = await createUserWithToken();
    const otherMedicine = await createCurrentMedicine(otherUser.id);

    await request(app.getHttpServer())
      .post(BASE_PATH)
      .set(AUTH_HEADER, bearer(token))
      .send({
        currentMedicineId: otherMedicine.id,
        scheduledHour: 8,
        scheduledMinute: 0,
      })
      .expect(404);
  });

  it('should update and unlink a reminder', async () => {
    const { user, token } = await createUserWithToken();
    const medicine = await createCurrentMedicine(user.id);

    const createRes = await request(app.getHttpServer())
      .post(BASE_PATH)
      .set(AUTH_HEADER, bearer(token))
      .send({
        currentMedicineId: medicine.id,
        scheduledHour: 8,
        scheduledMinute: 30,
      })
      .expect(201);

    const id = (createRes.body as ApiEnvelope<{ id: string }>).data!.id;

    const updateRes = await request(app.getHttpServer())
      .patch(`${BASE_PATH}/${id}`)
      .set(AUTH_HEADER, bearer(token))
      .send({
        currentMedicineId: null,
        label: 'Evening dose',
        scheduledHour: 20,
        scheduledMinute: 5,
        daysOfWeek: null,
      })
      .expect(200);

    const body = updateRes.body as ApiEnvelope<{
      currentMedicineId: string | null;
      label: string;
      scheduledHour: number;
      scheduledMinute: number;
      daysOfWeek: number[] | null;
    }>;
    expect(body.data!.currentMedicineId).toBeNull();
    expect(body.data!.label).toBe('Evening dose');
    expect(body.data!.scheduledHour).toBe(20);
    expect(body.data!.scheduledMinute).toBe(5);
    expect(body.data!.daysOfWeek).toBeNull();
  });

  it('should soft-delete reminders', async () => {
    const { token } = await createUserWithToken();

    const createRes = await request(app.getHttpServer())
      .post(BASE_PATH)
      .set(AUTH_HEADER, bearer(token))
      .send({
        scheduledHour: 8,
        scheduledMinute: 0,
      })
      .expect(201);

    const id = (createRes.body as ApiEnvelope<{ id: string }>).data!.id;

    await request(app.getHttpServer())
      .delete(`${BASE_PATH}/${id}`)
      .set(AUTH_HEADER, bearer(token))
      .expect(200);

    const listRes = await request(app.getHttpServer())
      .get(BASE_PATH)
      .set(AUTH_HEADER, bearer(token))
      .expect(200);

    const body = listRes.body as ApiEnvelope<{ items: any[] }>;
    expect(body.data!.items).toHaveLength(0);

    const stored = await prisma.userMedicineReminder.findUniqueOrThrow({
      where: { id },
    });
    expect(stored.deletedAt).not.toBeNull();
    expect(stored.isActive).toBe(false);
  });

  it('should return 404 for foreign reminder updates', async () => {
    const { token } = await createUserWithToken();
    const { token: otherToken } = await createUserWithToken();

    const createRes = await request(app.getHttpServer())
      .post(BASE_PATH)
      .set(AUTH_HEADER, bearer(token))
      .send({
        scheduledHour: 8,
        scheduledMinute: 0,
      })
      .expect(201);

    const id = (createRes.body as ApiEnvelope<{ id: string }>).data!.id;

    await request(app.getHttpServer())
      .patch(`${BASE_PATH}/${id}`)
      .set(AUTH_HEADER, bearer(otherToken))
      .send({ scheduledHour: 10 })
      .expect(404);
  });

  it('should reject invalid schedule values', async () => {
    const { token } = await createUserWithToken();

    await request(app.getHttpServer())
      .post(BASE_PATH)
      .set(AUTH_HEADER, bearer(token))
      .send({
        scheduledHour: 24,
        scheduledMinute: 0,
      })
      .expect(400);

    await request(app.getHttpServer())
      .post(BASE_PATH)
      .set(AUTH_HEADER, bearer(token))
      .send({
        scheduledHour: 8,
        scheduledMinute: 60,
      })
      .expect(400);
  });

  it('should require auth', async () => {
    await request(app.getHttpServer()).get(BASE_PATH).expect(401);
  });
});
