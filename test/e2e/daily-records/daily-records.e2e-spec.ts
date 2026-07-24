import { Test, type TestingModule } from '@nestjs/testing';
import { ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { FastifyAdapter } from '@nestjs/platform-fastify';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import request from 'supertest';

import { AppModule } from '../../../src/app.module';
import { setupApp } from '../../../src/setup-app';
import { ResultCode } from '../../../src/common';
import type { ApiEnvelope } from '../../../src/common';
import { DailyRecordCandidatesService } from '../../../src/modules/daily-records';
import { PrismaService } from '../../../src/prisma';
import { DailyRecordKind, UserStatus } from '#generated/prisma/client';
import { ConfigKey } from '../../../src/config/config-keys.enum';

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

describe('Daily Records API (e2e)', () => {
  let app: NestFastifyApplication;
  let prisma: PrismaService;
  let jwtService: JwtService;
  let configService: ConfigService;
  let candidateService: vi.Mocked<DailyRecordCandidatesService>;

  beforeAll(async () => {
    const candidateServiceMock = {
      generate: vi.fn(),
    };

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(DailyRecordCandidatesService)
      .useValue(candidateServiceMock)
      .compile();

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
    candidateService = moduleFixture.get(DailyRecordCandidatesService);

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

  beforeEach(() => {
    candidateService.generate.mockReset();
  });

  async function createAccessToken(userId: string, email: string) {
    const jwtConfig = configService.getOrThrow<{
      accessSecret: string;
      accessTtl: number;
      issuer: string;
      audience: string;
    }>(ConfigKey.Jwt);

    return jwtService.signAsync(
      { sub: userId, email, status: 'active' },
      {
        secret: jwtConfig.accessSecret,
        expiresIn: jwtConfig.accessTtl,
        algorithm: 'HS512',
        issuer: jwtConfig.issuer,
        audience: jwtConfig.audience,
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
    const token = await createAccessToken(
      user.id,
      expectDefined(user.email, 'Expected user email'),
    );

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
      items: Array<{ value: string | null }>;
      total: number;
    }>;
    expect(listBody.code).toBe(ResultCode.SUCCESS);
    const listData = expectData(listBody);
    expect(listData.items).toHaveLength(1);
    expect(listData.items[0]?.value).toBe('3');
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
    const token = await createAccessToken(
      user.id,
      expectDefined(user.email, 'Expected user email'),
    );

    const createRes = await request(app.getHttpServer())
      .post(BASE_PATH)
      .set(AUTH_HEADER, bearer(token))
      .send({
        kind: DailyRecordKind.mood,
        occurredAt: '2026-06-04',
        note: 'good',
      })
      .expect(201);

    const id = expectData(createRes.body as ApiEnvelope<{ id: string }>).id;

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
    const token = await createAccessToken(
      user.id,
      expectDefined(user.email, 'Expected user email'),
    );

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

    const created = expectData(
      createRes.body as ApiEnvelope<{
        id: string;
        attachments: Array<{
          objectKey: string;
          provider: string;
          publicUrl: string | null;
        }>;
      }>,
    );
    const id = created.id;
    expect(created.attachments).toHaveLength(1);
    expect(created.attachments[0]?.objectKey).toBe(
      `daily-records/${user.id}/breakfast.jpg`,
    );

    const detailRes = await request(app.getHttpServer())
      .get(`${BASE_PATH}/${id}`)
      .set(AUTH_HEADER, bearer(token))
      .expect(200);

    const detail = expectData(
      detailRes.body as ApiEnvelope<{
        attachments: Array<{ provider: string; publicUrl: string | null }>;
      }>,
    );
    expect(detail.attachments[0]?.provider).toBe('tencent-cos');
    expect(detail.attachments[0]?.publicUrl).toBe(
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
    const token = await createAccessToken(
      user.id,
      expectDefined(user.email, 'Expected user email'),
    );

    const createRes = await request(app.getHttpServer())
      .post(BASE_PATH)
      .set(AUTH_HEADER, bearer(token))
      .send({ kind: DailyRecordKind.note, occurredAt: '2026-06-04' })
      .expect(201);

    const id = expectData(createRes.body as ApiEnvelope<{ id: string }>).id;

    await request(app.getHttpServer())
      .delete(`${BASE_PATH}/${id}`)
      .set(AUTH_HEADER, bearer(token))
      .expect(200);

    // Should not appear in list after soft delete
    const listRes = await request(app.getHttpServer())
      .get(`${BASE_PATH}?date=2026-06-04`)
      .set(AUTH_HEADER, bearer(token))
      .expect(200);

    const listBody = expectData(
      listRes.body as ApiEnvelope<{
        items: unknown[];
        total: number;
      }>,
    );
    expect(listBody.items).toHaveLength(0);
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
    const token = await createAccessToken(
      user.id,
      expectDefined(user.email, 'Expected user email'),
    );

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

    const body = expectData(res.body as ApiEnvelope<{ summaries: unknown[] }>);
    expect(body.summaries).toHaveLength(2);
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
    const token1 = await createAccessToken(
      user1.id,
      expectDefined(user1.email, 'Expected user email'),
    );

    const createRes = await request(app.getHttpServer())
      .post(BASE_PATH)
      .set(AUTH_HEADER, bearer(token1))
      .send({ kind: DailyRecordKind.note, occurredAt: '2026-06-04' })
      .expect(201);

    const id = expectData(createRes.body as ApiEnvelope<{ id: string }>).id;

    const email2 = uniqueEmail();
    const user2 = await prisma.user.create({
      data: {
        email: email2,
        passwordHash: '$argon2id$mock',
        status: UserStatus.active,
      },
    });
    const token2 = await createAccessToken(
      user2.id,
      expectDefined(user2.email, 'Expected user email'),
    );

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

  it('should return 503 for candidate generation when AI language model is not configured', async () => {
    const email = uniqueEmail();
    const user = await prisma.user.create({
      data: {
        email,
        passwordHash: '$argon2id$mock',
        status: UserStatus.active,
      },
    });
    const token = await createAccessToken(
      user.id,
      expectDefined(user.email, 'Expected user email'),
    );

    candidateService.generate.mockRejectedValueOnce(
      new ServiceUnavailableException({
        code: ResultCode.EXTERNAL_SERVICE_ERROR,
        message: '自然语言记录解析服务尚未配置',
      }),
    );

    const response = await request(app.getHttpServer())
      .post(`${BASE_PATH}/candidate-records/generate`)
      .set(AUTH_HEADER, bearer(token))
      .send({
        text: '今天头疼，早上喝了两杯水。',
        occurredAt: '2026-06-14',
      })
      .expect(503);

    const body = response.body as ApiEnvelope;
    expect(body.code).toBe(ResultCode.EXTERNAL_SERVICE_ERROR);
  });

  it('should return generated candidate records', async () => {
    const email = uniqueEmail();
    const user = await prisma.user.create({
      data: {
        email,
        passwordHash: '$argon2id$mock',
        status: UserStatus.active,
      },
    });
    const token = await createAccessToken(
      user.id,
      expectDefined(user.email, 'Expected user email'),
    );

    candidateService.generate.mockResolvedValueOnce({
      locale: 'zh-CN',
      generatedAt: '2026-06-14T10:20:30.000Z',
      confirmationHint: '这些只是候选记录，确认后再保存到今日记录中。',
      items: [
        {
          kind: 'symptom',
          occurredAt: '2026-06-14',
          title: '头痛',
          value: null,
          unit: null,
          note: '今天头疼',
          payload: null,
          rationale: 'Detected symptom from “今天头疼”.',
        },
        {
          kind: 'water',
          occurredAt: '2026-06-14',
          title: null,
          value: '2',
          unit: 'cups',
          note: null,
          payload: null,
          rationale: 'Detected water intake from “喝了两杯水”.',
        },
      ],
    });

    const response = await request(app.getHttpServer())
      .post(`${BASE_PATH}/candidate-records/generate`)
      .set(AUTH_HEADER, bearer(token))
      .set('Accept-Language', 'zh-CN')
      .send({
        text: '今天头疼，早上喝了两杯水。',
        occurredAt: '2026-06-14',
      })
      .expect(200);

    const body = response.body as ApiEnvelope<{
      locale: string;
      confirmationHint: string;
      items: Array<{ kind: string }>;
    }>;
    expect(body.code).toBe(ResultCode.SUCCESS);
    expect(body.message).toBe('');
    const data = expectData(body);
    expect(data.locale).toBe('zh-CN');
    expect(data.items).toHaveLength(2);
    expect(data.items[0]?.kind).toBe('symptom');
    expect(candidateService.generate.mock.calls).toContainEqual([
      user.id,
      {
        text: '今天头疼，早上喝了两杯水。',
        occurredAt: '2026-06-14',
      },
      'zh-CN',
    ]);
  });

  // ── Presigned Image Upload ─────────────────────────────────

  describe('POST /attachments/images/presign-upload', () => {
    it('should return 401 for unauthenticated request', async () => {
      await request(app.getHttpServer())
        .post(`${BASE_PATH}/attachments/images/presign-upload`)
        .send({
          contentType: 'image/jpeg',
          sizeBytes: 1024,
        })
        .expect(401);
    });

    it('should return 400 or 503 for invalid content type', async () => {
      const email = uniqueEmail();
      const user = await prisma.user.create({
        data: {
          email,
          passwordHash: '$argon2id$mock',
          status: UserStatus.active,
        },
      });
      const token = await createAccessToken(
        user.id,
        expectDefined(user.email, 'Expected user email'),
      );

      const res = await request(app.getHttpServer())
        .post(`${BASE_PATH}/attachments/images/presign-upload`)
        .set(AUTH_HEADER, bearer(token))
        .send({
          contentType: 'application/pdf',
          sizeBytes: 1024,
        });

      // If COS is configured → 400 (invalid content type)
      // If COS is not configured → 503 (service unavailable, checked before content type)
      expect([400, 503]).toContain(res.status);
    });

    it('should return 400 for missing required fields', async () => {
      const email = uniqueEmail();
      const user = await prisma.user.create({
        data: {
          email,
          passwordHash: '$argon2id$mock',
          status: UserStatus.active,
        },
      });
      const token = await createAccessToken(
        user.id,
        expectDefined(user.email, 'Expected user email'),
      );

      await request(app.getHttpServer())
        .post(`${BASE_PATH}/attachments/images/presign-upload`)
        .set(AUTH_HEADER, bearer(token))
        .send({ fileName: 'test.jpg' })
        .expect(400);
    });

    it('should create presigned upload URL or return 503 when COS not configured', async () => {
      const email = uniqueEmail();
      const user = await prisma.user.create({
        data: {
          email,
          passwordHash: '$argon2id$mock',
          status: UserStatus.active,
        },
      });
      const token = await createAccessToken(
        user.id,
        expectDefined(user.email, 'Expected user email'),
      );

      const res = await request(app.getHttpServer())
        .post(`${BASE_PATH}/attachments/images/presign-upload`)
        .set(AUTH_HEADER, bearer(token))
        .send({
          contentType: 'image/jpeg',
          sizeBytes: 102400,
          fileName: 'breakfast.jpg',
        });

      // COS may not be configured in test environment → 503
      // When COS is configured → 201
      if (res.status === 201) {
        const body = res.body as ApiEnvelope<{
          provider: string;
          bucket: string;
          objectKey: string;
          uploadUrl: string;
          headers: Record<string, string>;
          publicUrl: string | null;
          expiresAt: string;
          maxSizeBytes: number;
        }>;
        expect(body.code).toBe(ResultCode.SUCCESS);
        const data = expectData(body);
        expect(data.provider).toBe('tencent-cos');
        expect(data.bucket).toBeTruthy();
        expect(data.objectKey).toContain('daily-records/');
        expect(data.uploadUrl).toBeTruthy();
        expect(data.headers['Content-Type']).toBe('image/jpeg');
        expect(data.expiresAt).toBeTruthy();
        expect(data.maxSizeBytes).toBeGreaterThan(0);
      } else {
        // COS not configured
        expect([503, 500]).toContain(res.status);
      }
    });
  });
});
