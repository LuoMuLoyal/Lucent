import request from 'supertest';

import {
  createTestApp,
  cleanupDatabase,
  createTestUser,
  createAccessToken,
  bearer,
  expectData,
  uniqueEmail,
  createSecurityElevationToken,
  SECURITY_ELEVATION_HEADER,
} from '../helpers/e2e-helpers';
import type { E2eTestContext, E2eApp, TestUser } from '../helpers/e2e-helpers';
import { ResultCode } from '../../src/common';

import type { ApiEnvelope } from '../../src/common';

/**
 * Security tests:
 * 1. Security elevation guard — endpoints requiring elevation reject
 *    requests without a valid elevation token.
 * 2. IDOR for medicine dose logs — cross-user isolation.
 * 3. Mass assignment — extra fields in PATCH body are ignored.
 */
describe('Security: Elevation, IDOR & Mass Assignment (e2e)', () => {
  let ctx: E2eTestContext;
  let app: E2eApp;
  let alice: TestUser;
  let bob: TestUser;
  let aliceToken: string;
  let bobToken: string;

  beforeAll(async () => {
    ctx = await createTestApp();
    app = ctx.app;
    await cleanupDatabase(ctx.prisma);

    alice = await createTestUser(
      ctx.prisma,
      uniqueEmail('elev-alice'),
      'Alice',
    );
    bob = await createTestUser(ctx.prisma, uniqueEmail('elev-bob'), 'Bob');

    aliceToken = await createAccessToken(
      ctx.jwtService,
      ctx.configService,
      alice.id,
      alice.email,
    );
    bobToken = await createAccessToken(
      ctx.jwtService,
      ctx.configService,
      bob.id,
      bob.email,
    );
  });

  afterAll(async () => {
    await cleanupDatabase(ctx.prisma);
    await Promise.race([
      app.close(),
      new Promise<void>((resolve) => {
        setTimeout(() => {
          resolve();
        }, 10_000);
      }),
    ]);
  }, 30_000);

  // ── Security Elevation Guard ───────────────────────────────

  describe('Security elevation guard', () => {
    it('should reject data-export POST without elevation token', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/user/data-export-requests')
        .set('Authorization', bearer(aliceToken))
        .send({ kind: 'hospital', format: 'pdf', range: 'last_30_days' })
        .expect(403);
    });

    it('should reject data-export POST with invalid elevation token', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/user/data-export-requests')
        .set('Authorization', bearer(aliceToken))
        .set(SECURITY_ELEVATION_HEADER, 'Bearer invalid-token')
        .send({ kind: 'hospital', format: 'pdf', range: 'last_30_days' })
        .expect(403);
    });

    it('should accept data-export POST with valid elevation token', async () => {
      const elevationToken = await createSecurityElevationToken(ctx, alice.id);

      const res = await request(app.getHttpServer())
        .post('/api/v1/user/data-export-requests')
        .set('Authorization', bearer(aliceToken))
        .set(SECURITY_ELEVATION_HEADER, `Bearer ${elevationToken}`)
        .send({ kind: 'hospital', format: 'pdf', range: 'last_30_days' })
        .expect(201);

      expect(res.body.code).toBe(0);
      expect(res.body.data).toHaveProperty('id');
    });

    it('should reject data-export GET/latest without elevation token', async () => {
      await request(app.getHttpServer())
        .get('/api/v1/user/data-export-requests/latest')
        .set('Authorization', bearer(aliceToken))
        .expect(403);
    });
  });

  // ── IDOR: Medicine Dose Logs ───────────────────────────────

  describe('Medicine Dose Logs IDOR', () => {
    let aliceDoseLogId: string;

    beforeAll(async () => {
      // Create a current medicine for Alice first
      const medRes = await request(app.getHttpServer())
        .post('/api/v1/user/health-context/current-medicines')
        .set('Authorization', bearer(aliceToken))
        .send({
          displayName: 'DoseLog Med',
          source: 'drugbank',
          sourceRefId: 'DB00001',
        })
        .expect(201);
      const medId = expectData(medRes.body as ApiEnvelope<{ id: string }>).id;

      // Create a medicine reminder
      const reminderRes = await request(app.getHttpServer())
        .post('/api/v1/user/medicine-reminders')
        .set('Authorization', bearer(aliceToken))
        .send({
          currentMedicineId: medId,
          scheduledHour: 8,
          scheduledMinute: 0,
        })
        .expect(201);
      const reminderId = expectData(
        reminderRes.body as ApiEnvelope<{ id: string }>,
      ).id;

      // Create a dose log for Alice
      const doseLogRes = await request(app.getHttpServer())
        .post('/api/v1/user/medicine-dose-logs')
        .set('Authorization', bearer(aliceToken))
        .send({
          reminderId,
          scheduledFor: '2026-07-12',
          status: 'taken',
        })
        .expect(201);
      aliceDoseLogId = expectData(
        doseLogRes.body as ApiEnvelope<{ id: string }>,
      ).id;
    });

    it('Bob cannot list Alice dose logs', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/user/medicine-dose-logs')
        .query({ date: '2026-07-12' })
        .set('Authorization', bearer(bobToken))
        .expect(200);

      const data = res.body.data as { items?: unknown[] };
      const found =
        Array.isArray(data.items) &&
        data.items.some((r) => (r as { id: string }).id === aliceDoseLogId);
      expect(found).toBe(false);
    });

    it('Bob cannot read Alice dose log by ID', async () => {
      await request(app.getHttpServer())
        .get(`/api/v1/user/medicine-dose-logs/${aliceDoseLogId}`)
        .set('Authorization', bearer(bobToken))
        .expect(404);
    });

    it('Bob cannot update Alice dose log', async () => {
      await request(app.getHttpServer())
        .patch(`/api/v1/user/medicine-dose-logs/${aliceDoseLogId}`)
        .set('Authorization', bearer(bobToken))
        .send({ status: 'skipped' })
        .expect(404);
    });

    it('Bob cannot delete Alice dose log', async () => {
      await request(app.getHttpServer())
        .delete(`/api/v1/user/medicine-dose-logs/${aliceDoseLogId}`)
        .set('Authorization', bearer(bobToken))
        .expect(404);
    });
  });

  // ── Mass Assignment Protection ─────────────────────────────

  describe('Mass assignment protection', () => {
    it('PATCH /account should reject unknown fields like role (forbidNonWhitelisted)', async () => {
      const res = await request(app.getHttpServer())
        .patch('/api/v1/account')
        .set('Authorization', bearer(aliceToken))
        .send({
          nickname: 'UpdatedNick',
          role: 'admin',
          isVerified: true,
          status: 'active',
        })
        .expect(400);

      // forbidNonWhitelisted rejects the request — mass assignment is prevented
      expect(res.body.code).toBe(ResultCode.VALIDATION_FAILED);
    });

    it('POST /daily-records should reject unknown fields (forbidNonWhitelisted)', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/user/daily-records')
        .set('Authorization', bearer(aliceToken))
        .send({
          occurredAt: '2026-07-13',
          kind: 'meal',
          payload: { mealType: 'lunch', items: [] },
          userId: bob.id, // attempt to set another user's ID
          isVerified: true,
        })
        .expect(400);

      // forbidNonWhitelisted rejects the request — mass assignment is prevented
      expect(res.body.code).toBe(ResultCode.VALIDATION_FAILED);
    });
  });
});
