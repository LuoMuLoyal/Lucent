import request from 'supertest';

import {
  createTestApp,
  cleanupDatabase,
  createTestUser,
  createAccessToken,
  bearer,
} from '../../helpers/e2e-helpers.js';
import type { E2eTestContext, E2eApp } from '../../helpers/e2e-helpers.js';
import { DomainEventOutboxService } from '../../../src/common/events/domain-events-outbox.service.js';
import { EVENT_ORIGINS } from '../../../src/common/events/event-origins.js';
import {
  SETTINGS_CHANGED,
  type SettingsChangedPayload,
} from '../../../src/common/events/domain-events.js';

const USER_SETTINGS_PATH = '/api/v1/user/settings';

/** The origin declaration this suite checks the persisted row against. */
const SETTINGS_ORIGIN = EVENT_ORIGINS[SETTINGS_CHANGED];

/**
 * Domain event outbox wiring (ADR-0025 acceptance).
 *
 * ADR-0025 requires that a cross-context event be traceable end to end:
 *
 *   write endpoint → outbox row → fan-out → consumer queue
 *
 * This suite covers the first two links plus the two durability properties the
 * design rests on, because they are the ones a unit test cannot prove: the row
 * is written by the *real* request path, and it survives a process restart.
 *
 * Not covered here: the fan-out itself (`publishPending` → queue). It needs
 * Redis, which the e2e environment deliberately does not provide; the fan-out
 * has its own unit coverage in `domain-events-fanout.service.spec.ts`.
 */
