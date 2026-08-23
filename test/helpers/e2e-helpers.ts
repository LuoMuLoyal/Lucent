import { Test, type TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { FastifyAdapter } from '@nestjs/platform-fastify';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';

import { AppModule } from '../../src/app.module';
import { setupApp } from '../../src/setup-app';
import { PrismaService } from '../../src/prisma';
import { ConfigKey } from '../../src/config/env/config-keys.enum';
import { SecurityPinService } from '../../src/modules/security-pin';
import { unwrapResult } from '../../src/common/result';
import { UserStatus } from '#generated/prisma/client';

// ── Constants ──────────────────────────────────────────────────

export const AUTHORIZATION_HEADER = 'Authorization';
export const BEARER_AUTH_SCHEME = 'Bearer';
export const SECURITY_ELEVATION_HEADER = 'x-security-elevation';
export const DEFAULT_SECURITY_PIN = '123456';

// ── E2E Test App Setup ─────────────────────────────────────────

/** Convenience type alias for a NestJS Fastify app wired to the supertest App type. */
export type E2eApp = NestFastifyApplication;

export interface E2eTestContext {
  app: E2eApp;
  prisma: PrismaService;
  jwtService: JwtService;
  configService: ConfigService;
  securityPinService: SecurityPinService;
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
  const securityPinService = app.get(SecurityPinService);

  return { app, prisma, jwtService, configService, securityPinService };
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
  await prisma.userIdentity.deleteMany();
  await prisma.userSession.deleteMany();
  await prisma.userProfile.deleteMany();

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

/**
 * Create a minimal active test user and return its info.
 */
export async function createTestUser(
  prisma: PrismaService,
  email?: string,
  nickname?: string,
): Promise<TestUser> {
  const userEmail = email ?? uniqueEmail();
  const user = await prisma.user.create({
    data: {
      email: userEmail,
      passwordHash: '$argon2id$mock',
      nickname: nickname ?? 'E2eUser',
      status: UserStatus.active,
    },
  });
  return {
    id: user.id,
    email: user.email ?? userEmail,
    nickname: user.nickname,
    status: user.status,
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

/**
 * Enable a Security PIN for the user and mint a fresh elevation token.
 */
export async function createSecurityElevationToken(
  ctx: E2eTestContext,
  userId: string,
  pin = DEFAULT_SECURITY_PIN,
): Promise<string> {
  await unwrapResult(ctx.securityPinService.enable(userId, { pin }));
  const result = await unwrapResult(
    ctx.securityPinService.verify(userId, { pin }),
  );
  return result.elevationToken;
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
