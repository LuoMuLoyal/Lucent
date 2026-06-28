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

const BASE_PATH = '/api/v1/user/assistant';
const AUTHORIZATION_HEADER = 'Authorization';
const BEARER_AUTH_SCHEME = 'Bearer';

function bearer(token: string): string {
  return `${BEARER_AUTH_SCHEME} ${token}`;
}

describe('Assistant API (e2e)', () => {
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

    await prisma.assistantMessage.deleteMany();
    await prisma.assistantConversation.deleteMany();
    await prisma.assistantSummaryHistory.deleteMany();
    await prisma.userSession.deleteMany();
    await prisma.user.deleteMany();

    userEmail = `ast_${String(Date.now())}@example.com`;
    const user = await prisma.user.create({
      data: {
        email: userEmail,
        passwordHash: '$argon2id$mock',
        nickname: 'AstUser',
        status: UserStatus.active,
      },
    });
    userId = user.id;

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
    await prisma.assistantMessage.deleteMany();
    await prisma.assistantConversation.deleteMany();
    await prisma.assistantSummaryHistory.deleteMany();
    await prisma.userSession.deleteMany();
    await prisma.user.deleteMany();
    await app.close();
  });

  describe('GET /capabilities', () => {
    it('should return 401 without authorization', async () => {
      await request(app.getHttpServer())
        .get(`${BASE_PATH}/capabilities`)
        .expect(401);
    });

    it('should return assistant capabilities', async () => {
      const res = await request(app.getHttpServer())
        .get(`${BASE_PATH}/capabilities`)
        .set(AUTHORIZATION_HEADER, bearer(accessToken))
        .expect(200);

      expect((res.body as ApiEnvelope).code).toBe(ResultCode.SUCCESS);
    });
  });

  describe('GET /conversations', () => {
    it('should return 401 without authorization', async () => {
      await request(app.getHttpServer())
        .get(`${BASE_PATH}/conversations`)
        .expect(401);
    });

    it('should list conversations (empty for new user)', async () => {
      const res = await request(app.getHttpServer())
        .get(`${BASE_PATH}/conversations`)
        .set(AUTHORIZATION_HEADER, bearer(accessToken))
        .expect(200);

      expect((res.body as ApiEnvelope).code).toBe(ResultCode.SUCCESS);
    });
  });

  describe('GET /latest', () => {
    it('should return latest conversation or null', async () => {
      const res = await request(app.getHttpServer())
        .get(`${BASE_PATH}/latest`)
        .set(AUTHORIZATION_HEADER, bearer(accessToken))
        .expect(200);

      const body = res.body as ApiEnvelope<{ id?: string }>;
      expect(body.code).toBe(ResultCode.SUCCESS);
      // New user has no conversations, data may be null
    });
  });
});
