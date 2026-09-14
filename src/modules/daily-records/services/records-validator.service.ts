import { Injectable } from '@nestjs/common';
import { DailyRecordKind } from '#generated/prisma/client.js';
import {
  createDomainFailure,
  type DomainFailure,
} from '../../../common/result/index.js';
import type { UpdateDailyRecordDto } from '../dto/update-record.dto.js';

/** 症状严重度码词汇（与客户端 `SymptomSeverity` 及 health_context 的过敏严重度一致）。 */
const SYMPTOM_SEVERITIES = new Set(['mild', 'moderate', 'severe', 'unknown']);

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
      this.validateSymptomPayload(kind, payload) ??
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

    const startedAt = payload['startedAt'];
    const endedAt = payload['endedAt'];
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

  /**
   * 症状 payload 是可选的（NLP 候选等可能只给 title），给定时校验形状。
   *
   * `symptom` 是目录码、`severity` 是严重度码；目录成员资格由症状目录端点定义，
   * 这里只保证类型与取值词汇，不重复目录清单。
   */
  private validateSymptomPayload(
    kind: string,
    payload: Record<string, unknown> | undefined,
  ): DomainFailure | null {
    if (kind !== DailyRecordKind.symptom) return null;
    if (payload == null) return null;

    const symptom = payload['symptom'];
    if (
      symptom !== undefined &&
      (typeof symptom !== 'string' || symptom.trim().length === 0)
    ) {
      return this.validationFailed();
    }
    const severity = payload['severity'];
    if (
      severity !== undefined &&
      (typeof severity !== 'string' || !SYMPTOM_SEVERITIES.has(severity))
    ) {
      return this.validationFailed();
    }
    const customLabel = payload['customLabel'];
    if (customLabel !== undefined && typeof customLabel !== 'string') {
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
