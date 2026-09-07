import { Injectable } from '@nestjs/common';
import { DailyRecordKind } from '#generated/prisma/client.js';
import {
  createDomainFailure,
  type DomainFailure,
} from '../../../common/result/index.js';
import type { UpdateDailyRecordDto } from '../dto/update-record.dto.js';

/**
 * Stateless payload validation for daily-record create/update.
 *
 * Extracted from `DailyRecordsService` to keep the main service focused on
 * CRUD orchestration.  All methods are pure — no DI required.
 */
@Injectable()
export class DailyRecordsValidatorService {
  validateCreatePayload(
    kind: string,
    payload: Record<string, unknown> | undefined,
  ): DomainFailure | null {
    return (
      this.validateSleepPayload(kind, payload) ??
      this.validateVitalPayload(kind, payload) ??
      this.validateActivityPayload(kind, payload)
    );
  }

  ensureValidSleepFinalState(
    dto: UpdateDailyRecordDto,
    existing: { kind: DailyRecordKind; payload: unknown },
  ): DomainFailure | null {
    const finalKind = dto.kind !== undefined ? dto.kind : existing.kind;
    if (finalKind !== DailyRecordKind.sleep) {
      return null;
    }

    const rawPayload =
      dto.payload !== undefined ? dto.payload : existing.payload;
    return this.validateSleepPayload(
      finalKind,
      rawPayload as Record<string, unknown> | null,
    );
  }

  private validateSleepPayload(
    kind: string,
    payload: Record<string, unknown> | null | undefined,
  ): DomainFailure | null {
    if (kind !== DailyRecordKind.sleep) {
      return null;
    }
    if (payload == null) {
      return this.validationFailed();
    }

    // Quick-entry sleep flow creates temporary start/wake event records first,
    // then merges them into a final sleep record with durationMinutes. Allow
    // those temporary event records to skip the duration validation.
    const sleepEvent = payload['sleepEvent'];
    if (sleepEvent === 'start' || sleepEvent === 'wake') {
      return null;
    }

    if (
      payload['sleepType'] !== undefined &&
      payload['sleepType'] !== 'nightSleep' &&
      payload['sleepType'] !== 'nap'
    ) {
      return this.validationFailed();
    }
    if (
      payload['quality'] !== undefined &&
      typeof payload['quality'] !== 'string'
    ) {
      return this.validationFailed();
    }

    const startedAt = payload['startedAt'] ?? payload['startAt'];
    const endedAt = payload['endedAt'] ?? payload['endAt'];
    if ((startedAt == null) !== (endedAt == null)) {
      return this.validationFailed();
    }
    if (startedAt != null && endedAt != null) {
      if (typeof startedAt !== 'string' || typeof endedAt !== 'string') {
        return this.validationFailed();
      }
      const started = new Date(startedAt);
      const ended = new Date(endedAt);
      if (
        Number.isNaN(started.getTime()) ||
        Number.isNaN(ended.getTime()) ||
        ended.getTime() <= started.getTime()
      ) {
        return this.validationFailed();
      }
    }

    if (
      typeof payload['durationMinutes'] !== 'number' ||
      !Number.isFinite(payload['durationMinutes'])
    ) {
      return this.validationFailed();
    }
    if (payload['durationMinutes'] <= 0) {
      return this.validationFailed();
    }
    return null;
  }

  private validateVitalPayload(
    kind: string,
    payload: Record<string, unknown> | undefined,
  ): DomainFailure | null {
    if (kind !== DailyRecordKind.vital) return null;
    if (payload == null) return null;
    if (typeof payload['vitalType'] !== 'string') {
      return this.validationFailed();
    }
    if (typeof payload['value'] !== 'number') {
      return this.validationFailed();
    }
    return null;
  }

  private validateActivityPayload(
    kind: string,
    payload: Record<string, unknown> | undefined,
  ): DomainFailure | null {
    if (kind !== DailyRecordKind.activity) return null;
    if (payload == null) return null;
    if (typeof payload['activityType'] !== 'string') {
      return this.validationFailed();
    }
    if (typeof payload['value'] !== 'number') {
      return this.validationFailed();
    }
    return null;
  }

  private validationFailed(): DomainFailure {
    return createDomainFailure({
      kind: 'validation',
      code: 'VALIDATION_FAILED',
    });
  }
}
