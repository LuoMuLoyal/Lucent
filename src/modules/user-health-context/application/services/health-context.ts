import { Injectable, Logger } from '@nestjs/common';
import {
  createDomainFailure,
  errAsync,
  fromPromise,
  okAsync,
  type DomainFailure,
  type ResultAsync,
} from '../../../../common/result/index.js';
import { DomainEventPublisher } from '../../../../common/index.js';
import { UserHealthContextRepositoryPort } from '../ports/health-context-repository.js';
import type { CreateCurrentMedicineDto } from '../ports/create-current-medicine.js';
import type { CreateHealthContextAllergyDto } from '../ports/create-allergy.js';
import type { CreateHealthContextConditionDto } from '../ports/create-condition.js';
import type { HealthContextResponseData } from '../ports/health-context-resource.js';
import type { UpdateCurrentMedicineDto } from '../ports/update-current-medicine.js';
import type { UpdateHealthContextAllergyDto } from '../ports/update-allergy.js';
import type { UpdateHealthContextConditionDto } from '../ports/update-condition.js';
import type { UpdateHealthContextProfileDto } from '../ports/update-profile.js';
import { UserHealthContextMapper } from '../read_models/mapper.js';
import { UpdateProfile } from '../use_cases/update-profile.js';
import { AllergyUseCases } from '../use_cases/allergies.js';
import { ConditionUseCases } from '../use_cases/conditions.js';
import { MedicineUseCases } from '../use_cases/medicines.js';
import {
  HEALTH_CONTEXT_CHANGED,
  type HealthContextChangedPayload,
} from '../../../../common/events/domain-events.js';

@Injectable()
export class UserHealthContextService {
  private readonly logger = new Logger(UserHealthContextService.name);

  constructor(
    private readonly repository: UserHealthContextRepositoryPort,
    private readonly mapperService: UserHealthContextMapper,
    private readonly profileWriteService: UpdateProfile,
    private readonly allergyWriteService: AllergyUseCases,
    private readonly conditionWriteService: ConditionUseCases,
    private readonly medicineWriteService: MedicineUseCases,
    private readonly publisher: DomainEventPublisher,
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
      await this.publisher.publish(HEALTH_CONTEXT_CHANGED, {
        userId,
      } satisfies HealthContextChangedPayload);
    } catch (error) {
      // Best-effort domain event: cache/suggestion consumers tolerate a
      // dropped event, but the failure must stay observable (structured
      // log) instead of failing the user-facing write.
      this.logger.warn('Failed to publish health-context.changed event', {
        userId,
        error,
      });
    }
  }
}
