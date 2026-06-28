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

const RECOMMENDATIONS_PATH = '/api/v1/user/today-analysis/recommendations';
const AUTHORIZATION_HEADER = 'Authorization';
const BEARER_AUTH_SCHEME = 'Bearer';

function bearer(token: string): string {
  return `${BEARER_AUTH_SCHEME} ${token}`;
}

describe('Today Analysis API (e2e)', () => {
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
    await prisma.userSession.deleteMany();
    await prisma.user.deleteMany();

    // Create test user
    userEmail = `today_${String(Date.now())}@example.com`;
    const user = await prisma.user.create({
      data: {
        email: userEmail,
        passwordHash: '$argon2id$mock',
        nickname: 'TodayUser',
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
    await prisma.userSession.deleteMany();
    await prisma.user.deleteMany();
    await app.close();
  });

  describe('GET /api/v1/user/today-analysis/recommendations', () => {
    it('should return 401 without authorization', async () => {
      await request(app.getHttpServer()).get(RECOMMENDATIONS_PATH).expect(401);
    });

    it('should return health recommendations', async () => {
      const response = await request(app.getHttpServer())
        .get(RECOMMENDATIONS_PATH)
        .set(AUTHORIZATION_HEADER, bearer(accessToken))
        .expect(200);

      const body = response.body as ApiEnvelope;
      expect(body.code).toBe(ResultCode.SUCCESS);
      expect(body.data).toBeDefined();
    });

    it('should accept exclude parameter', async () => {
      const response = await request(app.getHttpServer())
        .get(`${RECOMMENDATIONS_PATH}?exclude=rec-1&exclude=rec-2`)
        .set(AUTHORIZATION_HEADER, bearer(accessToken))
        .expect(200);

      expect((response.body as ApiEnvelope).code).toBe(ResultCode.SUCCESS);
    });
  });
});
