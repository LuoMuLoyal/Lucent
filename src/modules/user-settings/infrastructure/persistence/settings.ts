/**
 * Persistence: `SettingsRepository` on top of `UserSetting`.
 *
 * ## One row per setting, `@@unique([userId, key])`
 *
 * Each key is an independent row, so a write is a set of upserts, not one
 * statement. They are issued concurrently: keys are disjoint by construction
 * (one upsert per field), so there is no lost-update hazard between them and
 * serialising them would only add latency.
 *
 * ## Prisma types stay here
 *
 * The domain never sees `Prisma.UserSetting*`; the port speaks
 * `SettingRowSnapshot` / `SettingRowUpsert`. That is what lets the aggregate be
 * unit-tested with hand-built rows (ADR-0024 section 4).
 *
 * ## Errors
 *
 * A P2002 unique violation (two concurrent `PATCH`es creating the same key) is
 * a legitimate business outcome: it rejects with the mapped `DomainFailure` so
 * the use case can surface `RESOURCE_CONFLICT`. Every other rejection is
 * infrastructure and propagates untouched, never as a 4xx.
 */

import { Injectable } from '@nestjs/common';

import { PrismaService } from '../../../../prisma/index.js';
import { mapPrismaKnownRequestError } from '../../../../common/helpers/prisma/prisma-result.utils.js';
import { DomainFailureException } from '../../../../common/result/index.js';
import type {
  SettingRowSnapshot,
  SettingRowUpsert,
} from '../../domain/settings/settings.js';
import { SettingsRepository } from '../../domain/settings/settings.js';

@Injectable()
export class PrismaSettings extends SettingsRepository {
  constructor(private readonly prisma: PrismaService) {
    super();
  }

  listRows(userId: string): Promise<SettingRowSnapshot[]> {
    return this.prisma.userSetting.findMany({
      where: { userId },
      orderBy: { updatedAt: 'desc' },
      select: { key: true, value: true, updatedAt: true },
    });
  }

  async upsertMany(userId: string, upserts: SettingRowUpsert[]): Promise<void> {
    await mapKnownFailure(
      Promise.all(
        upserts.map(({ key, value }) =>
          this.prisma.userSetting.upsert({
            where: { userId_key: { userId, key } },
            create: { userId, key, value },
            update: { value },
          }),
        ),
      ),
    );
  }

  async seedDefaults(
    userId: string,
    defaults: ReadonlyArray<SettingRowUpsert>,
  ): Promise<void> {
    await mapKnownFailure(
      this.prisma.userSetting.createMany({
        data: defaults.map(({ key, value }) => ({ userId, key, value })),
        skipDuplicates: true,
      }),
    );
  }
}

/**
 * Awaits a Prisma write, rejecting with a `DomainFailureException` (carrying the
 * mapped failure) when the error is one this backend maps to a business outcome
 * (P2002 -> conflict, P2025 -> not found). Everything else propagates with its
 * original identity.
 */
async function mapKnownFailure(write: Promise<unknown>): Promise<void> {
  try {
    await write;
  } catch (error) {
    const failure = mapPrismaKnownRequestError(error);
    if (failure != null) {
      throw new DomainFailureException(failure);
    }
    throw error;
  }
}
