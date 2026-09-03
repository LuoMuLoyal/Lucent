import { Injectable } from '@nestjs/common';
import {
  AssistantSummaryRepositoryPort,
  type PersistSummaryInput,
  type TodaySummaryRow,
  type ReportSummaryRow,
  type ReportRangeInput,
} from '../repositories/summary.repository.js';
import { parseDateOnly } from '../../../common/index.js';
import type {
  DomainFailure,
  ResultAsync,
} from '../../../common/result/index.js';
import type { AssistantReportRange } from '../types/ports.js';

export type {
  PersistSummaryInput,
  TodaySummaryRow,
  ReportSummaryRow,
  ReportRangeInput,
  SummaryBullet,
} from '../repositories/summary.repository.js';

@Injectable()
export class HistoricalAiSummaryService {
  constructor(private readonly repository: AssistantSummaryRepositoryPort) {}

  save(input: PersistSummaryInput): ResultAsync<void, DomainFailure> {
    return this.repository.save(input);
  }

  async listRecentTodaySummaries(
    userId: string,
    limit = 7,
  ): Promise<TodaySummaryRow[]> {
    return this.repository.listRecentTodaySummaries(userId, limit);
  }

  async listRecentReportSummaries(
    userId: string,
    limit = 6,
  ): Promise<ReportSummaryRow[]> {
    return this.repository.listRecentReportSummaries(userId, limit);
  }

  async getLatestTodaySummaryByDate(
    userId: string,
    date: string,
  ): Promise<TodaySummaryRow | null> {
    return this.repository.findLatestTodaySummaryByDate(
      userId,
      parseDateOnly(date),
    );
  }

  async getLatestReportSummaryByRange(
    userId: string,
    input: ReportRangeInput,
  ): Promise<ReportSummaryRow | null> {
    return this.repository.findLatestReportSummaryByRange(userId, input);
  }
}

export type { AssistantReportRange };
