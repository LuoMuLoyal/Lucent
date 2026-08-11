import { Injectable, Logger, Optional } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';

import { formatDateOnly, parseDateOnly } from '../../../../common';
import { PrismaService } from '../../../../prisma';
import {
  TODAY_SUGGESTION_MATERIALIZATION_CHANGED,
  type TodaySuggestionMaterializationChangedPayload,
} from '../../../../common/events/domain-events';
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
  private readonly logger = new Logger(MaterializationStore.name);

  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly eventEmitter?: EventEmitter2,
  ) {}

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
    const reasonCodes =
      current?.status === 'pending'
        ? this.uniqueReasonCodes([...current.reasonCodes, ...input.reasonCodes])
        : this.uniqueReasonCodes(input.reasonCodes);

    if (!current) {
      await this.prisma.userSuggestionMaterialization.create({
        data: {
          userId: input.userId,
          localDate,
          sourceVersion: input.sourceVersion,
          computedVersion: 0,
          status: 'pending',
          reasonCodes,
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
          reasonCodes,
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
    const result = await this.prisma.userSuggestionMaterialization.updateMany({
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

    if (result.count === 1 && this.eventEmitter != null) {
      const reasonCodes = input.reasonCodes ?? [];
      const analysisEligible = reasonCodes.some(
        (reason) =>
          reason === 'dose_log_changed' || reason === 'health_event_changed',
      );
      if (analysisEligible) {
        try {
          await this.eventEmitter.emitAsync(
            TODAY_SUGGESTION_MATERIALIZATION_CHANGED,
            {
              userId: input.userId,
              date: formatDateOnly(parseDateOnly(input.localDate)),
              sourceVersion: input.sourceVersion,
              analysisEligible,
              triggerKey: `suggestion:${String(input.sourceVersion)}`,
            } satisfies TodaySuggestionMaterializationChangedPayload,
          );
        } catch (error) {
          this.logger.warn(
            `Failed to emit suggestion materialization change: ${String(error)}`,
          );
        }
      }
    }

    return this.readStatus(input.userId, input.localDate);
  }

  async markFailed(
    input: MaterializationVersionInput & {
      errorCode: string;
      computedVersion?: number;
    },
  ): Promise<MaterializationStatusView> {
    const data = {
      status: 'failed' as const,
      lastErrorCode: input.errorCode,
      ...(input.computedVersion != null
        ? { computedVersion: input.computedVersion }
        : {}),
    };
    await this.prisma.userSuggestionMaterialization.updateMany({
      where: {
        userId: input.userId,
        localDate: parseDateOnly(input.localDate),
        sourceVersion: input.sourceVersion,
        status: 'pending',
      },
      data,
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
