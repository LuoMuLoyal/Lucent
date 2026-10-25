import { Module } from '@nestjs/common';

import { UserHealthContextController } from './adapters/http/user-health-context.controller.js';
import { PublishedHealthContextEvents } from './adapters/events/health-context-changed.js';
import { UserHealthContextService } from './application/services/health-context.js';
import { HealthContextEvents } from './application/ports/health-context-events.js';
import { IUserHealthContextReader } from './application/ports/health-context-reader.js';
import { UserHealthContextMapper } from './application/read_models/mapper.js';
import { AllergyUseCases } from './application/use_cases/allergies.js';
import { ConditionUseCases } from './application/use_cases/conditions.js';
import { MedicineUseCases } from './application/use_cases/medicines.js';
import { UpdateProfile } from './application/use_cases/update-profile.js';
import { UserHealthContextOwnership } from './application/use_cases/ownership.js';
import { UserHealthContextRepositoryPort } from './application/ports/health-context-repository.js';
import { PrismaUserHealthContext } from './infrastructure/persistence/health-context.js';

/**
 * User Profile context — health profile, allergies, conditions, current medicines
 * (ADR-0024).
 *
 * `IUserHealthContextReader` is the published read port: `assistant` and the
 * `today-suggestion` profile collector inject it by that token. It stays exported
 * from the barrel under its historical name.
 */
@Module({
  controllers: [UserHealthContextController],
  providers: [
    PrismaUserHealthContext,
    {
      provide: UserHealthContextRepositoryPort,
      useExisting: PrismaUserHealthContext,
    },
    PublishedHealthContextEvents,
    {
      provide: HealthContextEvents,
      useExisting: PublishedHealthContextEvents,
    },
    UserHealthContextOwnership,
    UserHealthContextMapper,
    UpdateProfile,
    AllergyUseCases,
    ConditionUseCases,
    MedicineUseCases,
    UserHealthContextService,
    {
      provide: IUserHealthContextReader,
      useExisting: UserHealthContextService,
    },
  ],
  exports: [UserHealthContextService, IUserHealthContextReader],
})
export class UserHealthContextModule {}
