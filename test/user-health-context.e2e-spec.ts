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

  it('should update profile fields for the authenticated user', async () => {
    const email = uniqueEmail();
    const user = await prisma.user.create({
      data: {
        email,
        passwordHash: '$argon2id$mock',
        status: UserStatus.active,
        profile: {
          create: {
            locale: 'en',
            timezone: 'UTC',
            unitSystem: UnitSystem.imperial,
          },
        },
      },
    });

    const accessToken = await createAccessToken(user.id, user.email);

    const response = await request(app.getHttpServer())
      .patch(`${HEALTH_CONTEXT_PATH}/profile`)
      .set(AUTHORIZATION_HEADER, bearer(accessToken))
      .send({
        locale: ' zh-CN ',
        timezone: null,
        unitSystem: UnitSystem.metric,
        birthDate: '1998-03-15',
        sexAtBirth: SexAtBirth.female,
        heightCm: 168,
        pregnancyState: PregnancyState.not_pregnant,
        lactationState: LactationState.no,
        bloodType: 'O+',
        onboardingCompleted: true,
      })
      .expect(200);

    const body = response.body as ApiEnvelope<HealthContextData>;
    expect(body.code).toBe(ResultCode.SUCCESS);

    const data = expectData(body);
    expect(data.profile.locale).toBe('zh-CN');
    expect(data.profile.timezone).toBeNull();
    expect(data.profile.unitSystem).toBe(UnitSystem.metric);
    expect(data.profile.birthDate).toBe('1998-03-15');
    expect(data.profile.sexAtBirth).toBe(SexAtBirth.female);
    expect(data.profile.heightCm).toBe(168);
    expect(data.profile.pregnancyState).toBe(PregnancyState.not_pregnant);
    expect(data.profile.lactationState).toBe(LactationState.no);
    expect(data.profile.bloodType).toBe('O+');
    expect(data.summary.onboardingCompleted).toBe(true);

    const storedProfile = await prisma.userProfile.findUniqueOrThrow({
      where: { userId: user.id },
    });
    expect(storedProfile.locale).toBe('zh-CN');
    expect(storedProfile.timezone).toBeNull();
    expect(storedProfile.unitSystem).toBe(UnitSystem.metric);
    expect(storedProfile.birthDate).toEqual(
      new Date('1998-03-15T00:00:00.000Z'),
    );
    expect(storedProfile.sexAtBirth).toBe(SexAtBirth.female);
    expect(storedProfile.heightCm).toBe(168);
    expect(storedProfile.pregnancyState).toBe(PregnancyState.not_pregnant);
    expect(storedProfile.lactationState).toBe(LactationState.no);
    expect(storedProfile.bloodType).toBe('O+');
    expect(storedProfile.onboardingCompletedAt).not.toBeNull();
  });

  it('should clear profile fields when sending null', async () => {
    const email = uniqueEmail();
    const user = await prisma.user.create({
      data: {
        email,
        passwordHash: '$argon2id$mock',
        status: UserStatus.active,
        profile: {
          create: {
            birthDate: new Date('1998-03-15T00:00:00.000Z'),
            sexAtBirth: SexAtBirth.female,
            heightCm: 168,
            bloodType: 'O+',
          },
        },
      },
    });

    const accessToken = await createAccessToken(user.id, user.email);

    const response = await request(app.getHttpServer())
      .patch(`${HEALTH_CONTEXT_PATH}/profile`)
      .set(AUTHORIZATION_HEADER, bearer(accessToken))
      .send({
        birthDate: null,
        sexAtBirth: null,
        heightCm: null,
        bloodType: null,
      })
      .expect(200);

    const body = response.body as ApiEnvelope<HealthContextData>;
    expect(body.code).toBe(ResultCode.SUCCESS);

    const data = expectData(body);
    expect(data.profile.birthDate).toBeNull();
    expect(data.profile.sexAtBirth).toBeNull();
    expect(data.profile.heightCm).toBeNull();
    expect(data.profile.bloodType).toBeNull();

    const storedProfile = await prisma.userProfile.findUniqueOrThrow({
      where: { userId: user.id },
    });
    expect(storedProfile.birthDate).toBeNull();
    expect(storedProfile.sexAtBirth).toBeNull();
    expect(storedProfile.heightCm).toBeNull();
    expect(storedProfile.bloodType).toBeNull();
  });

  it('should reject invalid birthDate format', async () => {
    const email = uniqueEmail();
    const user = await prisma.user.create({
      data: {
        email,
        passwordHash: '$argon2id$mock',
        status: UserStatus.active,
      },
    });

    const accessToken = await createAccessToken(user.id, user.email);

    await request(app.getHttpServer())
      .patch(`${HEALTH_CONTEXT_PATH}/profile`)
      .set(AUTHORIZATION_HEADER, bearer(accessToken))
      .send({ birthDate: '15-03-1998' })
      .expect(400);
  });

  it('should reject heightCm out of range', async () => {
    const email = uniqueEmail();
    const user = await prisma.user.create({
      data: {
        email,
        passwordHash: '$argon2id$mock',
        status: UserStatus.active,
      },
    });

    const accessToken = await createAccessToken(user.id, user.email);

    await request(app.getHttpServer())
      .patch(`${HEALTH_CONTEXT_PATH}/profile`)
      .set(AUTHORIZATION_HEADER, bearer(accessToken))
      .send({ heightCm: 0 })
      .expect(400);

    await request(app.getHttpServer())
      .patch(`${HEALTH_CONTEXT_PATH}/profile`)
      .set(AUTHORIZATION_HEADER, bearer(accessToken))
      .send({ heightCm: 301 })
      .expect(400);
  });

  it('should reject unsupported sexAtBirth enum value', async () => {
    const email = uniqueEmail();
    const user = await prisma.user.create({
      data: {
        email,
        passwordHash: '$argon2id$mock',
        status: UserStatus.active,
      },
    });

    const accessToken = await createAccessToken(user.id, user.email);

    await request(app.getHttpServer())
      .patch(`${HEALTH_CONTEXT_PATH}/profile`)
      .set(AUTHORIZATION_HEADER, bearer(accessToken))
      .send({ sexAtBirth: 'alien' })
      .expect(400);
  });

  // ── Allergy e2e ──

  it('should create an allergy and return the refreshed aggregate', async () => {
    const email = uniqueEmail();
    const user = await prisma.user.create({
      data: {
        email,
        passwordHash: '$argon2id$mock',
        status: UserStatus.active,
      },
    });

    const accessToken = await createAccessToken(user.id, user.email);

    const response = await request(app.getHttpServer())
      .post(`${HEALTH_CONTEXT_PATH}/allergies`)
      .set(AUTHORIZATION_HEADER, bearer(accessToken))
      .send({
        kind: UserAllergyKind.drug,
        label: ' Penicillin ',
        reaction: 'Rash',
        severity: UserAllergySeverity.moderate,
        note: 'Avoid completely',
        recordedAt: '2026-06-03T09:00:00.000Z',
      })
      .expect(201);

    const body = response.body as ApiEnvelope<HealthContextData>;
    expect(body.code).toBe(ResultCode.SUCCESS);

    const data = expectData(body);
    expect(data.summary.activeAllergyCount).toBe(1);
    expect(data.allergies[0].label).toBe('Penicillin');
    expect(data.allergies[0].kind).toBe(UserAllergyKind.drug);
    expect(data.allergies[0].isActive).toBe(true);

    // Verify persistence
    const stored = await prisma.userAllergy.findFirstOrThrow({
      where: { userId: user.id },
    });
    expect(stored.label).toBe('Penicillin');
    expect(stored.isActive).toBe(true);
  });

  it('should update an allergy', async () => {
    const email = uniqueEmail();
    const user = await prisma.user.create({
      data: {
        email,
        passwordHash: '$argon2id$mock',
        status: UserStatus.active,
        allergies: {
          create: {
            kind: UserAllergyKind.drug,
            label: 'Penicillin',
            severity: UserAllergySeverity.mild,
          },
        },
      },
    });

    const allergy = await prisma.userAllergy.findFirstOrThrow({
      where: { userId: user.id },
    });
    const accessToken = await createAccessToken(user.id, user.email);

    const response = await request(app.getHttpServer())
      .patch(`${HEALTH_CONTEXT_PATH}/allergies/${allergy.id}`)
      .set(AUTHORIZATION_HEADER, bearer(accessToken))
      .send({ label: ' Penicillin G ', severity: UserAllergySeverity.severe })
      .expect(200);

    const data = expectData(response.body as ApiEnvelope<HealthContextData>);
    expect(data.allergies[0].label).toBe('Penicillin G');
    expect(data.allergies[0].severity).toBe(UserAllergySeverity.severe);
  });

  it('should soft-delete an allergy', async () => {
    const email = uniqueEmail();
    const user = await prisma.user.create({
      data: {
        email,
        passwordHash: '$argon2id$mock',
        status: UserStatus.active,
        allergies: {
          create: {
            kind: UserAllergyKind.food,
            label: 'Shrimp',
          },
        },
      },
    });

    const allergy = await prisma.userAllergy.findFirstOrThrow({
      where: { userId: user.id },
    });
    const accessToken = await createAccessToken(user.id, user.email);

    const response = await request(app.getHttpServer())
      .delete(`${HEALTH_CONTEXT_PATH}/allergies/${allergy.id}`)
      .set(AUTHORIZATION_HEADER, bearer(accessToken))
      .expect(200);

    const data = expectData(response.body as ApiEnvelope<HealthContextData>);
    // Active allergies should be 0 after soft delete
    expect(data.summary.activeAllergyCount).toBe(0);

    // Verify persistence: isActive=false, row still exists
    const stored = await prisma.userAllergy.findUniqueOrThrow({
      where: { id: allergy.id },
    });
    expect(stored.isActive).toBe(false);
  });

  it('should return 404 when accessing a foreign allergy', async () => {
    const email1 = uniqueEmail();
    const user1 = await prisma.user.create({
      data: {
        email: email1,
        passwordHash: '$argon2id$mock',
        status: UserStatus.active,
        allergies: {
          create: { kind: UserAllergyKind.drug, label: 'Penicillin' },
        },
      },
    });

    const email2 = uniqueEmail();
    const user2 = await prisma.user.create({
      data: {
        email: email2,
        passwordHash: '$argon2id$mock',
        status: UserStatus.active,
      },
    });

    const allergy = await prisma.userAllergy.findFirstOrThrow({
      where: { userId: user1.id },
    });
    const accessToken = await createAccessToken(user2.id, user2.email);

    await request(app.getHttpServer())
      .patch(`${HEALTH_CONTEXT_PATH}/allergies/${allergy.id}`)
      .set(AUTHORIZATION_HEADER, bearer(accessToken))
      .send({ label: 'X' })
      .expect(404);
  });

  // ── Condition e2e ──

  it('should create a condition and return the refreshed aggregate', async () => {
    const email = uniqueEmail();
    const user = await prisma.user.create({
      data: {
        email,
        passwordHash: '$argon2id$mock',
        status: UserStatus.active,
      },
    });

    const accessToken = await createAccessToken(user.id, user.email);

    const response = await request(app.getHttpServer())
      .post(`${HEALTH_CONTEXT_PATH}/conditions`)
      .set(AUTHORIZATION_HEADER, bearer(accessToken))
      .send({
        label: ' Asthma ',
        status: UserConditionStatus.active,
        diagnosedAt: '2024-02-01',
        note: 'Triggered during pollen season',
      })
      .expect(201);

    const body = response.body as ApiEnvelope<HealthContextData>;
    expect(body.code).toBe(ResultCode.SUCCESS);

    const data = expectData(body);
    expect(data.summary.conditionCount).toBe(1);
    expect(data.conditions[0].label).toBe('Asthma');
    expect(data.conditions[0].status).toBe(UserConditionStatus.active);
    expect(data.conditions[0].diagnosedAt).toBe('2024-02-01');

    // Verify persistence
    const stored = await prisma.userCondition.findFirstOrThrow({
      where: { userId: user.id },
    });
    expect(stored.label).toBe('Asthma');
    expect(stored.status).toBe(UserConditionStatus.active);
  });

  it('should update a condition', async () => {
    const email = uniqueEmail();
    const user = await prisma.user.create({
      data: {
        email,
        passwordHash: '$argon2id$mock',
        status: UserStatus.active,
        conditions: {
          create: {
            label: 'Asthma',
            status: UserConditionStatus.active,
            diagnosedAt: new Date('2024-02-01T00:00:00.000Z'),
          },
        },
      },
    });

    const condition = await prisma.userCondition.findFirstOrThrow({
      where: { userId: user.id },
    });
    const accessToken = await createAccessToken(user.id, user.email);

    const response = await request(app.getHttpServer())
      .patch(`${HEALTH_CONTEXT_PATH}/conditions/${condition.id}`)
      .set(AUTHORIZATION_HEADER, bearer(accessToken))
      .send({
        label: ' Asthma Updated ',
        status: UserConditionStatus.suspected,
      })
      .expect(200);

    const data = expectData(response.body as ApiEnvelope<HealthContextData>);
    expect(data.conditions[0].label).toBe('Asthma Updated');
    expect(data.conditions[0].status).toBe(UserConditionStatus.suspected);
  });

  it('should soft-resolve a condition', async () => {
    const email = uniqueEmail();
    const user = await prisma.user.create({
      data: {
        email,
        passwordHash: '$argon2id$mock',
        status: UserStatus.active,
        conditions: {
          create: {
            label: 'Asthma',
            status: UserConditionStatus.active,
          },
        },
      },
    });

    const condition = await prisma.userCondition.findFirstOrThrow({
      where: { userId: user.id },
    });
    const accessToken = await createAccessToken(user.id, user.email);

    const response = await request(app.getHttpServer())
      .delete(`${HEALTH_CONTEXT_PATH}/conditions/${condition.id}`)
      .set(AUTHORIZATION_HEADER, bearer(accessToken))
      .expect(200);

    const data = expectData(response.body as ApiEnvelope<HealthContextData>);
    expect(data.conditions[0].status).toBe(UserConditionStatus.resolved);
    expect(data.conditions[0].resolvedAt).not.toBeNull();

    // Verify persistence
    const stored = await prisma.userCondition.findUniqueOrThrow({
      where: { id: condition.id },
    });
    expect(stored.status).toBe(UserConditionStatus.resolved);
    expect(stored.resolvedAt).not.toBeNull();
  });

  it('should return 404 when accessing a foreign condition', async () => {
    const email1 = uniqueEmail();
    const user1 = await prisma.user.create({
      data: {
        email: email1,
        passwordHash: '$argon2id$mock',
        status: UserStatus.active,
        conditions: {
          create: { label: 'Asthma', status: UserConditionStatus.active },
        },
      },
    });

    const email2 = uniqueEmail();
    const user2 = await prisma.user.create({
      data: {
        email: email2,
        passwordHash: '$argon2id$mock',
        status: UserStatus.active,
      },
    });

    const condition = await prisma.userCondition.findFirstOrThrow({
      where: { userId: user1.id },
    });
    const accessToken = await createAccessToken(user2.id, user2.email);

    await request(app.getHttpServer())
      .patch(`${HEALTH_CONTEXT_PATH}/conditions/${condition.id}`)
      .set(AUTHORIZATION_HEADER, bearer(accessToken))
      .send({ label: 'X' })
      .expect(404);
  });

  // ── Current medicine e2e ──

  it('should create a current medicine and return the refreshed aggregate', async () => {
    const email = uniqueEmail();
    const user = await prisma.user.create({
      data: {
        email,
        passwordHash: '$argon2id$mock',
        status: UserStatus.active,
      },
    });

    const accessToken = await createAccessToken(user.id, user.email);

    const response = await request(app.getHttpServer())
      .post(`${HEALTH_CONTEXT_PATH}/current-medicines`)
      .set(AUTHORIZATION_HEADER, bearer(accessToken))
      .send({
        source: MedicineSource.drugbank,
        sourceRefId: 'DB01050',
        displayName: ' Ibuprofen ',
        strengthText: '200 mg',
        doseText: '1 tablet after meals',
        route: 'oral',
        startedAt: '2026-06-03',
      })
      .expect(201);

    const body = response.body as ApiEnvelope<HealthContextData>;
    expect(body.code).toBe(ResultCode.SUCCESS);

    const data = expectData(body);
    expect(data.summary.currentMedicineCount).toBe(1);
    expect(data.currentMedicines[0].displayName).toBe('Ibuprofen');
    expect(data.currentMedicines[0].source).toBe(MedicineSource.drugbank);
    expect(data.currentMedicines[0].isCurrent).toBe(true);
  });

  it('should update a current medicine', async () => {
    const email = uniqueEmail();
    const user = await prisma.user.create({
      data: {
        email,
        passwordHash: '$argon2id$mock',
        status: UserStatus.active,
        currentMedicines: {
          create: {
            source: MedicineSource.drugbank,
            sourceRefId: 'DB01050',
            displayName: 'Ibuprofen',
          },
        },
      },
    });

    const medicine = await prisma.userCurrentMedicine.findFirstOrThrow({
      where: { userId: user.id },
    });
    const accessToken = await createAccessToken(user.id, user.email);

    const response = await request(app.getHttpServer())
      .patch(`${HEALTH_CONTEXT_PATH}/current-medicines/${medicine.id}`)
      .set(AUTHORIZATION_HEADER, bearer(accessToken))
      .send({ displayName: ' Ibuprofen G ', strengthText: '400 mg' })
      .expect(200);

    const data = expectData(response.body as ApiEnvelope<HealthContextData>);
    expect(data.currentMedicines[0].displayName).toBe('Ibuprofen G');
    expect(data.currentMedicines[0].strengthText).toBe('400 mg');
  });

  it('should soft-delete a current medicine', async () => {
    const email = uniqueEmail();
    const user = await prisma.user.create({
      data: {
        email,
        passwordHash: '$argon2id$mock',
        status: UserStatus.active,
        currentMedicines: {
          create: {
            source: MedicineSource.manual,
            displayName: 'Vitamin D',
          },
        },
      },
    });

    const medicine = await prisma.userCurrentMedicine.findFirstOrThrow({
      where: { userId: user.id },
    });
    const accessToken = await createAccessToken(user.id, user.email);

    const response = await request(app.getHttpServer())
      .delete(`${HEALTH_CONTEXT_PATH}/current-medicines/${medicine.id}`)
      .set(AUTHORIZATION_HEADER, bearer(accessToken))
      .expect(200);

    const data = expectData(response.body as ApiEnvelope<HealthContextData>);
    // isCurrent=false medicines are excluded from the aggregate
    expect(data.summary.currentMedicineCount).toBe(0);

    const stored = await prisma.userCurrentMedicine.findUniqueOrThrow({
      where: { id: medicine.id },
    });
    expect(stored.isCurrent).toBe(false);
    expect(stored.endedAt).not.toBeNull();
  });

  it('should return 404 when accessing a foreign current medicine', async () => {
    const email1 = uniqueEmail();
    const user1 = await prisma.user.create({
      data: {
        email: email1,
        passwordHash: '$argon2id$mock',
        status: UserStatus.active,
        currentMedicines: {
          create: {
            source: MedicineSource.manual,
            displayName: 'Vitamin D',
          },
        },
      },
    });

    const email2 = uniqueEmail();
    const user2 = await prisma.user.create({
      data: {
        email: email2,
        passwordHash: '$argon2id$mock',
        status: UserStatus.active,
      },
    });

    const medicine = await prisma.userCurrentMedicine.findFirstOrThrow({
      where: { userId: user1.id },
    });
    const accessToken = await createAccessToken(user2.id, user2.email);

    await request(app.getHttpServer())
      .patch(`${HEALTH_CONTEXT_PATH}/current-medicines/${medicine.id}`)
      .set(AUTHORIZATION_HEADER, bearer(accessToken))
      .send({ displayName: 'X' })
      .expect(404);
  });
});
