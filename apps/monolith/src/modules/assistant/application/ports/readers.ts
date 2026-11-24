import type { MedicineReminderItemDto } from '../../../reminder/index.js';
import type { DailyRecordCandidateData } from '../../../record/index.js';

import type { DailyRecordItemDto } from '../../../record/index.js';

import type { GenerateDailyRecordCandidatesDto } from '../../../record/index.js';

/**
 * Minimal read-only view of user settings needed by the assistant policy layer.
 * This keeps assistant-policy.service.ts from depending on the concrete
 * UserSettingsDataDto class in the settings module.
 */
export interface IAssistantUserSettings {
  aiSummariesEnabled: boolean;
  dataSharingConsent?: boolean;
  assistantEnabled: boolean;
  assistantMemoryEnabled: boolean;
  assistantContext: {
    healthProfile: boolean;
    dailyRecords: boolean;
    sleepRecords: boolean;
    currentMedicines: boolean;
  };
  updatedAt?: string | null;
  passwordReauthenticationRequired?: boolean;
}

/**
 * Supported report aggregation ranges. Mirrors the values in
 * reports/dto/report-dashboard-query.dto.ts so the assistant module does not
 * need to import that DTO.
 */
export type AssistantReportRange = 'last_7_days' | 'last_30_days' | 'custom';

/**
 * Port for reading a user's medicine reminders. Implemented by the
 * reminder module and consumed by assistant tools.
 */
export interface IMedicineReminderReader {
  list(
    userId: string,
    activeOnly?: boolean,
  ): Promise<{ items: MedicineReminderItemDto[] }>;
}

export const MEDICINE_REMINDER_READER = Symbol('MEDICINE_REMINDER_READER');

/**
 * Port for reading daily records. Implemented by the record module and
 * consumed by assistant tools.
 */
export interface IDailyRecordReader {
  list(
    userId: string,
    date: string,
    kind?: string,
    page?: number,
    pageSize?: number,
  ): Promise<{ items: DailyRecordItemDto[]; total: number }>;
}

export const DAILY_RECORD_READER = Symbol('DAILY_RECORD_READER');

/**
 * Port for generating daily-record candidates. Implemented by the
 * record module and consumed by assistant proposal tools.
 */
export interface IDailyRecordCandidateGenerator {
  generate(
    userId: string,
    dto: GenerateDailyRecordCandidatesDto,
    language: string,
  ): Promise<DailyRecordCandidateData>;
}

export const DAILY_RECORD_CANDIDATE_GENERATOR = Symbol(
  'DAILY_RECORD_CANDIDATE_GENERATOR',
);
