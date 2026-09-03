import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { Prisma } from '#generated/prisma/client.js';
import { parseDateOnly } from '../../../../common/index.js';
import { PrismaService } from '../../../../prisma/index.js';
import {
  TODAY_ANALYSIS_MAX_GENERATIONS_PER_DATE,
  TODAY_ANALYSIS_CLAIM_TIMEOUT_MS,
  TODAY_ANALYSIS_REFRESH_COOLDOWN_MS,
  type MarkTodayAnalysisPendingInput,
  type MarkTodayAnalysisFailedInput,
  type MarkTodayAnalysisReadyInput,
  type TodayAnalysisMaterializationRow,
  type TodayAnalysisMaterializationView,
} from '../../types/materialization.types.js';

export interface TodayAnalysisPendingResult extends TodayAnalysisMaterializationView {
  shouldQueue: boolean;
}

export type TodayAnalysisGenerationClaim =
  | {
      claimed: true;
      status: 'claimed';
      activeVersion: number;
    }
  | {
      claimed: false;
      status: 'stale' | 'capped' | 'busy';
    };

@Injectable()
export class TodayAnalysisMaterializationStore {
  constructor(private readonly prisma: PrismaService) {}

  async readStatus(
    userId: string,
    localDate: string,
  ): Promise<TodayAnalysisMaterializationView> {
    const row = (await this.prisma.userTodayAnalysisMaterialization.findUnique({
      where: {
        userId_localDate: { userId, localDate: parseDateOnly(localDate) },
      },
    })) as TodayAnalysisMaterializationRow | null;

    if (row == null) {
      const date = parseDateOnly(localDate);
      return {
        id: '',
        userId,
        localDate: date,
        sourceVersion: 0,
        computedVersion: 0,
        status: 'empty',
        reasonCodes: [],
        generationCount: 0,
        activeVersion: null,
        activeAt: null,
        lastManualAt: null,
        lastTriggerKey: null,
        lastErrorCode: null,
        queuedAt: null,
        computedAt: null,
        updatedAt: date,
      };
    }

    return { ...row, status: this.toPublicStatus(row) };
  }

  async markPending(
    input: MarkTodayAnalysisPendingInput,
  ): Promise<TodayAnalysisPendingResult> {
    const localDate = parseDateOnly(input.localDate);
    const result = await this.runSerializableTransaction(async (tx) => {
      const current = (await tx.userTodayAnalysisMaterialization.findUnique({
        where: { userId_localDate: { userId: input.userId, localDate } },
      })) as TodayAnalysisMaterializationRow | null;
      const queuedAt = new Date();

      if (
        current?.lastTriggerKey != null &&
        current.lastTriggerKey === input.triggerKey
      ) {
        return { row: current, shouldQueue: false };
      }

      const hasActiveClaim = current?.activeVersion != null;
      const nextVersion = Math.max(
        current == null
          ? 0
          : hasActiveClaim || current.status !== 'pending'
            ? current.sourceVersion + 1
            : current.sourceVersion,
        input.requestedSourceVersion ?? 0,
      );
      const generationCount = current?.generationCount ?? 0;
      const capped = generationCount >= TODAY_ANALYSIS_MAX_GENERATIONS_PER_DATE;
      const nextStatus = capped ? ('capped' as const) : ('pending' as const);
      const reasonCodes = [
        ...new Set([...(current?.reasonCodes ?? []), input.reasonCode]),
      ];
      const data = {
        sourceVersion: nextVersion,
        status: nextStatus,
        reasonCodes,
        activeVersion: null,
        activeAt: null,
        lastTriggerKey: input.triggerKey ?? null,
        lastErrorCode: null,
        queuedAt,
        ...(input.manual ? { lastManualAt: queuedAt } : {}),
      };

      const row =
        current == null
          ? await tx.userTodayAnalysisMaterialization.create({
              data: {
                userId: input.userId,
                localDate,
                sourceVersion: nextVersion,
                computedVersion: 0,
                status: nextStatus,
                reasonCodes,
                generationCount: 0,
                activeVersion: null,
                activeAt: null,
                lastManualAt: input.manual ? queuedAt : null,
                lastTriggerKey: input.triggerKey ?? null,
                lastErrorCode: null,
                queuedAt,
              },
            })
          : await tx.userTodayAnalysisMaterialization.update({
              where: { id: current.id },
              data,
            });

      return {
        row,
        shouldQueue:
          !capped &&
          (current == null ||
            hasActiveClaim ||
            current.status !== 'pending' ||
            nextVersion > current.sourceVersion),
      };
    });

    const view = {
      ...result.row,
      status: this.toPublicStatus(result.row),
    };
    return {
      ...view,
      shouldQueue: result.shouldQueue,
    };
  }

