import { Injectable, Logger, Optional } from '@nestjs/common';

import { MetricsService } from '../../../../common/metrics/metrics.service.js';
import { resolveLocale } from '../../../../common/index.js';
import { PrismaService } from '../../../../prisma/index.js';
import { SuggestionService } from '../suggestion.service.js';
import { MaterializationStore } from '../materialization/store.service.js';
import { SuggestionCacheService } from '../cache/suggestion-cache.service.js';
import { BaselineService } from '../lifecycle/baseline.service.js';
import { SUGGESTION_DEFAULT_LOCALE } from '../../constants/locale.constants.js';
import type { RecomputeJobData } from './queue.service.js';

const MAX_RECOMPUTE_VERSION_FOLLOW_UPS = 3;

@Injectable()
export class SuggestionRecomputeWorkerService {
  private readonly logger = new Logger(SuggestionRecomputeWorkerService.name);

  constructor(
    private readonly suggestionService: SuggestionService,
    private readonly materializationStore: MaterializationStore,
    private readonly cache: SuggestionCacheService,
    private readonly baseline: BaselineService,
    private readonly prisma: PrismaService,
    @Optional() private readonly metricsService?: MetricsService,
  ) {}

  async process(job: RecomputeJobData): Promise<void> {
    const startedAt = performance.now();
    try {
      await this.processRecompute(job);
      this.metricsService?.recordSuggestionRecomputeDuration(
        'success',
        (performance.now() - startedAt) / 1000,
      );
    } catch (error) {
      this.metricsService?.recordSuggestionRecomputeDuration(
        'failed',
        (performance.now() - startedAt) / 1000,
      );
      throw error;
    }
  }

