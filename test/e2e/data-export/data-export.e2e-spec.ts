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

const EXPORT_PATH = '/api/v1/user/data-export-requests';
const AUTHORIZATION_HEADER = 'Authorization';
const BEARER_AUTH_SCHEME = 'Bearer';

function bearer(token: string): string {
  return `${BEARER_AUTH_SCHEME} ${token}`;
}

function expectData<T>(body: ApiEnvelope<T>): T {
  expect(body.data).not.toBeNull();
  return body.data as T;
}

describe('Data Export API (e2e)', () => {
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
    await prisma.dataExportRequest.deleteMany();
    await prisma.userSession.deleteMany();
    await prisma.user.deleteMany();

    // Create test user
    userEmail = `export_${String(Date.now())}@example.com`;
    const user = await prisma.user.create({
      data: {
        email: userEmail,
        passwordHash: '$argon2id$mock',
        nickname: 'ExportUser',
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
    await prisma.dataExportRequest.deleteMany();
    await prisma.userSession.deleteMany();
    await prisma.user.deleteMany();
    await app.close();
  });

  describe('POST /api/v1/user/data-export-requests', () => {
    it('should return 401 without authorization', async () => {
      await request(app.getHttpServer()).post(EXPORT_PATH).expect(401);
    });

    it('should create a data export request with defaults', async () => {
      const response = await request(app.getHttpServer())
        .post(EXPORT_PATH)
        .set(AUTHORIZATION_HEADER, bearer(accessToken))
        .send({})
        .expect(201);

      const data = expectData(
        response.body as ApiEnvelope<{
          id: string;
          kind: string;
          format: string;
          status: string;
          createdAt: string;
        }>,
      );
      expect(data.id).toBeTruthy();
      expect(data.kind).toBe('hospital');
      expect(data.format).toBe('pdf');
      expect(data.status).toBeTruthy();
    });
  });

  describe('GET /api/v1/user/data-export-requests/latest', () => {
    it('should return 401 without authorization', async () => {
      await request(app.getHttpServer())
        .get(`${EXPORT_PATH}/latest`)
        .expect(401);
    });

    it('should return the latest export request', async () => {
      const response = await request(app.getHttpServer())
        .get(`${EXPORT_PATH}/latest`)
        .set(AUTHORIZATION_HEADER, bearer(accessToken))
        .expect(200);

      const data = expectData(
        response.body as ApiEnvelope<{
          id: string;
          kind: string;
          status: string;
          createdAt: string;
        } | null>,
      );
      expect(data).not.toBeNull();
      expect(data?.kind).toBe('hospital');
    });
  });
});
