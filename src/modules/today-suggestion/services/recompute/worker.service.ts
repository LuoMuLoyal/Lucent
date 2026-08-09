import { Injectable, Logger } from '@nestjs/common';

import { SuggestionService } from '../suggestion.service';
import { MaterializationStore } from '../materialization/store.service';
import { SuggestionCacheService } from '../cache/suggestion-cache.service';
import type { RecomputeJobData } from './queue.service';

const MAX_RECOMPUTE_VERSION_FOLLOW_UPS = 3;

@Injectable()
export class SuggestionRecomputeWorkerService {
  private readonly logger = new Logger(SuggestionRecomputeWorkerService.name);

  constructor(
    private readonly suggestionService: SuggestionService,
    private readonly materializationStore: MaterializationStore,
    private readonly cache: SuggestionCacheService,
  ) {}

  async process(job: RecomputeJobData): Promise<void> {
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
        await this.suggestionService.recompute(
          currentJob.userId,
          currentJob.localDate,
          undefined,
          { locale: 'zh-CN', sourceVersion: currentJob.sourceVersion },
        );

        const latest = await this.materializationStore.readStatus(
          currentJob.userId,
          currentJob.localDate,
        );
        if (latest.sourceVersion > currentJob.sourceVersion) {
          if (followUpCount >= MAX_RECOMPUTE_VERSION_FOLLOW_UPS) {
            throw new Error('RECOMPUTE_VERSION_CONFLICT');
          }
          currentJob = this.followUpJob(currentJob, latest);
          continue;
        }

        await this.materializationStore.markReady({
          userId: currentJob.userId,
          localDate: currentJob.localDate,
          sourceVersion: currentJob.sourceVersion,
        });

        const afterReady = await this.materializationStore.readStatus(
          currentJob.userId,
          currentJob.localDate,
        );
        if (afterReady.sourceVersion > currentJob.sourceVersion) {
          if (followUpCount >= MAX_RECOMPUTE_VERSION_FOLLOW_UPS) {
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
