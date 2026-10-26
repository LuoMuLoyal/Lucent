import { Test, type TestingModule } from '@nestjs/testing';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import type { Cache } from 'cache-manager';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { FastifyAdapter } from '@nestjs/platform-fastify';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import * as argon2 from 'argon2';

import { AppModule } from '../../src/app.module.js';
import { ARGON2_OPTIONS } from '../../src/modules/auth/index.js';
import type { ChallengeState } from '../../src/modules/auth/domain/challenge/challenge.js';
import { deriveCodeHash } from '../../src/modules/auth/domain/challenge/verification-code.js';
import { setupApp } from '../../src/setup-app.js';
import { PrismaService } from '../../src/prisma/index.js';
import { ConfigKey } from '../../src/config/env/config-keys.enum.js';
import { UserStatus } from '#generated/prisma/client.js';

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
      // content-type parser manually so an absent body is accepted and
      // malformed JSON maps to 400 Problem Details rather than a 500.
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
  password = 'LucentE2e!2345',
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
    // Email is nullable since OAuth-only accounts can omit it, but this
    // helper always creates a credential user with one.
    email: user.email ?? userEmail,
    nickname: user.nickname,
    status: user.status,
  };
}

/**
 * Seed a verification code directly into the cache, bypassing mail delivery.
 *
 * The stored value is the challenge **aggregate state** (`ChallengeState`), not
 * a bare hash: the attempt counter has to live in the same cache entry as the
 * code so that exhausting one is atomic with invalidating the other (see
 * `domain/challenge/challenge.ts`). Seeding a bare hash here would make
 * `verify()` read `attempts` off `undefined` and reject every code — which is
 * exactly what happened when S3 changed the stored shape and left these
 * fixtures behind.
 *
 * Kept in the shared helper so the shape has one definition in the test tree;
 * a fixture that hand-builds it will silently rot the next time it changes.
 */
export async function seedVerificationCode(
  ctx: E2eTestContext,
  scene: string,
  email: string,
  code: string,
  ttlMs = VERIFICATION_CODE_TTL_MS,
): Promise<void> {
  const cache = ctx.app.get(CACHE_MANAGER) as Cache;
  const state: ChallengeState = {
    scene,
    email,
    codeHash: deriveCodeHash(code, scene, email),
    attempts: 0,
    issuedAtMs: Date.now(),
  };
  await cache.set(`vcode:${scene}:${email}`, state, ttlMs);
}

/**
 * Register a credential user through the public auth API so that the account
 * has a valid credential password and an accounts credential record.
 */
export async function registerTestUser(
  ctx: E2eTestContext,
  email?: string,
  password = 'LucentE2e!2345',
  nickname = 'RegisteredUser',
): Promise<RegisteredTestUser> {
  const userEmail = email ?? uniqueEmail('registered');
  const code = '123456';
  await seedVerificationCode(ctx, 'register', userEmail, code);

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
    user: { id: string; email: string; nickname: string | null };
    tokens: { accessToken: string; refreshToken: string };
  };
  const { user, tokens } = body;
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
