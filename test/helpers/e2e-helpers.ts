import { Test, type TestingModule } from '@nestjs/testing';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import type { Cache } from 'cache-manager';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { FastifyAdapter } from '@nestjs/platform-fastify';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { createHash, randomUUID } from 'node:crypto';
import request from 'supertest';
import * as argon2 from 'argon2';

import { AppModule } from '../../src/app.module';
import { ARGON2_OPTIONS } from '../../src/modules/auth';
import { setupApp } from '../../src/setup-app';
import { PrismaService } from '../../src/prisma';
import { ConfigKey } from '../../src/config/env/config-keys.enum';
import { UserStatus } from '#generated/prisma/client';

// ── Constants ──────────────────────────────────────────────────

export const AUTHORIZATION_HEADER = 'Authorization';
export const BEARER_AUTH_SCHEME = 'Bearer';
const VERIFICATION_CODE_TTL_MS = 5 * 60 * 1000;

// ── E2E Test App Setup ─────────────────────────────────────────

/** Convenience type alias for a NestJS Fastify app wired to the supertest App type. */
export type E2eApp = NestFastifyApplication;

export interface E2eTestContext {
  app: E2eApp;
  prisma: PrismaService;
  jwtService: JwtService;
  configService: ConfigService;
}

/**
 * Creates a full NestJS testing application wired to AppModule.
 * Call `cleanupDatabase(ctx.prisma)` afterwards to reset state,
 * and `await ctx.app.close()` in afterAll.
 */
export async function createTestApp(): Promise<E2eTestContext> {
  const moduleFixture: TestingModule = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();

  const configService = moduleFixture.get(ConfigService);
  const trustProxy =
    configService.get<boolean>(`${ConfigKey.App}.trustProxy`) ?? false;

  const app: E2eApp =
    moduleFixture.createNestApplication<NestFastifyApplication>(
      new FastifyAdapter({ trustProxy }),
      // bodyParser: false — same as main.ts; setupApp() registers the JSON
      // parser manually to avoid conflicts with AdminJS's @fastify/formbody.
      { bodyParser: false },
    );
  await setupApp(app, configService);
  await app.init();
  await app.getHttpAdapter().getInstance().ready();

  const prisma = app.get(PrismaService);
  const jwtService = app.get(JwtService);

  return { app, prisma, jwtService, configService };
}

// ── Database Cleanup ───────────────────────────────────────────

/**
 * Delete all user-related rows in foreign-key-safe order.
 * This avoids test pollution when multiple E2E suites share the same DB.
 */
export async function cleanupDatabase(prisma: PrismaService): Promise<void> {
  // 1. Leaf tables with FK to parent user-tables
  await prisma.userSuggestionFeedback.deleteMany();
  await prisma.userSuggestion.deleteMany();
  await prisma.userSuggestionBaseline.deleteMany();
  await prisma.userDailyRecordAttachment.deleteMany();
  await prisma.assistantMessage.deleteMany();
  await prisma.userReminderDelivery.deleteMany();

  // 2. Tables that depend on other user-tables
  await prisma.userMedicineReminder.deleteMany();
  await prisma.userMedicineDoseLog.deleteMany();

  // 3. Direct user-child tables
  await prisma.userNotification.deleteMany();
  await prisma.dataExportRequest.deleteMany();
  await prisma.userSetting.deleteMany();
  await prisma.userAllergy.deleteMany();
  await prisma.userCondition.deleteMany();
  await prisma.userCurrentMedicine.deleteMany();
  await prisma.userDailyRecord.deleteMany();
  await prisma.assistantSummaryHistory.deleteMany();
  await prisma.assistantConversation.deleteMany();
  await prisma.userSession.deleteMany();
  await prisma.userProfile.deleteMany();
  await prisma.account.deleteMany();

  // 4. Root table
  await prisma.user.deleteMany();
}

// ── Test User Factory ──────────────────────────────────────────

let userSeq = 0;

/**
 * Generate a unique email scoped to the current test run.
 */
export function uniqueEmail(prefix = 'e2e'): string {
  userSeq += 1;
  return `${prefix}${String(userSeq)}_${String(Date.now())}@example.com`;
}

export interface TestUser {
  id: string;
  email: string;
  nickname: string | null;
  status: UserStatus;
}

export interface RegisteredTestUser extends TestUser {
  accessToken: string;
  refreshToken: string;
}

/**
 * Create a minimal active test user and return its info.
 */
export async function createTestUser(
  prisma: PrismaService,
  email?: string,
  nickname?: string,
  password = 'Test@123456',
): Promise<TestUser> {
  const userEmail = email ?? uniqueEmail();
  const user = await prisma.user.create({
    data: {
      email: userEmail,
      nickname: nickname ?? 'E2eUser',
      status: UserStatus.active,
    },
  });
  await prisma.account.create({
    data: {
      id: randomUUID(),
      userId: user.id,
      providerId: 'credential',
      issuer: 'local:credential',
      accountId: user.id,
      password: await argon2.hash(password, ARGON2_OPTIONS),
    },
  });
  return {
    id: user.id,
    email: user.email,
    nickname: user.nickname,
    status: user.status,
  };
}

/**
 * Register a credential user through the public auth API so that the account
 * has a valid credential password and Better Auth account record.
 */
export async function registerTestUser(
  ctx: E2eTestContext,
  email?: string,
  password = 'Test@123456',
  nickname = 'RegisteredUser',
): Promise<RegisteredTestUser> {
  const userEmail = email ?? uniqueEmail('registered');
  const code = '123456';
  const cache = ctx.app.get(CACHE_MANAGER) as Cache;
  const hash = createHash('sha256')
    .update(`register:${userEmail}:${code}`)
    .digest('hex');
  await cache.set(
    `vcode:register:${userEmail}`,
    hash,
    VERIFICATION_CODE_TTL_MS,
  );

  const res = await request(ctx.app.getHttpServer())
    .post('/api/v1/auth/register')
    .send({
      email: userEmail,
      password,
      code,
      nickname,
    })
    .expect(201);

  const body = res.body as {
    data: {
      user: { id: string; email: string; nickname: string | null };
      tokens: { accessToken: string; refreshToken: string };
    };
  };
  const { user, tokens } = body.data;
  return {
    id: user.id,
    email: user.email,
    nickname: user.nickname,
    status: UserStatus.active,
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken,
  };
}

// ── JWT Helpers ────────────────────────────────────────────────

/**
 * Create a signed access token for the given user.
 */
export async function createAccessToken(
  jwtService: JwtService,
  configService: ConfigService,
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
    { sub: userId, email, status: 'active' },
    {
      secret: jwtCfg.accessSecret,
      expiresIn: jwtCfg.accessTtl,
      algorithm: 'HS512' as const,
      issuer: jwtCfg.issuer,
      audience: jwtCfg.audience,
    },
  );
}

// ── HTTP Helpers ───────────────────────────────────────────────

/**
 * Format a Bearer token string.
 */
export function bearer(token: string): string {
  return `${BEARER_AUTH_SCHEME} ${token}`;
}

/**
 * Assert that `body` is non-null and return it typed.
 */
export function expectData<T>(body: T): T {
  expect(body).toBeDefined();
  return body;
}

/**
 * Assert that a value is defined and return it typed, or throw.
 */
export function expectDefined<T>(
  value: T | undefined | null,
  message: string,
): T {
  expect(value).toBeDefined();
  if (value === undefined || value === null) {
    throw new Error(message);
  }
  return value;
}
