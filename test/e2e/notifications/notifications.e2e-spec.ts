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

const NOTIFICATIONS_PATH = '/api/v1/user/notifications';
const AUTHORIZATION_HEADER = 'Authorization';
const BEARER_AUTH_SCHEME = 'Bearer';

function bearer(token: string): string {
  return `${BEARER_AUTH_SCHEME} ${token}`;
}

function expectData<T>(body: ApiEnvelope<T>): T {
  expect(body.data).not.toBeNull();
  return body.data as T;
}

describe('Notifications API (e2e)', () => {
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
    await prisma.userNotification.deleteMany();
    await prisma.userSession.deleteMany();
    await prisma.user.deleteMany();

    // Create test user
    userEmail = `notif_${String(Date.now())}@example.com`;
    const user = await prisma.user.create({
      data: {
        email: userEmail,
        passwordHash: '$argon2id$mock',
        nickname: 'NotifUser',
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
    await prisma.userNotification.deleteMany();
    await prisma.userSession.deleteMany();
    await prisma.user.deleteMany();
    await app.close();
  });

  it('should return 401 without authorization', async () => {
    await request(app.getHttpServer()).get(NOTIFICATIONS_PATH).expect(401);
  });

  it('should list notifications (empty initially)', async () => {
    const response = await request(app.getHttpServer())
      .get(NOTIFICATIONS_PATH)
      .set(AUTHORIZATION_HEADER, bearer(accessToken))
      .expect(200);

    const body = response.body as ApiEnvelope<{
      items: unknown[];
      total: number;
    }>;
    expect(body.code).toBe(ResultCode.SUCCESS);
    expect(body.data?.items).toEqual([]);
    expect(body.data?.total).toBe(0);
  });

  it('should create a notification and return it', async () => {
    const response = await request(app.getHttpServer())
      .post(NOTIFICATIONS_PATH)
      .set(AUTHORIZATION_HEADER, bearer(accessToken))
      .send({
        type: 'system_announcement',
        title: 'Test notification',
        content: 'This is a test notification content.',
      })
      .expect(201);

    const data = expectData(
      response.body as ApiEnvelope<{ id: string; type: string; title: string }>,
    );
    expect(data.id).toBeTruthy();
    expect(data.title).toBe('Test notification');
    expect(data.type).toBe('system_announcement');
  });

  it('should return unread count', async () => {
    const response = await request(app.getHttpServer())
      .get(`${NOTIFICATIONS_PATH}/unread-count`)
      .set(AUTHORIZATION_HEADER, bearer(accessToken))
      .expect(200);

    const body = response.body as ApiEnvelope<{ count: number }>;
    expect(body.code).toBe(ResultCode.SUCCESS);
    expect(body.data?.count).toBeGreaterThanOrEqual(1);
  });

  it('should mark all notifications as read', async () => {
    const response = await request(app.getHttpServer())
      .patch(`${NOTIFICATIONS_PATH}/mark-all-read`)
      .set(AUTHORIZATION_HEADER, bearer(accessToken))
      .expect(200);

    const body = response.body as ApiEnvelope<{ count: number }>;
    expect(body.code).toBe(ResultCode.SUCCESS);
    expect(body.data?.count).toBeGreaterThanOrEqual(1);

    // Verify unread count is now 0
    const unreadRes = await request(app.getHttpServer())
      .get(`${NOTIFICATIONS_PATH}/unread-count`)
      .set(AUTHORIZATION_HEADER, bearer(accessToken));

    const unreadBody = unreadRes.body as ApiEnvelope<{ count: number }>;
    expect(unreadBody.data?.count).toBe(0);
  });
});