  async claimGeneration(
    userId: string,
    localDate: string,
    sourceVersion: number,
  ): Promise<TodayAnalysisGenerationClaim> {
    const current = await this.readStatus(userId, localDate);
    if (current.sourceVersion !== sourceVersion) {
      return { claimed: false, status: 'stale' };
    }
    if (current.generationCount >= TODAY_ANALYSIS_MAX_GENERATIONS_PER_DATE) {
      await this.prisma.userTodayAnalysisMaterialization.updateMany({
        where: {
          userId,
          localDate: parseDateOnly(localDate),
          sourceVersion,
        },
        data: { status: 'capped' },
      });
      return { claimed: false, status: 'capped' };
    }
    const nextActiveVersion = sourceVersion + current.generationCount;
    if (current.activeVersion != null) {
      const expiredAt = new Date(Date.now() - TODAY_ANALYSIS_CLAIM_TIMEOUT_MS);
      const reclaimed =
        await this.prisma.userTodayAnalysisMaterialization.updateMany({
          where: {
            userId,
            localDate: parseDateOnly(localDate),
            sourceVersion,
            status: 'pending',
            activeVersion: current.activeVersion,
            activeAt: current.activeAt == null ? null : { lte: expiredAt },
          },
          data: { activeVersion: null, activeAt: null },
        });
      if (reclaimed.count === 0) {
        return { claimed: false, status: 'busy' };
      }
    }

    const result =
      await this.prisma.userTodayAnalysisMaterialization.updateMany({
        where: {
          userId,
          localDate: parseDateOnly(localDate),
          sourceVersion,
          status: 'pending',
          activeVersion: null,
          generationCount: { lt: TODAY_ANALYSIS_MAX_GENERATIONS_PER_DATE },
        },
        data: {
          activeVersion: nextActiveVersion,
          activeAt: new Date(),
          generationCount: { increment: 1 },
          status: 'pending',
        },
      });
    return result.count === 1
      ? {
          claimed: true,
          status: 'claimed',
          activeVersion: nextActiveVersion,
        }
      : { claimed: false, status: 'busy' };
  }

  private async runSerializableTransaction<T>(
    callback: (tx: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        return await this.prisma.$transaction(callback, {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        });
      } catch (error) {
        const code =
          error != null && typeof error === 'object' && 'code' in error
            ? (error as { code?: unknown }).code
            : undefined;
        if (attempt === 0 && (code === 'P2002' || code === 'P2034')) {
          continue;
        }
        throw error;
      }
    }
    throw new InternalServerErrorException(
      'TODAY_ANALYSIS_TRANSACTION_RETRY_EXHAUSTED',
    );
  }

  async markReady(input: MarkTodayAnalysisReadyInput): Promise<boolean> {
    const result =
      await this.prisma.userTodayAnalysisMaterialization.updateMany({
        where: {
          userId: input.userId,
          localDate: parseDateOnly(input.localDate),
          sourceVersion: input.sourceVersion,
          activeVersion: input.activeVersion,
          status: 'pending',
        },
        data: {
          computedVersion: input.sourceVersion,
          status: 'ready',
          computedAt: new Date(),
          activeVersion: null,
          activeAt: null,
          lastErrorCode: null,
        },
      });
    return result.count === 1;
  }

  async markFailed(input: MarkTodayAnalysisFailedInput): Promise<boolean> {
    const result =
      await this.prisma.userTodayAnalysisMaterialization.updateMany({
        where: {
          userId: input.userId,
          localDate: parseDateOnly(input.localDate),
          sourceVersion: input.sourceVersion,
          activeVersion: input.activeVersion,
          status: 'pending',
        },
        data: {
          status: 'failed',
          lastErrorCode: input.errorCode,
          activeVersion: null,
          activeAt: null,
        },
      });
    return result.count === 1;
  }

  async releaseClaim(
    userId: string,
    localDate: string,
    sourceVersion: number,
    activeVersion: number,
  ): Promise<void> {
    await this.prisma.userTodayAnalysisMaterialization.updateMany({
      where: {
        userId,
        localDate: parseDateOnly(localDate),
        sourceVersion,
        activeVersion,
        status: 'pending',
      },
      data: { activeVersion: null, activeAt: null },
    });
  }

  isRefreshCoolingDown(status: TodayAnalysisMaterializationView): boolean {
    return (
      status.lastManualAt != null &&
      Date.now() - status.lastManualAt.getTime() <
        TODAY_ANALYSIS_REFRESH_COOLDOWN_MS
    );
  }

  private toPublicStatus(
    row: TodayAnalysisMaterializationRow,
  ): TodayAnalysisMaterializationView['status'] {
    if (row.status === 'capped') return 'stale';
    if (row.sourceVersion > row.computedVersion && row.computedVersion > 0) {
      return 'stale';
    }
    return row.status;
  }
}
