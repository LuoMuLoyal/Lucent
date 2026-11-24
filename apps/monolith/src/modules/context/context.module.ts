import { Module } from '@nestjs/common';

import { ContextController } from './adapters/http/context.controller.js';
import { PublishedContextEvents } from './adapters/events/context-changed.js';
import { UserContextService } from './application/services/context.js';
import { ContextEvents } from './application/ports/context-events.js';
import { IUserContextReader } from './application/ports/context-reader.js';
import { UserContextMapper } from './application/read_models/mapper.js';
import { AllergyUseCases } from './application/use_cases/allergies.js';
import { ConditionUseCases } from './application/use_cases/conditions.js';
import { MedicineUseCases } from './application/use_cases/medicines.js';
import { UpdateProfile } from './application/use_cases/update-profile.js';
import { UserContextOwnership } from './application/use_cases/ownership.js';
import { UserContextRepositoryPort } from './application/ports/context-repository.js';
import { PrismaUserContext } from './infrastructure/persistence/context.js';

/**
 * User Profile context — health profile, allergies, conditions, current medicines
 * (ADR-0024).
 *
 * `IUserContextReader` is the published read port: `assistant` and the
 * `suggestion` profile collector inject it by that token. It stays exported
 * from the barrel under its historical name.
 */
@Module({
  controllers: [ContextController],
  providers: [
    PrismaUserContext,
    {
      provide: UserContextRepositoryPort,
      useExisting: PrismaUserContext,
    },
    PublishedContextEvents,
    {
      provide: ContextEvents,
      useExisting: PublishedContextEvents,
    },
    UserContextOwnership,
    UserContextMapper,
    UpdateProfile,
    AllergyUseCases,
    ConditionUseCases,
    MedicineUseCases,
    UserContextService,
    {
      provide: IUserContextReader,
      useExisting: UserContextService,
    },
  ],
  exports: [UserContextService, IUserContextReader],
})
export class ContextModule {}
