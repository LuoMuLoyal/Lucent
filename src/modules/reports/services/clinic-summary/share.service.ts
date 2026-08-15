import { createHash, randomBytes } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import {
  ClinicSummaryShareField,
  ProductEventName,
  ProductEventResult,
  ProductEventSurface,
} from '#generated/prisma/client';
import type { UserClinicSummaryShare } from '#generated/prisma/client';
import { badRequest, now } from '../../../../common';
import { PrismaService } from '../../../../prisma';
import { ProductEventsService } from '../../../product-events';

/**
 * Default lifetime of a share link, in days. Intentionally longer than the
 * legacy 24h summary-cache TTL: shares are persisted grants that can be
 * revoked or expired server-side at any time, so a longer TTL cannot keep
 * stale data alive the way the old cache copy would.
 */
const DEFAULT_SHARE_TTL_DAYS = 7;

const SHARE_FIELD_VALUES = Object.values(ClinicSummaryShareField) as string[];

export interface CreateShareInput {
  /** Event-scoped share (mutually exclusive with the date range). */
  eventId?: string | null;
  /** Date-range-scoped share (both dates required, mutually exclusive with eventId). */
  dateFrom?: Date | string | null;
  dateTo?: Date | string | null;
  /** Clinic-summary sections the share may expose; non-empty, all known values. */
  selectedFields: string[];
}

export interface CreateShareResult {
  shareId: string;
  /** Plaintext token — returned exactly once, never persisted. */
  token: string;
  expiresAt: Date;
  scope: {
    eventId: string | null;
    dateFrom: Date | null;
    dateTo: Date | null;
  };
  selectedFields: ClinicSummaryShareField[];
}

/**
 * Read result of a shared clinic summary — deliberately shaped WITHOUT the
 * raw entity's `tokenHash` and `userId`, so response building (and any
 * serialization) can never leak the hash or the owner id.
 */
export interface ShareReadModel {
  shareId: string;
  scope: {
    eventId: string | null;
    dateFrom: Date | null;
    dateTo: Date | null;
  };
  selectedFields: ClinicSummaryShareField[];
  expiresAt: Date;
  revokedAt: Date | null;
  firstAccessedAt: Date | null;
  lastAccessedAt: Date | null;
  accessCount: number;
}

/**
 * One entry of the owner's share list — same hygiene as `ShareReadModel`
 * (never the raw entity, so `tokenHash`/`token`/`userId` cannot leak), plus
 * `createdAt` for the management UI's ordering. Field is `id` (not `shareId`)
 * because the list item is the record itself, not a create/open result.
 */
export interface ShareListItemReadModel {
  id: string;
  createdAt: Date;
  expiresAt: Date;
  revokedAt: Date | null;
  accessCount: number;
  firstAccessedAt: Date | null;
  lastAccessedAt: Date | null;
  scope: {
    eventId: string | null;
    dateFrom: Date | null;
    dateTo: Date | null;
  };
  selectedFields: ClinicSummaryShareField[];
}

/**
 * Persisted, revocable clinic-summary shares. Only the sha256 token hash is
 * stored; no summary JSON and no plaintext token are ever persisted. The
 * response is rebuilt from the current authorized scope on each open, so the
 * share record (scope + selected fields) is returned as the read result.
 *
 * The share domain records its own lifecycle product events: created /
 * revoked after the corresponding write succeeds (surface `review` — the
 * authenticated in-app report screen where the owner acts). The OPEN event is
 * NOT emitted here: `getSharedSummaryByToken` is a storage primitive not on
 * any controller path — the production public open flows through
 * `ClinicSummaryService.getSharedSummary`, which emits
 * `visit_summary_share_opened` exactly once per successful read.
 */
