import { Test, type TestingModule } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import request from 'supertest';
import type { App } from 'supertest/types';

import { AppModule } from '../../../src/app.module';
import { setupApp } from '../../../src/setup-app';
import { PrismaService } from '../../../src/prisma/prisma.service';
import type { ApiEnvelope } from '../../../src/common/api-envelope';
import { ConfigKey } from '../../../src/config/config-keys.enum';
import { UserStatus } from '../../../src/generated/prisma/client';

const ACCOUNT_PATH = '/api/v1/account';
const AUTHORIZATION_HEADER = 'Authorization';
const BEARER_AUTH_SCHEME = 'Bearer';

function bearer(token: string): string {
  return `${BEARER_AUTH_SCHEME} ${token}`;
}

function expectData<T>(body: ApiEnvelope<T>): T {
  expect(body.data).not.toBeNull();
  return body.data as T;
}

describe('Account API (e2e)', () => {
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
    await prisma.userIdentity.deleteMany();
    await prisma.userSession.deleteMany();
    await prisma.user.deleteMany();

    // Create test user
    userEmail = `account_${String(Date.now())}@example.com`;
    const user = await prisma.user.create({
      data: {
        email: userEmail,
        passwordHash: '$argon2id$mock',
        nickname: 'AccountUser',
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
    await prisma.userIdentity.deleteMany();
    await prisma.userSession.deleteMany();
    await prisma.user.deleteMany();
    await app.close();
  });

  describe('GET /api/v1/account', () => {
    it('should return 401 without authorization', async () => {
      await request(app.getHttpServer()).get(ACCOUNT_PATH).expect(401);
    });

    it('should return account profile', async () => {
      const res = await request(app.getHttpServer())
        .get(ACCOUNT_PATH)
        .set(AUTHORIZATION_HEADER, bearer(accessToken))
        .expect(200);

      const data = expectData(
        res.body as ApiEnvelope<{
          id: string;
          email: string;
          nickname: string;
          hasPassword: boolean;
        }>,
      );
      expect(data.id).toBe(userId);
      expect(data.email).toBe(userEmail);
      expect(data.nickname).toBe('AccountUser');
      expect(data.hasPassword).toBe(true);
    });
  });

  describe('PATCH /api/v1/account', () => {
    it('should update nickname', async () => {
      const res = await request(app.getHttpServer())
        .patch(ACCOUNT_PATH)
        .set(AUTHORIZATION_HEADER, bearer(accessToken))
        .send({ nickname: 'UpdatedName' })
        .expect(200);

      const data = expectData(res.body as ApiEnvelope<{ nickname: string }>);
      expect(data.nickname).toBe('UpdatedName');
    });

    it('should clear nickname with empty string', async () => {
      const res = await request(app.getHttpServer())
        .patch(ACCOUNT_PATH)
        .set(AUTHORIZATION_HEADER, bearer(accessToken))
        .send({ nickname: '' })
        .expect(200);

      const data = expectData(
        res.body as ApiEnvelope<{ nickname: string | null }>,
      );
      expect(data.nickname).toBeNull();
    });
  });
});