  private async processRecompute(job: RecomputeJobData): Promise<void> {
    let currentJob = job;

    for (
      let followUpCount = 0;
      followUpCount <= MAX_RECOMPUTE_VERSION_FOLLOW_UPS;
      followUpCount += 1
    ) {
      try {
        const current = await this.materializationStore.readStatus(
          currentJob.userId,
          currentJob.localDate,
        );
        if (
          current.status === 'ready' &&
          current.computedVersion >= currentJob.sourceVersion
        ) {
          return;
        }
        if (current.sourceVersion > currentJob.sourceVersion) {
          if (followUpCount >= MAX_RECOMPUTE_VERSION_FOLLOW_UPS) {
            // eslint-disable-next-line error-handling/no-bare-throw-error -- 控制流异常，跳出 recompute 循环
            throw new Error('RECOMPUTE_VERSION_CONFLICT');
          }
          currentJob = this.followUpJob(currentJob, current);
          continue;
        }

        // The worker owns the recompute cache boundary. This also protects
        // direct inline processing when an event listener could not run.
        await this.cache.invalidateSignals(
          currentJob.userId,
          currentJob.localDate,
        );
        // Copy is persisted at recompute time, so the language has to be the
        // user's own preference rather than a fixed default: hardcoding
        // `zh-CN` here is what made an English-locale user receive Chinese
        // card titles/bodies. A user with no stored preference keeps the
        // product default.
        const locale = await this.resolveUserLocale(currentJob.userId);
        let baselineObservationError: unknown;
        await this.suggestionService.recompute(
          currentJob.userId,
          currentJob.localDate,
          undefined,
          {
            locale,
            sourceVersion: currentJob.sourceVersion,
            onSuccessfulRecompute: async (signals) => {
              try {
                await this.baseline.recordObservations(
                  currentJob.userId,
                  currentJob.localDate,
                  signals,
                );
                await this.cache.invalidateBaseline(currentJob.userId);
                // eslint-disable-next-line error-handling/no-silent-catch -- 错误延迟到外层处理，非静默吞咽
              } catch (error) {
                baselineObservationError = error;
              }
            },
          },
        );

        if (baselineObservationError != null) {
          await this.materializationStore.markFailed({
            userId: currentJob.userId,
            localDate: currentJob.localDate,
            sourceVersion: currentJob.sourceVersion,
            errorCode: 'BASELINE_OBSERVATION_FAILED',
            computedVersion: currentJob.sourceVersion,
          });
          return;
        }

        const latest = await this.materializationStore.readStatus(
          currentJob.userId,
          currentJob.localDate,
        );
        if (latest.sourceVersion > currentJob.sourceVersion) {
          if (followUpCount >= MAX_RECOMPUTE_VERSION_FOLLOW_UPS) {
            // eslint-disable-next-line error-handling/no-bare-throw-error -- 控制流异常，跳出 recompute 循环
            throw new Error('RECOMPUTE_VERSION_CONFLICT');
          }
          currentJob = this.followUpJob(currentJob, latest);
          continue;
        }

        await this.materializationStore.markReady({
          userId: currentJob.userId,
          localDate: currentJob.localDate,
          sourceVersion: currentJob.sourceVersion,
          reasonCodes: currentJob.reasonCodes,
        });

        const afterReady = await this.materializationStore.readStatus(
          currentJob.userId,
          currentJob.localDate,
        );
        if (afterReady.sourceVersion > currentJob.sourceVersion) {
          if (followUpCount >= MAX_RECOMPUTE_VERSION_FOLLOW_UPS) {
            // eslint-disable-next-line error-handling/no-bare-throw-error -- 控制流异常，跳出 recompute 循环
            throw new Error('RECOMPUTE_VERSION_CONFLICT');
          }
          currentJob = this.followUpJob(currentJob, afterReady);
          continue;
        }
        return;
      } catch (error) {
        let latest:
          | Awaited<ReturnType<MaterializationStore['readStatus']>>
          | undefined;
        try {
          latest = await this.materializationStore.readStatus(
            currentJob.userId,
            currentJob.localDate,
          );
        } catch (statusError) {
          this.logger.error(
            `Failed to read suggestion materialization while handling recompute failure: ${
              statusError instanceof Error
                ? statusError.message
                : String(statusError)
            }`,
          );
        }

        const failedVersion = Math.max(
          currentJob.sourceVersion,
          latest?.sourceVersion ?? currentJob.sourceVersion,
        );
        if (
          latest != null &&
          latest.sourceVersion > currentJob.sourceVersion &&
          followUpCount < MAX_RECOMPUTE_VERSION_FOLLOW_UPS
        ) {
          currentJob = this.followUpJob(currentJob, latest);
          continue;
        }

        try {
          await this.materializationStore.markFailed({
            userId: currentJob.userId,
            localDate: currentJob.localDate,
            sourceVersion: failedVersion,
            errorCode:
              latest != null && latest.sourceVersion > currentJob.sourceVersion
                ? 'RECOMPUTE_VERSION_CONFLICT'
                : 'RECOMPUTE_FAILED',
          });
        } catch (markFailedError) {
          this.logger.error(
            `Failed to mark suggestion recompute failed: ${
              markFailedError instanceof Error
                ? markFailedError.message
                : String(markFailedError)
            }`,
          );
        }
        throw error;
      }
    }

    // eslint-disable-next-line error-handling/no-bare-throw-error -- 控制流异常，跳出 recompute 循环
    throw new Error('RECOMPUTE_VERSION_CONFLICT');
  }

  private followUpJob(
    previous: RecomputeJobData,
    latest: {
      sourceVersion: number;
      reasonCodes: RecomputeJobData['reasonCodes'];
    },
  ): RecomputeJobData {
    this.logger.debug(
      `Continuing suggestion recompute with version ${String(latest.sourceVersion)} after ${String(previous.sourceVersion)}`,
    );
    return {
      ...previous,
      sourceVersion: latest.sourceVersion,
      reasonCodes: latest.reasonCodes,
    };
  }

  /**
   * Resolves the language the persisted card copy should be generated in.
   *
   * Read from the user profile (the client uploads its language there) rather
   * than from a job field, so a debounced recompute started before a language
   * change still uses the current preference. A missing/blank preference (the
   * client uploads `''` for "follow the system language") keeps the product
   * default, matching `SuggestionService.recompute`'s fallback.
   */
  private async resolveUserLocale(userId: string): Promise<string> {
    try {
      const user = await this.prisma.user.findUnique({
        where: { id: userId },
        select: { profile: { select: { locale: true } } },
      });
      const raw = user?.profile?.locale;
      if (raw != null && raw.trim().length > 0) {
        return resolveLocale(raw);
      }
    } catch (error) {
      // A locale lookup must never fail the recompute: the copy falls back to
      // the product default instead.
      this.logger.warn(
        `Failed to read locale for suggestion recompute (user=${userId}); using default: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
    return SUGGESTION_DEFAULT_LOCALE;
  }
}
