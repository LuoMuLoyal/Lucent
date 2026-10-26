import { Injectable } from '@nestjs/common';

import { PrismaService } from '../../../../prisma/index.js';
import type {
  ClinicSummaryShareField,
  UserClinicSummaryShare,
} from '#generated/prisma/client.js';
import {
  CLINIC_SUMMARY_SHARES,
  CLINIC_SUMMARY_SOURCES,
} from '../../application/ports/clinic-summary.js';
import type {
  ClinicSummaryShares,
  ClinicSummarySources,
} from '../../application/ports/clinic-summary.js';

/**
 * Prisma implementation of {@link ClinicSummaryShares}.
 *
 * The accessibility predicate is inlined as SQL (`revokedAt: null`,
 * `expiresAt: { gt: at }`) rather than post-filtered in JS: it must be part of
 * the `WHERE` so the atomic `updateMany` re-check closes the read→write race.
 * `domain/clinic-summary/share-access.ts` carries the same rule in code for
 * everything that has a row in hand; the two are kept in step by the strict
 * `>` comparison both use.
 */
@Injectable()
export class PrismaClinicSummaryShares implements ClinicSummaryShares {
  constructor(private readonly prisma: PrismaService) {}

  async create(data: {
    userId: string;
    tokenHash: string;
    expiresAt: Date;
    eventId: string | null;
    dateFrom: Date | null;
    dateTo: Date | null;
    selectedFields: string[];
  }): Promise<UserClinicSummaryShare> {
    return await this.prisma.userClinicSummaryShare.create({
      data: {
        userId: data.userId,
        tokenHash: data.tokenHash,
        expiresAt: data.expiresAt,
        eventId: data.eventId,
        dateFrom: data.dateFrom,
        dateTo: data.dateTo,
        selectedFields: data.selectedFields as ClinicSummaryShareField[],
      },
    });
  }

  async findAccessibleByTokenHash(
    tokenHash: string,
    at: Date,
  ): Promise<UserClinicSummaryShare | null> {
    return await this.prisma.userClinicSummaryShare.findFirst({
      where: { tokenHash, revokedAt: null, expiresAt: { gt: at } },
    });
  }

  async findByTokenHash(
    tokenHash: string,
  ): Promise<UserClinicSummaryShare | null> {
    return await this.prisma.userClinicSummaryShare.findFirst({
      where: { tokenHash },
    });
  }

  async recordAccess(
    shareId: string,
    at: Date,
  ): Promise<UserClinicSummaryShare | null> {
    // Read first so the caller can return the pre-increment row (`accessCount`
    // before the bump), then do the guarded write. `firstAccessedAt` is set
    // inside the same UPDATE's WHERE-style condition set — prisma has no
    // conditional-set syntax in `updateMany`, so the null check is folded into
    // the read and re-asserted by the accessibility guard on the write.
    const before = await this.prisma.userClinicSummaryShare.findFirst({
      where: { id: shareId, revokedAt: null, expiresAt: { gt: at } },
    });
    if (before === null) {
      return null;
    }
    const result = await this.prisma.userClinicSummaryShare.updateMany({
      where: { id: shareId, revokedAt: null, expiresAt: { gt: at } },
      data: {
        accessCount: { increment: 1 },
        lastAccessedAt: at,
        ...(before.firstAccessedAt === null ? { firstAccessedAt: at } : {}),
      },
    });
    if (result.count === 0) {
      return null;
    }
    return before;
  }

  async listByUser(userId: string): Promise<UserClinicSummaryShare[]> {
    return await this.prisma.userClinicSummaryShare.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async revoke(userId: string, shareId: string, at: Date): Promise<boolean> {
    const result = await this.prisma.userClinicSummaryShare.updateMany({
      where: { id: shareId, userId },
      data: { revokedAt: at },
    });
    return result.count > 0;
  }
}

/**
 * Prisma implementation of {@link ClinicSummarySources}.
 *
 * Only the nickname comes from here; every health field is read through
 * IUserHealthContextReader and daily records through
 * DailyRecordReaderPort - see the port comments for why.
 */
@Injectable()
export class PrismaClinicSummarySources implements ClinicSummarySources {
  constructor(private readonly prisma: PrismaService) {}

  async findDisplayName(userId: string): Promise<string | null> {
    const user = await this.prisma.user.findFirstOrThrow({
      where: { id: userId, deletedAt: null },
      select: { nickname: true },
    });
    return user.nickname;
  }
}

/** Providers wiring both ports to their Prisma implementations. */
export const CLINIC_SUMMARY_PROVIDERS = [
  PrismaClinicSummaryShares,
  PrismaClinicSummarySources,
  { provide: CLINIC_SUMMARY_SHARES, useExisting: PrismaClinicSummaryShares },
  { provide: CLINIC_SUMMARY_SOURCES, useExisting: PrismaClinicSummarySources },
];
