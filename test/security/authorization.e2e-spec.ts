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
import { ResultCode } from '../../src/common/api';
import type { ApiEnvelope } from '../../src/common/api';
import { UserStatus } from '#generated/prisma/client';

/**
 * Security tests: cross-user authorization.
 *
 * Creates two users (Alice and Bob), seeds Alice's data, then verifies
 * that Bob cannot read, update, or delete Alice's resources.
 *
 * Each resource type is tested independently. The expectation is always
 * 403 Forbidden or 404 Not Found — never 200 with Alice's data.
 */
describe('Security: Cross-User Authorization (e2e)', () => {
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

    alice = await createTestUser(ctx.prisma, uniqueEmail('alice'), 'Alice');
    bob = await createTestUser(ctx.prisma, uniqueEmail('bob'), 'Bob');

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
    await app.close();
  });

  // ── Health Context ──────────────────────────────────────────

  describe('User Health Context', () => {
    let aliceAllergyId: string;
    let aliceConditionId: string;

    beforeAll(async () => {
      // Seed Alice's health context
      const allergyRes = await request(app.getHttpServer())
        .post('/api/v1/user/health-context/allergies')
        .set('Authorization', bearer(aliceToken))
        .send({ kind: 'drug', label: 'Penicillin', severity: 'severe' })
        .expect(201);
      const allergyData = expectData(
        allergyRes.body as ApiEnvelope<{ allergies: { id: string }[] }>,
      );
      aliceAllergyId = allergyData.allergies[0]!.id;

      const condRes = await request(app.getHttpServer())
        .post('/api/v1/user/health-context/conditions')
        .set('Authorization', bearer(aliceToken))
        .send({ label: 'Hypertension', status: 'active' })
        .expect(201);
      const condData = expectData(
        condRes.body as ApiEnvelope<{ conditions: { id: string }[] }>,
      );
      aliceConditionId = condData.conditions[0]!.id;
    });

    it('Bob cannot read Alice health context', async () => {
      // Health context is always the authenticated user's own — Bob gets his own (empty), not Alice's
      const res = await request(app.getHttpServer())
        .get('/api/v1/user/health-context')
        .set('Authorization', bearer(bobToken))
        .expect(200);

      const data = res.body.data as {
        allergies: unknown[];
        conditions: unknown[];
      };
      expect(data.allergies).toHaveLength(0);
      expect(data.conditions).toHaveLength(0);
    });

    it('Bob cannot update Alice allergy', async () => {
      await request(app.getHttpServer())
        .patch(`/api/v1/user/health-context/allergies/${aliceAllergyId}`)
        .set('Authorization', bearer(bobToken))
        .send({ label: 'Hacked' })
        .expect(404);
    });

    it('Bob cannot delete Alice allergy', async () => {
      await request(app.getHttpServer())
        .delete(`/api/v1/user/health-context/allergies/${aliceAllergyId}`)
        .set('Authorization', bearer(bobToken))
        .expect(404);
    });

    it('Bob cannot update Alice condition', async () => {
      await request(app.getHttpServer())
        .patch(`/api/v1/user/health-context/conditions/${aliceConditionId}`)
        .set('Authorization', bearer(bobToken))
        .send({ label: 'Hacked' })
        .expect(404);
    });

    it('Bob cannot delete Alice condition', async () => {
      await request(app.getHttpServer())
        .delete(`/api/v1/user/health-context/conditions/${aliceConditionId}`)
        .set('Authorization', bearer(bobToken))
        .expect(404);
    });
  });

  // ── Daily Records ───────────────────────────────────────────

  describe('Daily Records', () => {
    let aliceRecordId: string;

    beforeAll(async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/user/daily-records')
        .set('Authorization', bearer(aliceToken))
        .send({
          occurredAt: '2026-07-12',
          kind: 'meal',
          payload: { mealType: 'breakfast', items: [] },
        })
        .expect(201);
      aliceRecordId = expectData(res.body as ApiEnvelope<{ id: string }>).id;
    });

    it('Bob cannot list Alice daily records', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/user/daily-records')
        .query({ date: '2026-07-12' })
        .set('Authorization', bearer(bobToken))
        .expect(200);

      const data = res.body.data as { items: unknown[] };
      const found = data.items.some(
        (r) => (r as { id: string }).id === aliceRecordId,
      );
      expect(found).toBe(false);
    });

    it('Bob cannot read Alice daily record by ID', async () => {
      await request(app.getHttpServer())
        .get(`/api/v1/user/daily-records/${aliceRecordId}`)
        .set('Authorization', bearer(bobToken))
        .expect(404);
    });

    it('Bob cannot update Alice daily record', async () => {
      await request(app.getHttpServer())
        .patch(`/api/v1/user/daily-records/${aliceRecordId}`)
        .set('Authorization', bearer(bobToken))
        .send({ payload: { mealType: 'lunch', items: [] } })
        .expect(404);
    });

    it('Bob cannot delete Alice daily record', async () => {
      await request(app.getHttpServer())
        .delete(`/api/v1/user/daily-records/${aliceRecordId}`)
        .set('Authorization', bearer(bobToken))
        .expect(404);
    });
  });

  // ── Medicine Reminders ──────────────────────────────────────

  describe('Medicine Reminders', () => {
    let aliceReminderId: string;

    beforeAll(async () => {
      // Seed a current medicine for Alice first
      const medRes = await request(app.getHttpServer())
        .post('/api/v1/user/health-context/current-medicines')
        .set('Authorization', bearer(aliceToken))
        .send({
          displayName: 'Test Med',
          source: 'drugbank',
          sourceRefId: 'DB00001',
        })
        .expect(201);
      const medId = expectData(medRes.body as ApiEnvelope<{ id: string }>).id;

      const res = await request(app.getHttpServer())
        .post('/api/v1/user/medicine-reminders')
        .set('Authorization', bearer(aliceToken))
        .send({
          currentMedicineId: medId,
          scheduledHour: 8,
          scheduledMinute: 0,
        })
        .expect(201);
      aliceReminderId = expectData(res.body as ApiEnvelope<{ id: string }>).id;
    });

    it('Bob cannot list Alice medicine reminders', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/user/medicine-reminders')
        .set('Authorization', bearer(bobToken))
        .expect(200);

      const data = res.body.data as { items: unknown[] };
      const found = data.items.some(
        (r) => (r as { id: string }).id === aliceReminderId,
      );
      expect(found).toBe(false);
    });

    it('Bob cannot update Alice medicine reminder', async () => {
      await request(app.getHttpServer())
        .patch(`/api/v1/user/medicine-reminders/${aliceReminderId}`)
        .set('Authorization', bearer(bobToken))
        .send({ note: 'Hacked' })
        .expect(404);
    });

    it('Bob cannot delete Alice medicine reminder', async () => {
      await request(app.getHttpServer())
        .delete(`/api/v1/user/medicine-reminders/${aliceReminderId}`)
        .set('Authorization', bearer(bobToken))
        .expect(404);
    });
  });

  // ── Notifications ───────────────────────────────────────────

  describe('Notifications', () => {
    let aliceNotificationId: string;

    beforeAll(async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/user/notifications')
        .set('Authorization', bearer(aliceToken))
        .send({
          type: 'system_announcement',
          title: 'Alice notification',
          content: 'Private content',
        })
        .expect(201);
      aliceNotificationId = expectData(
        res.body as ApiEnvelope<{ id: string }>,
      ).id;
    });

    it('Bob cannot read Alice notification by ID', async () => {
      await request(app.getHttpServer())
        .get(`/api/v1/user/notifications/${aliceNotificationId}`)
        .set('Authorization', bearer(bobToken))
        .expect(404);
    });

    it('Bob cannot mark Alice notification as read', async () => {
      await request(app.getHttpServer())
        .patch(`/api/v1/user/notifications/${aliceNotificationId}/read`)
        .set('Authorization', bearer(bobToken))
        .expect(404);
    });

    it('Bob cannot delete Alice notification', async () => {
      await request(app.getHttpServer())
        .delete(`/api/v1/user/notifications/${aliceNotificationId}`)
        .set('Authorization', bearer(bobToken))
        .expect(404);
    });
  });

  // ── Account ─────────────────────────────────────────────────

  describe('Account', () => {
    it('Bob cannot read Alice account info', async () => {
      // /api/v1/account always returns the authenticated user's own info
      const res = await request(app.getHttpServer())
        .get('/api/v1/account')
        .set('Authorization', bearer(bobToken))
        .expect(200);

      expect(res.body.data.id).toBe(bob.id);
      expect(res.body.data.id).not.toBe(alice.id);
    });

    it('Bob cannot delete Alice account (no endpoint to target another user)', async () => {
      // Account deletion only accepts the authenticated user's own password
      const res = await request(app.getHttpServer())
        .delete('/api/v1/account')
        .set('Authorization', bearer(bobToken))
        .send({ password: 'wrong' })
        .expect(401);

      expect(res.body.code).not.toBe(ResultCode.SUCCESS);
    });
  });

  // ── Sessions ────────────────────────────────────────────────

  describe('Sessions', () => {
    let aliceSessionId: string;

    beforeAll(async () => {
      // Alice logs in to create a session
      await ctx.prisma.userSession.create({
        data: {
          userId: alice.id,
          refreshTokenHash: 'alice-test-refresh-token-hash',
          userAgent: 'test',
          ipAddress: '127.0.0.1',
          expiresAt: new Date(Date.now() + 86_400_000),
        },
      });

      const res = await request(app.getHttpServer())
        .get('/api/v1/auth/sessions')
        .set('Authorization', bearer(aliceToken))
        .expect(200);

      const sessions = res.body.data as Array<{ id: string }>;
      aliceSessionId = sessions[0]!.id;
    });

    it('Bob cannot list Alice sessions', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/auth/sessions')
        .set('Authorization', bearer(bobToken))
        .expect(200);

      const sessions = res.body.data as Array<{ id: string }>;
      const found = sessions.some((s) => s.id === aliceSessionId);
      expect(found).toBe(false);
    });

    it('Bob cannot revoke Alice session', async () => {
      await request(app.getHttpServer())
        .delete(`/api/v1/auth/sessions/${aliceSessionId}`)
        .set('Authorization', bearer(bobToken))
        .expect(403);
    });
  });

  // ── Assistant Conversations ─────────────────────────────────

  describe('Assistant Conversations', () => {
    let aliceConversationId: string;

    beforeAll(async () => {
      // No POST /conversations endpoint exists; create directly in DB
      const conversation = await ctx.prisma.assistantConversation.create({
        data: {
          userId: alice.id,
          title: 'Alice private chat',
        },
      });
      aliceConversationId = conversation.id;
    });

    it('Bob cannot open Alice conversation', async () => {
      await request(app.getHttpServer())
        .post(
          `/api/v1/user/assistant/conversations/${aliceConversationId}/open`,
        )
        .set('Authorization', bearer(bobToken))
        .expect(404);
    });
  });

  // ── Data Export ─────────────────────────────────────────────

  describe('Data Export', () => {
    let aliceExportId: string;
    let bobElevationToken: string;

    beforeAll(async () => {
      // Data export POST requires security elevation; create directly in DB
      const exportRequest = await ctx.prisma.dataExportRequest.create({
        data: {
          userId: alice.id,
          kind: 'daily_records',
          format: 'json',
          range: 'last_30_days',
          status: 'requested',
        },
      });
      aliceExportId = exportRequest.id;

      // GET /latest also requires security elevation; mint token for Bob
      bobElevationToken = await createSecurityElevationToken(ctx, bob.id);
    });

    it('Bob cannot see Alice export request in latest', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/user/data-export-requests/latest')
        .set('Authorization', bearer(bobToken))
        .set(SECURITY_ELEVATION_HEADER, `Bearer ${bobElevationToken}`)
        .expect(200);

      // Bob should get null or his own (non-existent) export, not Alice's
      const data = res.body.data as { id?: string } | null;
      if (data) {
        expect(data.id).not.toBe(aliceExportId);
      }
    });
  });

  // ── JWT Token Tampering ─────────────────────────────────────

  describe('JWT Token Tampering', () => {
    it('should reject a token with a tampered payload', async () => {
      // Take Alice's token and modify the user ID
      const parts = aliceToken.split('.');
      expect(parts).toHaveLength(3);

      // Tamper with the payload — change the 'sub' claim
      const tamperedPayload = Buffer.from(
        JSON.stringify({ sub: bob.id, email: alice.email, status: 'active' }),
      ).toString('base64url');
      const tamperedToken = `${parts[0]}.${tamperedPayload}.${parts[2]}`;

      await request(app.getHttpServer())
        .get('/api/v1/account')
        .set('Authorization', `Bearer ${tamperedToken}`)
        .expect(401);
    });

    it('should reject an expired token', async () => {
      const expiredToken = await ctx.jwtService.signAsync(
        { sub: alice.id, email: alice.email, status: UserStatus.active },
        {
          secret: ctx.configService.getOrThrow<{ accessSecret: string }>('jwt')
            .accessSecret,
          expiresIn: -1,
          algorithm: 'HS512',
        },
      );

      await request(app.getHttpServer())
        .get('/api/v1/account')
        .set('Authorization', `Bearer ${expiredToken}`)
        .expect(401);
    });

    it('should reject a token signed with wrong secret', async () => {
      const wrongSecretToken = await ctx.jwtService.signAsync(
        { sub: alice.id, email: alice.email, status: UserStatus.active },
        {
          secret: 'completely-wrong-secret',
          expiresIn: '1h',
          algorithm: 'HS512',
        },
      );

      await request(app.getHttpServer())
        .get('/api/v1/account')
        .set('Authorization', `Bearer ${wrongSecretToken}`)
        .expect(401);
    });
  });
});
