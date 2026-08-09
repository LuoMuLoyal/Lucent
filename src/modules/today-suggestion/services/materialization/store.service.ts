import { Injectable } from '@nestjs/common';

import { parseDateOnly } from '../../../../common';
import { PrismaService } from '../../../../prisma';
import type {
  MarkPendingInput,
  MaterializationReasonCode,
  MaterializationRow,
  MaterializationStatus,
  MaterializationStatusView,
  MaterializationVersionInput,
} from '../../types/materialization.types';

@Injectable()
export class MaterializationStore {
  constructor(private readonly prisma: PrismaService) {}

  async readStatus(
    userId: string,
    localDate: string,
  ): Promise<MaterializationStatusView> {
    const date = parseDateOnly(localDate);
    const row = (await this.prisma.userSuggestionMaterialization.findUnique({
      where: { userId_localDate: { userId, localDate: date } },
    })) as MaterializationRow | null;

    if (!row) {
      return {
        id: '',
        userId,
        localDate: date,
        sourceVersion: 0,
        computedVersion: 0,
        status: 'empty',
        reasonCodes: [],
        lastErrorCode: null,
        queuedAt: null,
        computedAt: null,
        updatedAt: date,
      };
    }

    return {
      ...row,
      status: this.toPublicStatus(row),
    };
  }

  async markPending(
    input: MarkPendingInput,
  ): Promise<MaterializationStatusView> {
    const localDate = parseDateOnly(input.localDate);
    const current = (await this.prisma.userSuggestionMaterialization.findUnique(
      {
        where: {
          userId_localDate: { userId: input.userId, localDate },
        },
      },
    )) as MaterializationRow | null;
    const queuedAt = new Date();

    if (!current) {
      await this.prisma.userSuggestionMaterialization.create({
        data: {
          userId: input.userId,
          localDate,
          sourceVersion: input.sourceVersion,
          computedVersion: 0,
          status: 'pending',
          reasonCodes: this.uniqueReasonCodes(input.reasonCodes),
          lastErrorCode: null,
          queuedAt,
        },
      });
    } else if (input.sourceVersion >= current.sourceVersion) {
      await this.prisma.userSuggestionMaterialization.update({
        where: { id: current.id },
        data: {
          sourceVersion: input.sourceVersion,
          status: 'pending',
          reasonCodes: this.uniqueReasonCodes([
            ...current.reasonCodes,
            ...input.reasonCodes,
          ]),
          lastErrorCode: null,
          queuedAt,
        },
      });
    }

    return this.readStatus(input.userId, input.localDate);
  }

  async markReady(
    input: MaterializationVersionInput,
  ): Promise<MaterializationStatusView> {
    await this.prisma.userSuggestionMaterialization.updateMany({
      where: {
        userId: input.userId,
        localDate: parseDateOnly(input.localDate),
        sourceVersion: input.sourceVersion,
        status: 'pending',
      },
      data: {
        computedVersion: input.sourceVersion,
        status: 'ready',
        lastErrorCode: null,
        computedAt: new Date(),
      },
    });

    return this.readStatus(input.userId, input.localDate);
  }

  async markFailed(
    input: MaterializationVersionInput & { errorCode: string },
  ): Promise<MaterializationStatusView> {
    await this.prisma.userSuggestionMaterialization.updateMany({
      where: {
        userId: input.userId,
        localDate: parseDateOnly(input.localDate),
        sourceVersion: input.sourceVersion,
        status: 'pending',
      },
      data: {
        status: 'failed',
        lastErrorCode: input.errorCode,
      },
    });

    return this.readStatus(input.userId, input.localDate);
  }

  private toPublicStatus(row: MaterializationRow): MaterializationStatus {
    if (row.status === 'ready' && row.sourceVersion > row.computedVersion) {
      return 'stale';
    }
    return row.status;
  }

  private uniqueReasonCodes(
    reasonCodes: MaterializationReasonCode[],
  ): MaterializationReasonCode[] {
    return [...new Set(reasonCodes)];
  }
}
