import { Injectable, Logger, Optional } from '@nestjs/common';

import { MetricsService } from '../../../../common/metrics/metrics.service';
import { SuggestionService } from '../suggestion.service';
import { MaterializationStore } from '../materialization/store.service';
import { SuggestionCacheService } from '../cache/suggestion-cache.service';
import { BaselineService } from '../lifecycle/baseline.service';
import type { RecomputeJobData } from './queue.service';

const MAX_RECOMPUTE_VERSION_FOLLOW_UPS = 3;

@Injectable()
export class SuggestionRecomputeWorkerService {
  private readonly logger = new Logger(SuggestionRecomputeWorkerService.name);

  constructor(
    private readonly suggestionService: SuggestionService,
    private readonly materializationStore: MaterializationStore,
    private readonly cache: SuggestionCacheService,
    private readonly baseline: BaselineService,
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
        let baselineObservationError: unknown;
        await this.suggestionService.recompute(
          currentJob.userId,
          currentJob.localDate,
          undefined,
          {
            locale: 'zh-CN',
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
}
