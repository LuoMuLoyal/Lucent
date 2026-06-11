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
import { DailyRecordKind, UserStatus } from '../src/generated/prisma/client';
import { ConfigKey } from '../src/config/config-keys.enum';

const BASE_PATH = '/api/v1/user/daily-records';
const AUTH_HEADER = 'Authorization';
const BEARER = 'Bearer';

let seededSeq = 0;

function uniqueEmail(): string {
  seededSeq += 1;
  return `dailyrecord${seededSeq}_${Date.now()}@example.com`;
}

function bearer(token: string): string {
  return `${BEARER} ${token}`;
}

describe('Daily Records API (e2e)', () => {
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

    await prisma.userDailyRecordAttachment.deleteMany();
    await prisma.userDailyRecord.deleteMany();
    await prisma.userCurrentMedicine.deleteMany();
    await prisma.userCondition.deleteMany();
    await prisma.userAllergy.deleteMany();
    await prisma.userSession.deleteMany();
    await prisma.user.deleteMany();
  });

  afterAll(async () => {
    await prisma.userDailyRecordAttachment.deleteMany();
    await prisma.userDailyRecord.deleteMany();
    await prisma.userCurrentMedicine.deleteMany();
    await prisma.userCondition.deleteMany();
    await prisma.userAllergy.deleteMany();
    await prisma.userSession.deleteMany();
    await prisma.user.deleteMany();
    await app.close();
  });

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

  it('should create and list daily records', async () => {
    const email = uniqueEmail();
    const user = await prisma.user.create({
      data: {
        email,
        passwordHash: '$argon2id$mock',
        status: UserStatus.active,
      },
    });
    const token = await createAccessToken(user.id, user.email);

    // Create
    await request(app.getHttpServer())
      .post(BASE_PATH)
      .set(AUTH_HEADER, bearer(token))
      .send({
        kind: DailyRecordKind.water,
        occurredAt: '2026-06-04',
        value: '3',
        unit: 'cups',
      })
      .expect(201);

    // List
    const listRes = await request(app.getHttpServer())
      .get(`${BASE_PATH}?date=2026-06-04`)
      .set(AUTH_HEADER, bearer(token))
      .expect(200);

    const listBody = listRes.body as ApiEnvelope<{
      items: any[];
      total: number;
    }>;
    expect(listBody.code).toBe(ResultCode.SUCCESS);
    expect(listBody.data!.items).toHaveLength(1);
    expect(listBody.data!.items[0].value).toBe('3');
  });

  it('should update a record and clear nullable fields', async () => {
    const email = uniqueEmail();
    const user = await prisma.user.create({
      data: {
        email,
        passwordHash: '$argon2id$mock',
        status: UserStatus.active,
      },
    });
    const token = await createAccessToken(user.id, user.email);

    const createRes = await request(app.getHttpServer())
      .post(BASE_PATH)
      .set(AUTH_HEADER, bearer(token))
      .send({
        kind: DailyRecordKind.mood,
        occurredAt: '2026-06-04',
        note: 'good',
      })
      .expect(201);

    const id = (createRes.body as ApiEnvelope<{ id: string }>).data!.id;

    // Clear note
    await request(app.getHttpServer())
      .patch(`${BASE_PATH}/${id}`)
      .set(AUTH_HEADER, bearer(token))
      .send({ note: null })
      .expect(200);

    const stored = await prisma.userDailyRecord.findUniqueOrThrow({
      where: { id },
    });
    expect(stored.note).toBeNull();
  });

  it('should create, get, and replace record image attachments', async () => {
    const email = uniqueEmail();
    const user = await prisma.user.create({
      data: {
        email,
        passwordHash: '$argon2id$mock',
        status: UserStatus.active,
      },
    });
    const token = await createAccessToken(user.id, user.email);

    const createRes = await request(app.getHttpServer())
      .post(BASE_PATH)
      .set(AUTH_HEADER, bearer(token))
      .send({
        kind: DailyRecordKind.meal,
        occurredAt: '2026-06-04',
        title: 'Breakfast',
        attachments: [
          {
            objectKey: `daily-records/${user.id}/breakfast.jpg`,
            bucket: 'lucent-dev',
            provider: 'tencent-cos',
            fileName: 'breakfast.jpg',
            contentType: 'image/jpeg',
            sizeBytes: 2048,
            width: 800,
            height: 600,
            publicUrl: 'https://cdn.example.com/breakfast.jpg',
          },
        ],
      })
      .expect(201);

    const created = createRes.body as ApiEnvelope<{
      id: string;
      attachments: any[];
    }>;
    const id = created.data!.id;
    expect(created.data!.attachments).toHaveLength(1);
    expect(created.data!.attachments[0].objectKey).toBe(
      `daily-records/${user.id}/breakfast.jpg`,
    );

    const detailRes = await request(app.getHttpServer())
      .get(`${BASE_PATH}/${id}`)
      .set(AUTH_HEADER, bearer(token))
      .expect(200);

    const detail = detailRes.body as ApiEnvelope<{ attachments: any[] }>;
    expect(detail.data!.attachments[0].provider).toBe('tencent-cos');
    expect(detail.data!.attachments[0].publicUrl).toBe(
      'https://cdn.example.com/breakfast.jpg',
    );

    await request(app.getHttpServer())
      .patch(`${BASE_PATH}/${id}`)
      .set(AUTH_HEADER, bearer(token))
      .send({ attachments: [] })
      .expect(200);

    const storedAttachments = await prisma.userDailyRecordAttachment.findMany({
      where: { recordId: id },
    });
    expect(storedAttachments).toHaveLength(0);
  });

  it('should soft-delete a record', async () => {
    const email = uniqueEmail();
    const user = await prisma.user.create({
      data: {
        email,
        passwordHash: '$argon2id$mock',
        status: UserStatus.active,
      },
    });
    const token = await createAccessToken(user.id, user.email);

    const createRes = await request(app.getHttpServer())
      .post(BASE_PATH)
      .set(AUTH_HEADER, bearer(token))
      .send({ kind: DailyRecordKind.note, occurredAt: '2026-06-04' })
      .expect(201);

    const id = (createRes.body as ApiEnvelope<{ id: string }>).data!.id;

    await request(app.getHttpServer())
      .delete(`${BASE_PATH}/${id}`)
      .set(AUTH_HEADER, bearer(token))
      .expect(200);

    // Should not appear in list after soft delete
    const listRes = await request(app.getHttpServer())
      .get(`${BASE_PATH}?date=2026-06-04`)
      .set(AUTH_HEADER, bearer(token))
      .expect(200);

    const listBody = listRes.body as ApiEnvelope<{
      items: any[];
      total: number;
    }>;
    expect(listBody.data!.items).toHaveLength(0);
  });

  it('should return summary by kind', async () => {
    const email = uniqueEmail();
    const user = await prisma.user.create({
      data: {
        email,
        passwordHash: '$argon2id$mock',
        status: UserStatus.active,
      },
    });
    const token = await createAccessToken(user.id, user.email);

    await request(app.getHttpServer())
      .post(BASE_PATH)
      .set(AUTH_HEADER, bearer(token))
      .send({
        kind: DailyRecordKind.water,
        occurredAt: '2026-06-04',
        value: '3',
      })
      .expect(201);

    await request(app.getHttpServer())
      .post(BASE_PATH)
      .set(AUTH_HEADER, bearer(token))
      .send({
        kind: DailyRecordKind.mood,
        occurredAt: '2026-06-04',
        note: 'ok',
      })
      .expect(201);

    const res = await request(app.getHttpServer())
      .get(`${BASE_PATH}/summary?date=2026-06-04`)
      .set(AUTH_HEADER, bearer(token))
      .expect(200);

    const body = res.body as ApiEnvelope<{ summaries: any[] }>;
    expect(body.data!.summaries).toHaveLength(2);
  });

  it('should return 404 for foreign record', async () => {
    const email1 = uniqueEmail();
    const user1 = await prisma.user.create({
      data: {
        email: email1,
        passwordHash: '$argon2id$mock',
        status: UserStatus.active,
      },
    });
    const token1 = await createAccessToken(user1.id, user1.email);

    const createRes = await request(app.getHttpServer())
      .post(BASE_PATH)
      .set(AUTH_HEADER, bearer(token1))
      .send({ kind: DailyRecordKind.note, occurredAt: '2026-06-04' })
      .expect(201);

    const id = (createRes.body as ApiEnvelope<{ id: string }>).data!.id;

    const email2 = uniqueEmail();
    const user2 = await prisma.user.create({
      data: {
        email: email2,
        passwordHash: '$argon2id$mock',
        status: UserStatus.active,
      },
    });
    const token2 = await createAccessToken(user2.id, user2.email);

    await request(app.getHttpServer())
      .patch(`${BASE_PATH}/${id}`)
      .set(AUTH_HEADER, bearer(token2))
      .send({ note: 'x' })
      .expect(404);
  });

  it('should require auth', async () => {
    await request(app.getHttpServer())
      .get(`${BASE_PATH}?date=2026-06-04`)
      .expect(401);
  });
});