@Injectable()
export class ShareService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly productEvents: ProductEventsService,
  ) {}

  async createShare(
    userId: string,
    input: CreateShareInput,
  ): Promise<CreateShareResult> {
    const selectedFields = this.validateSelectedFields(input.selectedFields);
    const scope = this.validateScope(input);

    const token = randomBytes(32).toString('base64url');
    const tokenHash = this.hashToken(token);
    const expiresAt = new Date(
      now().getTime() + DEFAULT_SHARE_TTL_DAYS * 24 * 60 * 60 * 1000,
    );

    const record = await this.prisma.userClinicSummaryShare.create({
      data: {
        userId,
        tokenHash,
        eventId: scope.eventId,
        dateFrom: scope.dateFrom,
        dateTo: scope.dateTo,
        selectedFields,
        expiresAt,
      },
    });

    // Server-authoritative lifecycle event — emitted only after the share
    // insert succeeded. Deterministic clientEventId: a retry that re-runs
    // this idempotent create (or the controller's best-effort cache-fallback
    // revoke) is deduped by the (userId, clientEventId) unique constraint.
    await this.productEvents.emitServerEvent(userId, {
      name: ProductEventName.visit_summary_share_created,
      surface: ProductEventSurface.review,
      result: ProductEventResult.success,
      clientEventId: `server-share-created-${record.id}`,
    });

    return {
      shareId: record.id,
      token,
      expiresAt: record.expiresAt,
      scope: {
        eventId: record.eventId,
        dateFrom: record.dateFrom,
        dateTo: record.dateTo,
      },
      selectedFields: record.selectedFields,
    };
  }

  /**
   * Resolves a share by its plaintext token. Returns null for unknown,
   * expired or revoked shares. On success the access is recorded atomically
   * via a single guarded `updateMany`: `revokedAt: null` re-checked in the
   * WHERE closes the read→write race (a share revoked mid-flight records no
   * access and yields null), and `updateMany` never raises P2025 if the row
   * disappears between the read and the write.
   */
  async getSharedSummaryByToken(token: string): Promise<ShareReadModel | null> {
    const tokenHash = this.hashToken(token);
    const nowDate = now();

    const record = await this.prisma.userClinicSummaryShare.findFirst({
      where: { tokenHash, revokedAt: null, expiresAt: { gt: nowDate } },
    });
    if (!record) return null;

    const accessedAt = now();
    const result = await this.prisma.userClinicSummaryShare.updateMany({
      where: { id: record.id, revokedAt: null, expiresAt: { gt: nowDate } },
      data: {
        accessCount: { increment: 1 },
        lastAccessedAt: accessedAt,
        ...(record.firstAccessedAt === null
          ? { firstAccessedAt: accessedAt }
          : {}),
      },
    });
    if (result.count === 0) return null;

    return { ...this.toReadModel(record), accessCount: record.accessCount + 1 };
  }

  /**
   * Read-only list of the caller's shares, newest first. Revoked shares stay
   * listed (the management UI shows them with `revokedAt`); only the shaped
   * list item model is ever returned, so the token hash can never leak.
   */
  async listSharesForUser(userId: string): Promise<ShareListItemReadModel[]> {
    const records = await this.prisma.userClinicSummaryShare.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });
    return records.map((record) => ({
      id: record.id,
      createdAt: record.createdAt,
      expiresAt: record.expiresAt,
      revokedAt: record.revokedAt,
      accessCount: record.accessCount,
      firstAccessedAt: record.firstAccessedAt,
      lastAccessedAt: record.lastAccessedAt,
      scope: {
        eventId: record.eventId,
        dateFrom: record.dateFrom,
        dateTo: record.dateTo,
      },
      selectedFields: record.selectedFields,
    }));
  }

  /** Ownership-scoped revoke. Returns false for unknown ids or non-owners. */
  async revokeShare(userId: string, shareId: string): Promise<boolean> {
    const result = await this.prisma.userClinicSummaryShare.updateMany({
      where: { id: shareId, userId },
      data: { revokedAt: now() },
    });
    if (result.count > 0) {
      // Server-authoritative lifecycle event — only after a real revocation.
      // Deterministic clientEventId dedupes retries of this idempotent revoke.
      await this.productEvents.emitServerEvent(userId, {
        name: ProductEventName.visit_summary_share_revoked,
        surface: ProductEventSurface.review,
        result: ProductEventResult.success,
        clientEventId: `server-share-revoked-${shareId}`,
      });
    }
    return result.count > 0;
  }

  // ── Validation ────────────────────────────────────────────

  private validateSelectedFields(fields: string[]): ClinicSummaryShareField[] {
    if (!Array.isArray(fields) || fields.length === 0) {
      badRequest('selectedFields 不能为空');
    }
    const allowed = new Set(SHARE_FIELD_VALUES);
    for (const field of fields) {
      if (!allowed.has(field)) {
        badRequest(`不支持的分享字段: ${field}`);
      }
    }
    // Dedupe keeps the first-occurrence order.
    return [...new Set(fields)] as ClinicSummaryShareField[];
  }

  private validateScope(input: CreateShareInput): {
    eventId: string | null;
    dateFrom: Date | null;
    dateTo: Date | null;
  } {
    const eventId =
      typeof input.eventId === 'string' && input.eventId !== ''
        ? input.eventId
        : null;
    const dateFrom = this.parseDate(input.dateFrom);
    const dateTo = this.parseDate(input.dateTo);

    if (eventId && (dateFrom || dateTo)) {
      badRequest('eventId 与日期范围不能同时指定');
    }
    if (!eventId && !(dateFrom && dateTo)) {
      badRequest('必须指定 eventId 或完整的 dateFrom/dateTo 日期范围');
    }
    if (dateFrom && dateTo && dateFrom.getTime() > dateTo.getTime()) {
      badRequest('dateFrom 不能晚于 dateTo');
    }

    return { eventId, dateFrom, dateTo };
  }

  private parseDate(value: Date | string | null | undefined): Date | null {
    if (value == null) return null;
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      badRequest(`无效的日期: ${String(value)}`);
    }
    return date;
  }

  // ── Read model ────────────────────────────────────────────

  private toReadModel(record: UserClinicSummaryShare): ShareReadModel {
    return {
      shareId: record.id,
      scope: {
        eventId: record.eventId,
        dateFrom: record.dateFrom,
        dateTo: record.dateTo,
      },
      selectedFields: record.selectedFields,
      expiresAt: record.expiresAt,
      revokedAt: record.revokedAt,
      firstAccessedAt: record.firstAccessedAt,
      lastAccessedAt: record.lastAccessedAt,
      accessCount: record.accessCount,
    };
  }

  /**
   * Plaintext token → sha256 hex. Only the hash is ever persisted; tokenHash
   * is @unique, so a hash collision (~2^-256) would fail the insert rather
   * than leak or overwrite another token — no retry is attempted.
   */
  private hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }
}
