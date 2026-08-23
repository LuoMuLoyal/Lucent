import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import {
  createDomainFailure,
  errAsync,
  fromPromise,
  okAsync,
  type DomainFailure,
  type ResultAsync,
} from '../../../common/result';
import { UserHealthContextRepositoryPort } from '../repositories/health-context.repository';
import type { CreateCurrentMedicineDto } from '../dto/create-current-medicine.dto';
import type { CreateHealthContextAllergyDto } from '../dto/create-allergy.dto';
import type { CreateHealthContextConditionDto } from '../dto/create-condition.dto';
import type { HealthContextResponseData } from '../dto/response.dto';
import type { UpdateCurrentMedicineDto } from '../dto/update-current-medicine.dto';
import type { UpdateHealthContextAllergyDto } from '../dto/update-allergy.dto';
import type { UpdateHealthContextConditionDto } from '../dto/update-condition.dto';
import type { UpdateHealthContextProfileDto } from '../dto/update-profile.dto';
import { UserHealthContextMapperService } from './mapper.service';
import { UserHealthContextProfileWriteService } from './writes/profile-write.service';
import { UserHealthContextAllergyWriteService } from './writes/allergy-write.service';
import { UserHealthContextConditionWriteService } from './writes/condition-write.service';
import { UserHealthContextMedicineWriteService } from './writes/medicine-write.service';
import {
  HEALTH_CONTEXT_CHANGED,
  type HealthContextChangedPayload,
} from '../../../common/events/domain-events.js';

@Injectable()
export class UserHealthContextService {
  private readonly logger = new Logger(UserHealthContextService.name);

  constructor(
    private readonly repository: UserHealthContextRepositoryPort,
    private readonly mapperService: UserHealthContextMapperService,
    private readonly profileWriteService: UserHealthContextProfileWriteService,
    private readonly allergyWriteService: UserHealthContextAllergyWriteService,
    private readonly conditionWriteService: UserHealthContextConditionWriteService,
    private readonly medicineWriteService: UserHealthContextMedicineWriteService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  getForUser(
    userId: string,
  ): ResultAsync<HealthContextResponseData, DomainFailure> {
    return fromPromise(
      this.repository.findUserWithHealthContext(userId),
      (error) => {
        throw error;
      },
    ).andThen((user) => {
      if (user == null) {
        return errAsync(
          createDomainFailure({
            kind: 'not_found',
            code: 'RESOURCE_NOT_FOUND',
          }),
        );
      }
      return okAsync(this.mapperService.toResponse(user));
    });
  }

  updateProfile(
    userId: string,
    dto: UpdateHealthContextProfileDto,
  ): ResultAsync<HealthContextResponseData, DomainFailure> {
    return this.profileWriteService
      .upsertProfile(userId, dto)
      .andThen(() => this.emitHealthContextChangedAsResult(userId))
      .andThen(() => this.getForUser(userId));
  }

  // ── Allergy ──

  createAllergy(
    userId: string,
    dto: CreateHealthContextAllergyDto,
  ): ResultAsync<HealthContextResponseData, DomainFailure> {
    return this.allergyWriteService
      .create(userId, dto)
      .andThen(() => this.emitHealthContextChangedAsResult(userId))
      .andThen(() => this.getForUser(userId));
  }

  updateAllergy(
    userId: string,
    allergyId: string,
    dto: UpdateHealthContextAllergyDto,
  ): ResultAsync<HealthContextResponseData, DomainFailure> {
    return this.allergyWriteService
      .update(userId, allergyId, dto)
      .andThen(() => this.emitHealthContextChangedAsResult(userId))
      .andThen(() => this.getForUser(userId));
  }

  deleteAllergy(
    userId: string,
    allergyId: string,
  ): ResultAsync<HealthContextResponseData, DomainFailure> {
    return this.allergyWriteService
      .softDelete(userId, allergyId)
      .andThen(() => this.emitHealthContextChangedAsResult(userId))
      .andThen(() => this.getForUser(userId));
  }

  // ── Condition ──

  createCondition(
    userId: string,
    dto: CreateHealthContextConditionDto,
  ): ResultAsync<HealthContextResponseData, DomainFailure> {
    return this.conditionWriteService
      .create(userId, dto)
      .andThen(() => this.emitHealthContextChangedAsResult(userId))
      .andThen(() => this.getForUser(userId));
  }

  updateCondition(
    userId: string,
    conditionId: string,
    dto: UpdateHealthContextConditionDto,
  ): ResultAsync<HealthContextResponseData, DomainFailure> {
    return this.conditionWriteService
      .update(userId, conditionId, dto)
      .andThen(() => this.emitHealthContextChangedAsResult(userId))
      .andThen(() => this.getForUser(userId));
  }

  deleteCondition(
    userId: string,
    conditionId: string,
  ): ResultAsync<HealthContextResponseData, DomainFailure> {
    return this.conditionWriteService
      .softDelete(userId, conditionId)
      .andThen(() => this.emitHealthContextChangedAsResult(userId))
      .andThen(() => this.getForUser(userId));
  }

  // ── Current Medicine ──

  createCurrentMedicine(
    userId: string,
    dto: CreateCurrentMedicineDto,
  ): ResultAsync<HealthContextResponseData, DomainFailure> {
    return this.medicineWriteService
      .create(userId, dto)
      .andThen(() => this.emitHealthContextChangedAsResult(userId))
      .andThen(() => this.getForUser(userId));
  }

  updateCurrentMedicine(
    userId: string,
    medicineId: string,
    dto: UpdateCurrentMedicineDto,
  ): ResultAsync<HealthContextResponseData, DomainFailure> {
    return this.medicineWriteService
      .update(userId, medicineId, dto)
      .andThen(() => this.emitHealthContextChangedAsResult(userId))
      .andThen(() => this.getForUser(userId));
  }

  deleteCurrentMedicine(
    userId: string,
    medicineId: string,
  ): ResultAsync<HealthContextResponseData, DomainFailure> {
    return this.medicineWriteService
      .softDelete(userId, medicineId)
      .andThen(() => this.emitHealthContextChangedAsResult(userId))
      .andThen(() => this.getForUser(userId));
  }

  private emitHealthContextChangedAsResult(
    userId: string,
  ): ResultAsync<void, DomainFailure> {
    return fromPromise(this.emitHealthContextChanged(userId), (error) => {
      throw error;
    });
  }

  private async emitHealthContextChanged(userId: string): Promise<void> {
    try {
      await this.eventEmitter.emitAsync(HEALTH_CONTEXT_CHANGED, {
        userId,
      } satisfies HealthContextChangedPayload);
    } catch (error) {
      // Best-effort domain event: cache/suggestion consumers tolerate a
      // dropped event, but the failure must stay observable (structured
      // log) instead of failing the user-facing write.
      this.logger.warn('Failed to emit health-context.changed event', {
        userId,
        error,
      });
    }
  }
}
