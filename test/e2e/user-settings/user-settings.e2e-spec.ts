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

const USER_SETTINGS_PATH = '/api/v1/user/settings';
const AUTHORIZATION_HEADER = 'Authorization';
const BEARER_AUTH_SCHEME = 'Bearer';

let seededSeq = 0;

function bearer(accessToken: string): string {
  return `${BEARER_AUTH_SCHEME} ${accessToken}`;
}

function uniqueEmail(): string {
  seededSeq += 1;
  return `settings${String(seededSeq)}_${String(Date.now())}@example.com`;
}

function expectData<T>(body: ApiEnvelope<T>): T {
  expect(body.data).not.toBeNull();
  return body.data as T;
}

interface UserSettingsData {
  aiSummariesEnabled: boolean;
  dataSharingConsent: boolean;
  assistantEnabled: boolean;
  assistantMemoryEnabled: boolean;
  assistantContext: {
    healthProfile: boolean;
    dailyRecords: boolean;
    sleepRecords: boolean;
    currentMedicines: boolean;
  };
  updatedAt: string | null;
}

describe('User Settings API (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let jwtService: JwtService;
  let configService: ConfigService;

  let userId: string;
  let userEmail: string;

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

    // Clean existing test data
    await prisma.userSetting.deleteMany();
    await prisma.userSession.deleteMany();
    await prisma.user.deleteMany();

    // Create test user
    userEmail = uniqueEmail();
    const user = await prisma.user.create({
      data: {
        email: userEmail,
        passwordHash: '$argon2id$mock',
        nickname: 'SettingsUser',
        status: UserStatus.active,
      },
    });
    userId = user.id;
  });

  async function createAccessToken(
    userId: string,
    email: string,
  ): Promise<string> {
    const jwtCfg = configService.getOrThrow<{
      accessSecret: string;
      accessTtl: number;
      issuer: string;
      audience: string;
    }>(ConfigKey.Jwt);

    return jwtService.signAsync(
      { sub: userId, email },
      {
        secret: jwtCfg.accessSecret,
        expiresIn: jwtCfg.accessTtl,
        algorithm: 'HS512',
        issuer: jwtCfg.issuer,
        audience: jwtCfg.audience,
      },
    );
  }

  afterAll(async () => {
    await prisma.userSetting.deleteMany();
    await prisma.userSession.deleteMany();
    await prisma.user.deleteMany();
    await app.close();
  });

  describe('GET /api/v1/user/settings', () => {
    it('should return default settings for a new user', async () => {
      const accessToken = await createAccessToken(userId, userEmail);
      const response = await request(app.getHttpServer())
        .get(USER_SETTINGS_PATH)
        .set(AUTHORIZATION_HEADER, bearer(accessToken))
        .expect(200);

      const settings = expectData(
        response.body as ApiEnvelope<UserSettingsData>,
      );

      expect(settings.aiSummariesEnabled).toBe(true);
      expect(settings.dataSharingConsent).toBe(false);
      expect(settings.assistantEnabled).toBe(true);
      expect(settings.assistantMemoryEnabled).toBe(false);
      expect(settings.assistantContext).toEqual({
        healthProfile: true,
        dailyRecords: true,
        sleepRecords: true,
        currentMedicines: true,
      });
      // A new user with no saved settings still gets an updatedAt from the DTO
      expect(settings.updatedAt).toBeNull();
    });

    it('should return 401 without authorization', async () => {
      await request(app.getHttpServer()).get(USER_SETTINGS_PATH).expect(401);
    });

    it('should return 401 with an invalid token', async () => {
      await request(app.getHttpServer())
        .get(USER_SETTINGS_PATH)
        .set(AUTHORIZATION_HEADER, bearer('invalid-token'))
        .expect(401);
    });
  });

  describe('PATCH /api/v1/user/settings', () => {
    it('should update a single setting and return the new state', async () => {
      const token = await createAccessToken(userId, userEmail);
      const response = await request(app.getHttpServer())
        .patch(USER_SETTINGS_PATH)
        .set(AUTHORIZATION_HEADER, bearer(token))
        .send({ aiSummariesEnabled: false })
        .expect(200);

      const settings = expectData(
        response.body as ApiEnvelope<UserSettingsData>,
      );

      expect(settings.aiSummariesEnabled).toBe(false);
      expect(settings.dataSharingConsent).toBe(false);
      expect(settings.assistantEnabled).toBe(true);
      expect(settings.updatedAt).not.toBeNull();
    });

    it('should update multiple settings at once', async () => {
      const token = await createAccessToken(userId, userEmail);
      const response = await request(app.getHttpServer())
        .patch(USER_SETTINGS_PATH)
        .set(AUTHORIZATION_HEADER, bearer(token))
        .send({
          dataSharingConsent: true,
          assistantEnabled: false,
          assistantMemoryEnabled: false,
        })
        .expect(200);

      const settings = expectData(
        response.body as ApiEnvelope<UserSettingsData>,
      );

      expect(settings.dataSharingConsent).toBe(true);
      expect(settings.assistantEnabled).toBe(false);
      expect(settings.assistantMemoryEnabled).toBe(false);
    });

    it('should update assistant context permissions', async () => {
      const token = await createAccessToken(userId, userEmail);
      const response = await request(app.getHttpServer())
        .patch(USER_SETTINGS_PATH)
        .set(AUTHORIZATION_HEADER, bearer(token))
        .send({
          assistantContext: {
            healthProfile: false,
            dailyRecords: false,
          },
        })
        .expect(200);

      const settings = expectData(
        response.body as ApiEnvelope<UserSettingsData>,
      );

      expect(settings.assistantContext.healthProfile).toBe(false);
      expect(settings.assistantContext.dailyRecords).toBe(false);
      expect(settings.assistantContext.sleepRecords).toBe(true);
      expect(settings.assistantContext.currentMedicines).toBe(true);
    });

    it('should reject non-boolean values', async () => {
      const token = await createAccessToken(userId, userEmail);
      await request(app.getHttpServer())
        .patch(USER_SETTINGS_PATH)
        .set(AUTHORIZATION_HEADER, bearer(token))
        .send({ aiSummariesEnabled: 'not-a-boolean' })
        .expect(400);
    });
  });
});
