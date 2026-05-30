import { Test, type TestingModule } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import request from 'supertest';
import type { App } from 'supertest/types';

import { AppModule } from '../src/app.module';
import { setupApp } from '../src/setup-app';
import { ResultCode } from '../src/common/api-envelope';
import type { ApiEnvelope } from '../src/common/api-envelope';
import { PrismaService } from '../src/prisma/prisma.service';
import {
  LactationState,
  MedicineSource,
  PregnancyState,
  SexAtBirth,
  UnitSystem,
  UserAllergyKind,
  UserAllergySeverity,
  UserConditionStatus,
  UserStatus,
} from '../src/generated/prisma/client';
import { ConfigKey } from '../src/config/config-keys.enum';

interface HealthContextData {
  summary: {
    age: number | null;
    onboardingCompleted: boolean;
    activeAllergyCount: number;
    conditionCount: number;
    currentMedicineCount: number;
    missingCoreProfileFields: string[];
  };
  profile: {
    birthDate: string | null;
    sexAtBirth: SexAtBirth | null;
    heightCm: number | null;
    pregnancyState: PregnancyState | null;
    lactationState: LactationState | null;
    bloodType: string | null;
    locale: string | null;
    timezone: string | null;
    unitSystem: UnitSystem | null;
    onboardingCompletedAt: string | null;
    extras: unknown;
  };
  allergies: Array<{
    id: string;
    label: string;
    kind: UserAllergyKind;
    severity: UserAllergySeverity | null;
  }>;
  conditions: Array<{
    id: string;
    label: string;
    status: UserConditionStatus;
    diagnosedAt: string | null;
  }>;
  currentMedicines: Array<{
    id: string;
    displayName: string;
    source: MedicineSource;
    startedAt: string | null;
  }>;
}

const HEALTH_CONTEXT_PATH = '/api/v1/me/health-context';
const AUTHORIZATION_HEADER = 'Authorization';
const BEARER_AUTH_SCHEME = 'Bearer';
const TEST_EMAIL_DOMAIN = 'example.com';

let seededUserSeq = 0;

function bearer(accessToken: string): string {
  return `${BEARER_AUTH_SCHEME} ${accessToken}`;
}

function uniqueEmail(): string {
  seededUserSeq += 1;
  return `healthcontext${String(seededUserSeq)}_${String(Date.now())}@${TEST_EMAIL_DOMAIN}`;
}

function expectData<T>(body: ApiEnvelope<T>): T {
  expect(body.data).not.toBeNull();
  return body.data as T;
}

