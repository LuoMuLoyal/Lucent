import { createHash, randomBytes } from 'node:crypto';
import { BadRequestException, Injectable } from '@nestjs/common';
import { ClinicSummaryShareField } from '#generated/prisma/client';
import type { UserClinicSummaryShare } from '#generated/prisma/client';
import { PrismaService } from '../../../../prisma';

/** Default lifetime of a share link, in days. */
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
 * Persisted, revocable clinic-summary shares. Only the sha256 token hash is
 * stored; no summary JSON and no plaintext token are ever persisted. The
 * response is rebuilt from the current authorized scope on each open, so the
 * share record (scope + selected fields) is returned as the read result.
 */
@Injectable()
export class ShareService {
  constructor(private readonly prisma: PrismaService) {}

  async createShare(
    userId: string,
    input: CreateShareInput,
  ): Promise<CreateShareResult> {
    const selectedFields = this.validateSelectedFields(input.selectedFields);
    const scope = this.validateScope(input);

    const token = randomBytes(32).toString('base64url');
    const tokenHash = this.hashToken(token);
    const expiresAt = new Date(
      Date.now() + DEFAULT_SHARE_TTL_DAYS * 24 * 60 * 60 * 1000,
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
   * (single update: accessCount increment, firstAccessedAt on first open,
   * lastAccessedAt every open).
   */
  async getSharedSummaryByToken(
    token: string,
  ): Promise<UserClinicSummaryShare | null> {
    const share = await this.prisma.userClinicSummaryShare.findFirst({
      where: {
        tokenHash: this.hashToken(token),
        revokedAt: null,
        expiresAt: { gt: new Date() },
      },
    });
    if (!share) return null;

    const accessedAt = new Date();
    await this.prisma.userClinicSummaryShare.update({
      where: { id: share.id },
      data: {
        accessCount: { increment: 1 },
        lastAccessedAt: accessedAt,
        ...(share.firstAccessedAt === null
          ? { firstAccessedAt: accessedAt }
          : {}),
      },
    });

    return share;
  }

  /** Ownership-scoped revoke. Returns false for unknown ids or non-owners. */
  async revokeShare(userId: string, shareId: string): Promise<boolean> {
    const result = await this.prisma.userClinicSummaryShare.updateMany({
      where: { id: shareId, userId },
      data: { revokedAt: new Date() },
    });
    return result.count > 0;
  }

  // ── Validation ────────────────────────────────────────────

  private validateSelectedFields(fields: string[]): ClinicSummaryShareField[] {
    if (!Array.isArray(fields) || fields.length === 0) {
      throw new BadRequestException('selectedFields 不能为空');
    }
    const allowed = new Set(SHARE_FIELD_VALUES);
    for (const field of fields) {
      if (!allowed.has(field)) {
        throw new BadRequestException(`不支持的分享字段: ${field}`);
      }
    }
    return fields as ClinicSummaryShareField[];
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
    const dateFrom =
      typeof input.dateFrom === 'string' || input.dateFrom instanceof Date
        ? new Date(input.dateFrom)
        : null;
    const dateTo =
      typeof input.dateTo === 'string' || input.dateTo instanceof Date
        ? new Date(input.dateTo)
        : null;

    if (eventId && (dateFrom || dateTo)) {
      throw new BadRequestException('eventId 与日期范围不能同时指定');
    }
    if (!eventId && !(dateFrom && dateTo)) {
      throw new BadRequestException(
        '必须指定 eventId 或完整的 dateFrom/dateTo 日期范围',
      );
    }

    return { eventId, dateFrom, dateTo };
  }

  private hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }
}
