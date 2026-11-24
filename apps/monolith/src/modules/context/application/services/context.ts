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
import { UserContextRepositoryPort } from '../ports/context-repository.js';
import type { CreateCurrentMedicineDto } from '../ports/create-current-medicine.js';
import type { CreateContextAllergyDto } from '../ports/create-allergy.js';
import type { CreateContextConditionDto } from '../ports/create-condition.js';
import type { ContextResponseData } from '../ports/context-resource.js';
import type { UpdateCurrentMedicineDto } from '../ports/update-current-medicine.js';
import type { UpdateContextAllergyDto } from '../ports/update-allergy.js';
import type { UpdateContextConditionDto } from '../ports/update-condition.js';
import type { UpdateContextProfileDto } from '../ports/update-profile.js';
import { UserContextMapper } from '../read_models/mapper.js';
import { UpdateProfile } from '../use_cases/update-profile.js';
import { AllergyUseCases } from '../use_cases/allergies.js';
import { ConditionUseCases } from '../use_cases/conditions.js';
import { MedicineUseCases } from '../use_cases/medicines.js';
import {
  HEALTH_CONTEXT_CHANGED,
  type ContextChangedPayload,
} from '../../../../common/events/domain-events.js';

@Injectable()
export class UserContextService {
  private readonly logger = new Logger(UserContextService.name);

  constructor(
    private readonly repository: UserContextRepositoryPort,
    private readonly mapperService: UserContextMapper,
    private readonly profileWriteService: UpdateProfile,
    private readonly allergyWriteService: AllergyUseCases,
    private readonly conditionWriteService: ConditionUseCases,
    private readonly medicineWriteService: MedicineUseCases,
    private readonly publisher: DomainEventPublisher,
  ) {}

  getForUser(
    userId: string,
  ): ResultAsync<ContextResponseData, DomainFailure> {
    return fromPromise(
      this.repository.findUserWithContext(userId),
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
    dto: UpdateContextProfileDto,
  ): ResultAsync<ContextResponseData, DomainFailure> {
    return this.profileWriteService
      .upsertProfile(userId, dto)
      .andThen(() => this.emitContextChangedAsResult(userId))
      .andThen(() => this.getForUser(userId));
  }

  // ── Allergy ──

  createAllergy(
    userId: string,
    dto: CreateContextAllergyDto,
  ): ResultAsync<ContextResponseData, DomainFailure> {
    return this.allergyWriteService
      .create(userId, dto)
      .andThen(() => this.emitContextChangedAsResult(userId))
      .andThen(() => this.getForUser(userId));
  }

  updateAllergy(
    userId: string,
    allergyId: string,
    dto: UpdateContextAllergyDto,
  ): ResultAsync<ContextResponseData, DomainFailure> {
    return this.allergyWriteService
      .update(userId, allergyId, dto)
      .andThen(() => this.emitContextChangedAsResult(userId))
      .andThen(() => this.getForUser(userId));
  }

  deleteAllergy(
    userId: string,
    allergyId: string,
  ): ResultAsync<ContextResponseData, DomainFailure> {
    return this.allergyWriteService
      .softDelete(userId, allergyId)
      .andThen(() => this.emitContextChangedAsResult(userId))
      .andThen(() => this.getForUser(userId));
  }

  // ── Condition ──

  createCondition(
    userId: string,
    dto: CreateContextConditionDto,
  ): ResultAsync<ContextResponseData, DomainFailure> {
    return this.conditionWriteService
      .create(userId, dto)
      .andThen(() => this.emitContextChangedAsResult(userId))
      .andThen(() => this.getForUser(userId));
  }

  updateCondition(
    userId: string,
    conditionId: string,
    dto: UpdateContextConditionDto,
  ): ResultAsync<ContextResponseData, DomainFailure> {
    return this.conditionWriteService
      .update(userId, conditionId, dto)
      .andThen(() => this.emitContextChangedAsResult(userId))
      .andThen(() => this.getForUser(userId));
  }

  deleteCondition(
    userId: string,
    conditionId: string,
  ): ResultAsync<ContextResponseData, DomainFailure> {
    return this.conditionWriteService
      .softDelete(userId, conditionId)
      .andThen(() => this.emitContextChangedAsResult(userId))
      .andThen(() => this.getForUser(userId));
  }

  // ── Current Medicine ──

  createCurrentMedicine(
    userId: string,
    dto: CreateCurrentMedicineDto,
  ): ResultAsync<ContextResponseData, DomainFailure> {
    return this.medicineWriteService
      .create(userId, dto)
      .andThen(() => this.emitContextChangedAsResult(userId))
      .andThen(() => this.getForUser(userId));
  }

  updateCurrentMedicine(
    userId: string,
    medicineId: string,
    dto: UpdateCurrentMedicineDto,
  ): ResultAsync<ContextResponseData, DomainFailure> {
    return this.medicineWriteService
      .update(userId, medicineId, dto)
      .andThen(() => this.emitContextChangedAsResult(userId))
      .andThen(() => this.getForUser(userId));
  }

  deleteCurrentMedicine(
    userId: string,
    medicineId: string,
  ): ResultAsync<ContextResponseData, DomainFailure> {
    return this.medicineWriteService
      .softDelete(userId, medicineId)
      .andThen(() => this.emitContextChangedAsResult(userId))
      .andThen(() => this.getForUser(userId));
  }

  private emitContextChangedAsResult(
    userId: string,
  ): ResultAsync<void, DomainFailure> {
    return fromPromise(this.emitContextChanged(userId), (error) => {
      throw error;
    });
  }

  private async emitContextChanged(userId: string): Promise<void> {
    try {
      await this.publisher.publish(HEALTH_CONTEXT_CHANGED, {
        userId,
      } satisfies ContextChangedPayload);
    } catch (error) {
      // Best-effort domain event: cache/suggestion consumers tolerate a
      // dropped event, but the failure must stay observable (structured
      // log) instead of failing the user-facing write.
      this.logger.warn(
        { userId, error },
        'Failed to publish context.changed event',
      );
    }
  }
}
