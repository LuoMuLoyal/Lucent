import request from 'supertest';

import {
  createTestApp,
  cleanupDatabase,
  createAccessToken,
  bearer,
  expectData,
  expectDefined,
  uniqueEmail,
} from '../../helpers/e2e-helpers';
import type { E2eTestContext, E2eApp } from '../../helpers/e2e-helpers';
import {
  MedicineSource,
  SexAtBirth,
  UnitSystem,
  UserAllergyKind,
  UserAllergySeverity,
  UserConditionStatus,
  UserStatus,
} from '#generated/prisma/client';

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
    isActive: boolean;
  }>;
  conditions: Array<{
    id: string;
    label: string;
    status: UserConditionStatus;
    diagnosedAt: string | null;
    resolvedAt: string | null;
  }>;
  currentMedicines: Array<{
    id: string;
    displayName: string;
    source: MedicineSource;
    startedAt: string | null;
    isCurrent: boolean;
    strengthText: string | null;
  }>;
}

const HEALTH_CONTEXT_PATH = '/api/v1/user/health-context';
const AUTH_HEADER = 'Authorization';

describe('User Health Context API (e2e)', () => {
  let ctx: E2eTestContext;
  let app: E2eApp;

  beforeAll(async () => {
    ctx = await createTestApp();
    app = ctx.app;
    await cleanupDatabase(ctx.prisma);
  });

  afterAll(async () => {
    await cleanupDatabase(ctx.prisma);
    await app.close();
  });

  async function makeToken(userId: string, email: string): Promise<string> {
    return createAccessToken(ctx.jwtService, ctx.configService, userId, email);
  }

  it('should return the authenticated user health context aggregate', async () => {
    const email = uniqueEmail('hc');
    const user = await ctx.prisma.user.create({
      data: {
        email,
        nickname: 'Health User',
        status: UserStatus.active,
        emailVerifiedAt: new Date('2026-05-01T00:00:00.000Z'),
        profile: {
          create: {
            birthDate: new Date('1998-03-15T00:00:00.000Z'),
            sexAtBirth: SexAtBirth.female,
            heightCm: 168,
            bloodType: 'O+',
            locale: 'en-US',
            timezone: 'Asia/Shanghai',
            unitSystem: UnitSystem.metric,
            onboardingCompletedAt: new Date('2026-05-01T08:00:00.000Z'),
            extras: { preferredReminderHour: 9 },
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

    const accessToken = await makeToken(
      user.id,
      expectDefined(user.email, 'Expected user email'),
    );

    const response = await request(app.getHttpServer())
      .get(HEALTH_CONTEXT_PATH)
      .set(AUTH_HEADER, bearer(accessToken))
      .expect(200);

    const body = response.body as HealthContextData;

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
      weightKg: null,
      bloodType: 'O+',
      locale: 'en-US',
      timezone: 'Asia/Shanghai',
      unitSystem: UnitSystem.metric,
      onboardingCompletedAt: '2026-05-01T08:00:00.000Z',
      emergencyContact: null,
      extras: { preferredReminderHour: 9 },
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

  it('should return not found when the JWT is valid but user does not exist', async () => {
    const accessToken = await makeToken('missing-user-id', 'ghost@example.com');

    const response = await request(app.getHttpServer())
      .get(HEALTH_CONTEXT_PATH)
      .set(AUTH_HEADER, bearer(accessToken))
      .expect(404);

    const body = response.body as Record<string, unknown>;
    expect(body['code']).toBe('RESOURCE_NOT_FOUND');
    // Detail is the generic i18n message, not a custom "User not found" string.
    expect(body['detail']).toBeDefined();
  });

  it('should update profile fields for the authenticated user', async () => {
    const email = uniqueEmail('hc');
    const user = await ctx.prisma.user.create({
      data: {
        email,
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

    const accessToken = await makeToken(
      user.id,
      expectDefined(user.email, 'Expected user email'),
    );

    const response = await request(app.getHttpServer())
      .patch(`${HEALTH_CONTEXT_PATH}/profile`)
      .set(AUTH_HEADER, bearer(accessToken))
      .send({
        locale: ' zh-CN ',
        timezone: null,
        unitSystem: UnitSystem.metric,
        birthDate: '1998-03-15',
        sexAtBirth: SexAtBirth.female,
        heightCm: 168,
        bloodType: 'O+',
        onboardingCompleted: true,
      })
      .expect(200);

    const body = response.body as HealthContextData;

    const data = expectData(body);
    expect(data.profile.locale).toBe('zh-CN');
    expect(data.profile.timezone).toBeNull();
    expect(data.profile.unitSystem).toBe(UnitSystem.metric);
    expect(data.profile.birthDate).toBe('1998-03-15');
    expect(data.profile.sexAtBirth).toBe(SexAtBirth.female);
    expect(data.profile.heightCm).toBe(168);
    expect(data.profile.bloodType).toBe('O+');
    expect(data.summary.onboardingCompleted).toBe(true);

    const storedProfile = await ctx.prisma.userProfile.findUniqueOrThrow({
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
    expect(storedProfile.bloodType).toBe('O+');
    expect(storedProfile.onboardingCompletedAt).not.toBeNull();
  });

  it('should set onboardingCompletedAt when onboarding creates a profile', async () => {
    const email = uniqueEmail('hc');
    const user = await ctx.prisma.user.create({
      data: {
        email,
        status: UserStatus.active,
      },
    });

    const accessToken = await makeToken(
      user.id,
      expectDefined(user.email, 'Expected user email'),
    );

    const response = await request(app.getHttpServer())
      .patch(`${HEALTH_CONTEXT_PATH}/profile`)
      .set(AUTH_HEADER, bearer(accessToken))
      .send({ onboardingCompleted: true })
      .expect(200);

    const body = response.body as HealthContextData;

    const data = expectData(body);
    expect(data.summary.onboardingCompleted).toBe(true);
    expect(data.profile.onboardingCompletedAt).not.toBeNull();

    const storedProfile = await ctx.prisma.userProfile.findUniqueOrThrow({
      where: { userId: user.id },
    });
    expect(storedProfile.onboardingCompletedAt).not.toBeNull();
  });

  it('should clear profile fields when sending null', async () => {
    const email = uniqueEmail('hc');
    const user = await ctx.prisma.user.create({
      data: {
        email,
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

    const accessToken = await makeToken(
      user.id,
      expectDefined(user.email, 'Expected user email'),
    );

    const response = await request(app.getHttpServer())
      .patch(`${HEALTH_CONTEXT_PATH}/profile`)
      .set(AUTH_HEADER, bearer(accessToken))
      .send({
        birthDate: null,
        sexAtBirth: null,
        heightCm: null,
        bloodType: null,
      })
      .expect(200);

    const body = response.body as HealthContextData;

    const data = expectData(body);
    expect(data.profile.birthDate).toBeNull();
    expect(data.profile.sexAtBirth).toBeNull();
    expect(data.profile.heightCm).toBeNull();
    expect(data.profile.bloodType).toBeNull();

    const storedProfile = await ctx.prisma.userProfile.findUniqueOrThrow({
      where: { userId: user.id },
    });
    expect(storedProfile.birthDate).toBeNull();
    expect(storedProfile.sexAtBirth).toBeNull();
    expect(storedProfile.heightCm).toBeNull();
    expect(storedProfile.bloodType).toBeNull();
  });

  it('should reject invalid birthDate format', async () => {
    const email = uniqueEmail('hc');
    const user = await ctx.prisma.user.create({
      data: {
        email,
        status: UserStatus.active,
      },
    });

    const accessToken = await makeToken(
      user.id,
      expectDefined(user.email, 'Expected user email'),
    );

    await request(app.getHttpServer())
      .patch(`${HEALTH_CONTEXT_PATH}/profile`)
      .set(AUTH_HEADER, bearer(accessToken))
      .send({ birthDate: '15-03-1998' })
      .expect(400);
  });

  it('should reject heightCm out of range', async () => {
    const email = uniqueEmail('hc');
    const user = await ctx.prisma.user.create({
      data: {
        email,
        status: UserStatus.active,
      },
    });

    const accessToken = await makeToken(
      user.id,
      expectDefined(user.email, 'Expected user email'),
    );

    await request(app.getHttpServer())
      .patch(`${HEALTH_CONTEXT_PATH}/profile`)
      .set(AUTH_HEADER, bearer(accessToken))
      .send({ heightCm: 0 })
      .expect(400);

    await request(app.getHttpServer())
      .patch(`${HEALTH_CONTEXT_PATH}/profile`)
      .set(AUTH_HEADER, bearer(accessToken))
      .send({ heightCm: 301 })
      .expect(400);
  });

  it('should reject unsupported sexAtBirth enum value', async () => {
    const email = uniqueEmail('hc');
    const user = await ctx.prisma.user.create({
      data: {
        email,
        status: UserStatus.active,
      },
    });

    const accessToken = await makeToken(
      user.id,
      expectDefined(user.email, 'Expected user email'),
    );

    await request(app.getHttpServer())
      .patch(`${HEALTH_CONTEXT_PATH}/profile`)
      .set(AUTH_HEADER, bearer(accessToken))
      .send({ sexAtBirth: 'alien' })
      .expect(400);
  });

  // ── Allergy e2e ──

  it('should create an allergy and return the refreshed aggregate', async () => {
    const email = uniqueEmail('hc');
    const user = await ctx.prisma.user.create({
      data: {
        email,
        status: UserStatus.active,
      },
    });

    const accessToken = await makeToken(
      user.id,
      expectDefined(user.email, 'Expected user email'),
    );

    const response = await request(app.getHttpServer())
      .post(`${HEALTH_CONTEXT_PATH}/allergies`)
      .set(AUTH_HEADER, bearer(accessToken))
      .send({
        kind: UserAllergyKind.drug,
        label: ' Penicillin ',
        reaction: 'Rash',
        severity: UserAllergySeverity.moderate,
        note: 'Avoid completely',
        recordedAt: '2026-06-03T09:00:00.000Z',
      })
      .expect(201);

    const body = response.body as HealthContextData;

    const data = expectData(body);
    expect(data.summary.activeAllergyCount).toBe(1);
    expect(data.allergies).toHaveLength(1);
    const firstAllergy = expectDefined(
      data.allergies[0],
      'Expected first allergy',
    );
    expect(firstAllergy.label).toBe('Penicillin');
    expect(firstAllergy.kind).toBe(UserAllergyKind.drug);
    expect(firstAllergy.isActive).toBe(true);

    const stored = await ctx.prisma.userAllergy.findFirstOrThrow({
      where: { userId: user.id },
    });
    expect(stored.label).toBe('Penicillin');
    expect(stored.isActive).toBe(true);
  });

  it('should update an allergy', async () => {
    const email = uniqueEmail('hc');
    const user = await ctx.prisma.user.create({
      data: {
        email,
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

    const allergy = await ctx.prisma.userAllergy.findFirstOrThrow({
      where: { userId: user.id },
    });
    const accessToken = await makeToken(
      user.id,
      expectDefined(user.email, 'Expected user email'),
    );

    const response = await request(app.getHttpServer())
      .patch(`${HEALTH_CONTEXT_PATH}/allergies/${allergy.id}`)
      .set(AUTH_HEADER, bearer(accessToken))
      .send({ label: ' Penicillin G ', severity: UserAllergySeverity.severe })
      .expect(200);

    const data = expectData(response.body as HealthContextData);
    expect(data.allergies).toHaveLength(1);
    const updatedAllergy = expectDefined(
      data.allergies[0],
      'Expected updated allergy',
    );
    expect(updatedAllergy.label).toBe('Penicillin G');
    expect(updatedAllergy.severity).toBe(UserAllergySeverity.severe);
  });

  it('should soft-delete an allergy', async () => {
    const email = uniqueEmail('hc');
    const user = await ctx.prisma.user.create({
      data: {
        email,
        status: UserStatus.active,
        allergies: {
          create: {
            kind: UserAllergyKind.food,
            label: 'Shrimp',
          },
        },
      },
    });

    const allergy = await ctx.prisma.userAllergy.findFirstOrThrow({
      where: { userId: user.id },
    });
    const accessToken = await makeToken(
      user.id,
      expectDefined(user.email, 'Expected user email'),
    );

    const response = await request(app.getHttpServer())
      .delete(`${HEALTH_CONTEXT_PATH}/allergies/${allergy.id}`)
      .set(AUTH_HEADER, bearer(accessToken))
      .expect(200);

    const data = expectData(response.body as HealthContextData);
    expect(data.summary.activeAllergyCount).toBe(0);

    const stored = await ctx.prisma.userAllergy.findUniqueOrThrow({
      where: { id: allergy.id },
    });
    expect(stored.isActive).toBe(false);
  });

  it('should return 404 when accessing a foreign allergy', async () => {
    const email1 = uniqueEmail('hc');
    const user1 = await ctx.prisma.user.create({
      data: {
        email: email1,
        status: UserStatus.active,
        allergies: {
          create: { kind: UserAllergyKind.drug, label: 'Penicillin' },
        },
      },
    });

    const email2 = uniqueEmail('hc');
    const user2 = await ctx.prisma.user.create({
      data: {
        email: email2,
        status: UserStatus.active,
      },
    });

    const allergy = await ctx.prisma.userAllergy.findFirstOrThrow({
      where: { userId: user1.id },
    });
    const accessToken = await makeToken(
      user2.id,
      expectDefined(user2.email, 'Expected user email'),
    );

    await request(app.getHttpServer())
      .patch(`${HEALTH_CONTEXT_PATH}/allergies/${allergy.id}`)
      .set(AUTH_HEADER, bearer(accessToken))
      .send({ label: 'X' })
      .expect(403);
  });

  // ── Condition e2e ──

  it('should create a condition and return the refreshed aggregate', async () => {
    const email = uniqueEmail('hc');
    const user = await ctx.prisma.user.create({
      data: {
        email,
        status: UserStatus.active,
      },
    });

    const accessToken = await makeToken(
      user.id,
      expectDefined(user.email, 'Expected user email'),
    );

    const response = await request(app.getHttpServer())
      .post(`${HEALTH_CONTEXT_PATH}/conditions`)
      .set(AUTH_HEADER, bearer(accessToken))
      .send({
        label: ' Asthma ',
        status: UserConditionStatus.active,
        diagnosedAt: '2024-02-01',
        note: 'Triggered during pollen season',
      })
      .expect(201);

    const body = response.body as HealthContextData;

    const data = expectData(body);
    expect(data.summary.conditionCount).toBe(1);
    expect(data.conditions).toHaveLength(1);
    const firstCondition = expectDefined(
      data.conditions[0],
      'Expected first condition',
    );
    expect(firstCondition.label).toBe('Asthma');
    expect(firstCondition.status).toBe(UserConditionStatus.active);
    expect(firstCondition.diagnosedAt).toBe('2024-02-01');

    const stored = await ctx.prisma.userCondition.findFirstOrThrow({
      where: { userId: user.id },
    });
    expect(stored.label).toBe('Asthma');
    expect(stored.status).toBe(UserConditionStatus.active);
  });

  it('should update a condition', async () => {
    const email = uniqueEmail('hc');
    const user = await ctx.prisma.user.create({
      data: {
        email,
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

    const condition = await ctx.prisma.userCondition.findFirstOrThrow({
      where: { userId: user.id },
    });
    const accessToken = await makeToken(
      user.id,
      expectDefined(user.email, 'Expected user email'),
    );

    const response = await request(app.getHttpServer())
      .patch(`${HEALTH_CONTEXT_PATH}/conditions/${condition.id}`)
      .set(AUTH_HEADER, bearer(accessToken))
      .send({
        label: ' Asthma Updated ',
        status: UserConditionStatus.suspected,
      })
      .expect(200);

    const data = expectData(response.body as HealthContextData);
    expect(data.conditions).toHaveLength(1);
    const updatedCondition = expectDefined(
      data.conditions[0],
      'Expected updated condition',
    );
    expect(updatedCondition.label).toBe('Asthma Updated');
    expect(updatedCondition.status).toBe(UserConditionStatus.suspected);
  });

  it('should soft-resolve a condition', async () => {
    const email = uniqueEmail('hc');
    const user = await ctx.prisma.user.create({
      data: {
        email,
        status: UserStatus.active,
        conditions: {
          create: {
            label: 'Asthma',
            status: UserConditionStatus.active,
          },
        },
      },
    });

    const condition = await ctx.prisma.userCondition.findFirstOrThrow({
      where: { userId: user.id },
    });
    const accessToken = await makeToken(
      user.id,
      expectDefined(user.email, 'Expected user email'),
    );

    const response = await request(app.getHttpServer())
      .delete(`${HEALTH_CONTEXT_PATH}/conditions/${condition.id}`)
      .set(AUTH_HEADER, bearer(accessToken))
      .expect(200);

    const data = expectData(response.body as HealthContextData);
    expect(data.conditions).toHaveLength(1);
    const resolvedCondition = expectDefined(
      data.conditions[0],
      'Expected resolved condition',
    );
    expect(resolvedCondition.status).toBe(UserConditionStatus.resolved);
    expect(resolvedCondition.resolvedAt).not.toBeNull();

    const stored = await ctx.prisma.userCondition.findUniqueOrThrow({
      where: { id: condition.id },
    });
    expect(stored.status).toBe(UserConditionStatus.resolved);
    expect(stored.resolvedAt).not.toBeNull();
  });

  it('should return 404 when accessing a foreign condition', async () => {
    const email1 = uniqueEmail('hc');
    const user1 = await ctx.prisma.user.create({
      data: {
        email: email1,
        status: UserStatus.active,
        conditions: {
          create: { label: 'Asthma', status: UserConditionStatus.active },
        },
      },
    });

    const email2 = uniqueEmail('hc');
    const user2 = await ctx.prisma.user.create({
      data: {
        email: email2,
        status: UserStatus.active,
      },
    });

    const condition = await ctx.prisma.userCondition.findFirstOrThrow({
      where: { userId: user1.id },
    });
    const accessToken = await makeToken(
      user2.id,
      expectDefined(user2.email, 'Expected user email'),
    );

    await request(app.getHttpServer())
      .patch(`${HEALTH_CONTEXT_PATH}/conditions/${condition.id}`)
      .set(AUTH_HEADER, bearer(accessToken))
      .send({ label: 'X' })
      .expect(403);
  });

  // ── Current medicine e2e ──

  it('should create a current medicine and return the refreshed aggregate', async () => {
    const email = uniqueEmail('hc');
    const user = await ctx.prisma.user.create({
      data: {
        email,
        status: UserStatus.active,
      },
    });

    const accessToken = await makeToken(
      user.id,
      expectDefined(user.email, 'Expected user email'),
    );

    const response = await request(app.getHttpServer())
      .post(`${HEALTH_CONTEXT_PATH}/current-medicines`)
      .set(AUTH_HEADER, bearer(accessToken))
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

    const body = response.body as HealthContextData;

    const data = expectData(body);
    expect(data.summary.currentMedicineCount).toBe(1);
    expect(data.currentMedicines).toHaveLength(1);
    const firstCurrentMedicine = expectDefined(
      data.currentMedicines[0],
      'Expected first current medicine',
    );
    expect(firstCurrentMedicine.displayName).toBe('Ibuprofen');
    expect(firstCurrentMedicine.source).toBe(MedicineSource.drugbank);
    expect(firstCurrentMedicine.isCurrent).toBe(true);
  });

  it('should update a current medicine', async () => {
    const email = uniqueEmail('hc');
    const user = await ctx.prisma.user.create({
      data: {
        email,
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

    const medicine = await ctx.prisma.userCurrentMedicine.findFirstOrThrow({
      where: { userId: user.id },
    });
    const accessToken = await makeToken(
      user.id,
      expectDefined(user.email, 'Expected user email'),
    );

    const response = await request(app.getHttpServer())
      .patch(`${HEALTH_CONTEXT_PATH}/current-medicines/${medicine.id}`)
      .set(AUTH_HEADER, bearer(accessToken))
      .send({ displayName: ' Ibuprofen G ', strengthText: '400 mg' })
      .expect(200);

    const data = expectData(response.body as HealthContextData);
    expect(data.currentMedicines).toHaveLength(1);
    const updatedCurrentMedicine = expectDefined(
      data.currentMedicines[0],
      'Expected updated current medicine',
    );
    expect(updatedCurrentMedicine.displayName).toBe('Ibuprofen G');
    expect(updatedCurrentMedicine.strengthText).toBe('400 mg');
  });

  it('should soft-delete a current medicine', async () => {
    const email = uniqueEmail('hc');
    const user = await ctx.prisma.user.create({
      data: {
        email,
        status: UserStatus.active,
        currentMedicines: {
          create: {
            source: MedicineSource.manual,
            displayName: 'Vitamin D',
          },
        },
      },
    });

    const medicine = await ctx.prisma.userCurrentMedicine.findFirstOrThrow({
      where: { userId: user.id },
    });
    const accessToken = await makeToken(
      user.id,
      expectDefined(user.email, 'Expected user email'),
    );

    const response = await request(app.getHttpServer())
      .delete(`${HEALTH_CONTEXT_PATH}/current-medicines/${medicine.id}`)
      .set(AUTH_HEADER, bearer(accessToken))
      .expect(200);

    const data = expectData(response.body as HealthContextData);
    expect(data.summary.currentMedicineCount).toBe(0);

    const stored = await ctx.prisma.userCurrentMedicine.findUniqueOrThrow({
      where: { id: medicine.id },
    });
    expect(stored.isCurrent).toBe(false);
    expect(stored.endedAt).not.toBeNull();
  });

  it('should return 404 when accessing a foreign current medicine', async () => {
    const email1 = uniqueEmail('hc');
    const user1 = await ctx.prisma.user.create({
      data: {
        email: email1,
        status: UserStatus.active,
        currentMedicines: {
          create: {
            source: MedicineSource.manual,
            displayName: 'Vitamin D',
          },
        },
      },
    });

    const email2 = uniqueEmail('hc');
    const user2 = await ctx.prisma.user.create({
      data: {
        email: email2,
        status: UserStatus.active,
      },
    });

    const medicine = await ctx.prisma.userCurrentMedicine.findFirstOrThrow({
      where: { userId: user1.id },
    });
    const accessToken = await makeToken(
      user2.id,
      expectDefined(user2.email, 'Expected user email'),
    );

    await request(app.getHttpServer())
      .patch(`${HEALTH_CONTEXT_PATH}/current-medicines/${medicine.id}`)
      .set(AUTH_HEADER, bearer(accessToken))
      .send({ displayName: 'X' })
      .expect(403);
  });
});