describe('Domain events outbox (e2e)', () => {
  let ctx: E2eTestContext;
  let app: E2eApp;
  let userId: string;
  let userEmail: string;

  /**
   * `cleanupDatabase` does not know about `domain_events`, and these tests are
   * the only ones that write there. Clearing it here keeps them independent of
   * whatever a previous suite left behind.
   */
  async function clearOutbox(): Promise<void> {
    await ctx.prisma.domainEvent.deleteMany();
  }

  beforeAll(async () => {
    ctx = await createTestApp();
    app = ctx.app;
    await cleanupDatabase(ctx.prisma);
    await clearOutbox();

    const user = await createTestUser(ctx.prisma, undefined, 'OutboxUser');
    userId = user.id;
    userEmail = user.email;
  });

  afterAll(async () => {
    await clearOutbox();
    await cleanupDatabase(ctx.prisma);
    await app.close();
  });

  beforeEach(async () => {
    await clearOutbox();
  });

  async function makeToken(): Promise<string> {
    return createAccessToken(
      ctx.jwtService,
      ctx.configService,
      userId,
      userEmail,
    );
  }

  // ════════════════════════════════════════════════════════════
  // 1. A write endpoint appends exactly one row
  // ════════════════════════════════════════════════════════════

  describe('a write endpoint appends to the outbox', () => {
    it('records one settings.changed row whose fields match EVENT_ORIGINS', async () => {
      const token = await makeToken();
      await request(app.getHttpServer())
        .patch(USER_SETTINGS_PATH)
        .set('Authorization', bearer(token))
        .send({ aiSummariesEnabled: false })
        .expect(200);

      // The write path is time-boxed; the append happens inline in
      // `DomainEventPublisher.publish`, so it is already committed by the time
      // the response returns. Poll anyway so a slow CI box cannot make this
      // flaky on a millisecond race.
      const rows = await waitForRows(ctx, () => 1);
      expect(rows).toHaveLength(1);

      const [row] = rows;
      // Event name, context and aggregate type are all derived from
      // `EVENT_ORIGINS` — asserting them against that table (not against a
      // literal) is what keeps the declaration and the write path in sync.
      expect(row?.eventName).toBe(SETTINGS_CHANGED);
      expect(row?.context).toBe(SETTINGS_ORIGIN?.context);
      expect(row?.aggregateType).toBe(SETTINGS_ORIGIN?.aggregateType);
      // `settings.changed` carries only a userId, so the publisher falls back
      // to it as the aggregate id (`aggregateIdField` is `userId`).
      expect(row?.aggregateId).toBe(userId);
      expect(row?.occurredAt).toBeInstanceOf(Date);
      expect(row?.payloadVersion).toBe(1);

      const payload = row?.payload as SettingsChangedPayload;
      expect(payload.userId).toBe(userId);
    });

    it('leaves the row undelivered so the poller picks it up', async () => {
      // The append must not settle the row by itself: settlement belongs to the
      // fan-out. A row marked published at write time would never be delivered.
      const token = await makeToken();
      await request(app.getHttpServer())
        .patch(USER_SETTINGS_PATH)
        .set('Authorization', bearer(token))
        .send({ dataSharingConsent: true })
        .expect(200);

      const rows = await waitForRows(ctx, () => 1);
      expect(rows[0]?.publishedAt).toBeNull();
      expect(rows[0]?.attempts).toBe(0);
    });

    it('appends one row per write, not one per field', async () => {
      const token = await makeToken();
      await request(app.getHttpServer())
        .patch(USER_SETTINGS_PATH)
        .set('Authorization', bearer(token))
        .send({
          dataSharingConsent: true,
          assistantEnabled: false,
          assistantMemoryEnabled: false,
        })
        .expect(200);

      const rows = await waitForRows(ctx, () => 1);
      expect(rows).toHaveLength(1);
    });
  });

  // ════════════════════════════════════════════════════════════
  // 2. dedupeKey is idempotent
  // ════════════════════════════════════════════════════════════

  describe('append dedupe', () => {
    it('keeps one row when the same dedupeKey is appended twice', async () => {
      const outbox = app.get(DomainEventOutboxService);
      const input = {
        context: 'user-settings',
        aggregateType: 'settings',
        aggregateId: userId,
        eventName: SETTINGS_CHANGED,
        payload: { userId },
        dedupeKey: `settings.changed:${userId}:dedupe-probe`,
      };

      const first = await outbox.append(input);
      const second = await outbox.append(input);

      // Same row id returned both times — the second call is a no-op, not a
      // second fact.
      expect(second).toBe(first);
      await expect(
        ctx.prisma.domainEvent.count({ where: { dedupeKey: input.dedupeKey } }),
      ).resolves.toBe(1);
    });

    it('keeps one row under concurrent appends of the same dedupeKey', async () => {
      // The lookup-then-insert has a race window; the unique index closes it and
      // P2002 is mapped back to the winning row. Firing both at once exercises
      // that path rather than the trivial sequential one.
      const outbox = app.get(DomainEventOutboxService);
      const input = {
        context: 'user-settings',
        aggregateType: 'settings',
        aggregateId: userId,
        eventName: SETTINGS_CHANGED,
        payload: { userId },
        dedupeKey: `settings.changed:${userId}:race-probe`,
      };

      const ids = await Promise.all([
        outbox.append(input),
        outbox.append(input),
      ]);

      expect(new Set(ids).size).toBe(1);
      await expect(
        ctx.prisma.domainEvent.count({ where: { dedupeKey: input.dedupeKey } }),
      ).resolves.toBe(1);
    });

    it('writes a second row for a different dedupeKey', async () => {
      // Guards against the dedupe being "always keep one": two distinct changes
      // are two facts.
      const outbox = app.get(DomainEventOutboxService);
      const base = {
        context: 'user-settings',
        aggregateType: 'settings',
        aggregateId: userId,
        eventName: SETTINGS_CHANGED,
        payload: { userId },
      };

      await outbox.append({ ...base, dedupeKey: `${userId}:a` });
      await outbox.append({ ...base, dedupeKey: `${userId}:b` });

      await expect(ctx.prisma.domainEvent.count()).resolves.toBe(2);
    });
  });

  // ════════════════════════════════════════════════════════════
  // 3. Durability across a restart
  // ════════════════════════════════════════════════════════════

  describe('durability', () => {
    it('keeps an unprocessed row across an application restart', async () => {
      // The whole point of the outbox over `emitAsync`: a fact that was written
      // but not yet delivered must still be there for the next process to pick
      // up. Here "restart" is a fresh Nest application over the same database.
      const outbox = app.get(DomainEventOutboxService);
      const eventId = await outbox.append({
        context: 'user-settings',
        aggregateType: 'settings',
        aggregateId: userId,
        eventName: SETTINGS_CHANGED,
        payload: { userId },
      });

      await app.close();

      ctx = await createTestApp();
      app = ctx.app;

      const survivor = await ctx.prisma.domainEvent.findUnique({
        where: { id: eventId },
      });
      expect(survivor).not.toBeNull();
      expect(survivor?.eventName).toBe(SETTINGS_CHANGED);
      // Still claimable: unsettled, and below the retry ceiling. That is the
      // exact predicate the poller uses, so this asserts the row is *pending
      // delivery*, not merely present.
      expect(survivor?.publishedAt).toBeNull();
      expect(survivor?.attempts).toBe(0);

      const claimable = await ctx.prisma.domainEvent.count({
        where: { publishedAt: null, attempts: { lt: 5 } },
      });
      expect(claimable).toBe(1);
    });
  });
});

/** Row shape the assertions read; kept local so the suite is self-describing. */
interface OutboxRow {
  id: string;
  context: string;
  aggregateType: string;
  aggregateId: string;
  eventName: string;
  payloadVersion: number;
  payload: unknown;
  dedupeKey: string | null;
  publishedAt: Date | null;
  dispatchedAt: Date | null;
  attempts: number;
  occurredAt: Date;
}

/**
 * Waits until the outbox holds at least `expected` rows, then returns them.
 *
 * The append is synchronous with the write, so this normally succeeds on the
 * first poll; the loop exists so a slow CI filesystem cannot turn a real
 * assertion into a timing flake.
 */
async function waitForRows(
  ctx: E2eTestContext,
  expected: () => number,
  timeoutMs = 2_000,
): Promise<OutboxRow[]> {
  const deadline = Date.now() + timeoutMs;
  let rows: OutboxRow[] = [];
  while (Date.now() < deadline) {
    rows = (await ctx.prisma.domainEvent.findMany({
      orderBy: { occurredAt: 'asc' },
    })) as OutboxRow[];
    if (rows.length >= expected()) {
      return rows;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  return rows;
}