describe('User Health Context API (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let jwtService: JwtService;
  let configService: ConfigService;

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

    await prisma.userCurrentMedicine.deleteMany();
    await prisma.userCondition.deleteMany();
    await prisma.userAllergy.deleteMany();
    await prisma.userSession.deleteMany();
    await prisma.user.deleteMany();
  });

  afterAll(async () => {
    await prisma.userCurrentMedicine.deleteMany();
    await prisma.userCondition.deleteMany();
    await prisma.userAllergy.deleteMany();
    await prisma.userSession.deleteMany();
    await prisma.user.deleteMany();
    await app.close();
  });

  async function createAccessToken(
    userId: string,
    email: string,
  ): Promise<string> {
    const jwtConfig = configService.getOrThrow<{
      accessSecret: string;
      accessTtl: number;
    }>(ConfigKey.Jwt);

    return jwtService.signAsync(
      { sub: userId, email },
      {
        secret: jwtConfig.accessSecret,
        expiresIn: jwtConfig.accessTtl,
        algorithm: 'HS512',
      },
    );
  }

  it('should return the authenticated user health context aggregate', async () => {
    const email = uniqueEmail();
    const user = await prisma.user.create({
      data: {
        email,
        passwordHash: '$argon2id$mock',
        nickname: 'Health User',
        status: UserStatus.active,
        emailVerifiedAt: new Date('2026-05-01T00:00:00.000Z'),
        profile: {
          create: {
            birthDate: new Date('1998-03-15T00:00:00.000Z'),
            sexAtBirth: SexAtBirth.female,
            heightCm: 168,
            pregnancyState: PregnancyState.not_pregnant,
            lactationState: LactationState.no,
            bloodType: 'O+',
            locale: 'en-US',
            timezone: 'Asia/Shanghai',
            unitSystem: UnitSystem.metric,
            onboardingCompletedAt: new Date('2026-05-01T08:00:00.000Z'),
            extras: {
              preferredReminderHour: 9,
            },
          },
        },
        allergies: {
          create: [
            {
              kind: UserAllergyKind.drug,
              label: 'Penicillin',
              reaction: 'Rash',
              severity: UserAllergySeverity.severe,
              isActive: true,
              note: 'Avoid completely',
              extras: { source: 'manual' },
              recordedAt: new Date('2026-05-20T09:00:00.000Z'),
            },
            {
              kind: UserAllergyKind.food,
              label: 'Shrimp',
              severity: UserAllergySeverity.mild,
              isActive: false,
            },
          ],
        },
        conditions: {
          create: [
            {
              label: 'Asthma',
              status: UserConditionStatus.active,
              diagnosedAt: new Date('2024-02-01T00:00:00.000Z'),
              note: 'Triggered during pollen season',
              extras: { severityBand: 'moderate' },
            },
          ],
        },
        currentMedicines: {
          create: [
            {
              source: MedicineSource.drugbank,
              sourceRefId: 'DB01050',
              displayName: 'Ibuprofen',
              strengthText: '200 mg',
              doseText: '1 tablet after meals',
              route: 'oral',
              startedAt: new Date('2026-05-01T00:00:00.000Z'),
              isCurrent: true,
              note: 'Use only when needed for headaches',
              sourcePayload: { ingredient: 'ibuprofen' },
            },
            {
              source: MedicineSource.manual,
              displayName: 'Old medicine',
              isCurrent: false,
            },
          ],
        },
      },
    });

    const accessToken = await createAccessToken(user.id, user.email);

    const response = await request(app.getHttpServer())
      .get(HEALTH_CONTEXT_PATH)
      .set(AUTHORIZATION_HEADER, bearer(accessToken))
      .expect(200);

    const body = response.body as ApiEnvelope<HealthContextData>;
    expect(body.code).toBe(ResultCode.SUCCESS);

    const data = expectData(body);
    expect(data.summary.onboardingCompleted).toBe(true);
    expect(data.summary.activeAllergyCount).toBe(1);
    expect(data.summary.conditionCount).toBe(1);
    expect(data.summary.currentMedicineCount).toBe(1);
    expect(data.summary.missingCoreProfileFields).toEqual([]);

    expect(data.profile).toEqual({
      birthDate: '1998-03-15',
      sexAtBirth: SexAtBirth.female,
      heightCm: 168,
      pregnancyState: PregnancyState.not_pregnant,
      lactationState: LactationState.no,
      bloodType: 'O+',
      locale: 'en-US',
      timezone: 'Asia/Shanghai',
      unitSystem: UnitSystem.metric,
      onboardingCompletedAt: '2026-05-01T08:00:00.000Z',
      extras: {
        preferredReminderHour: 9,
      },
    });

    expect(data.allergies).toHaveLength(1);
    expect(data.allergies[0]).toMatchObject({
      label: 'Penicillin',
      kind: UserAllergyKind.drug,
      severity: UserAllergySeverity.severe,
    });

    expect(data.conditions).toHaveLength(1);
    expect(data.conditions[0]).toMatchObject({
      label: 'Asthma',
      status: UserConditionStatus.active,
      diagnosedAt: '2024-02-01',
    });

    expect(data.currentMedicines).toHaveLength(1);
    expect(data.currentMedicines[0]).toMatchObject({
      displayName: 'Ibuprofen',
      source: MedicineSource.drugbank,
      startedAt: '2026-05-01',
    });
  });

  it('should return not found when the JWT is valid but the user record does not exist', async () => {
    const email = uniqueEmail();
    const accessToken = await createAccessToken('missing-user-id', email);

    const response = await request(app.getHttpServer())
      .get(HEALTH_CONTEXT_PATH)
      .set(AUTHORIZATION_HEADER, bearer(accessToken))
      .expect(404);

    const body = response.body as ApiEnvelope;
    expect(body.code).toBe(ResultCode.NOT_FOUND);
    expect(body.message).toBe('User not found');
  });
});
