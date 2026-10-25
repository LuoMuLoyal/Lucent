import { Injectable } from '@nestjs/common';
import { Prisma } from '#generated/prisma/client.js';
import { PrismaService } from '../../../../prisma/index.js';
import { fromPrismaResult, nonDeleted } from '../../../../common/index.js';
import type {
  DomainFailure,
  ResultAsync,
} from '../../../../common/result/index.js';
import { userHealthContextInclude } from '../../domain/health-context/health-context.types.js';
import { UserHealthContextRepositoryPort } from '../../application/ports/health-context-repository.js';

/**
 * Prisma implementation of `UserHealthContextRepositoryPort`.
 *
 * Stays split from the port file so `application/**` never imports Prisma
 * (D5): the port declares the shape, this class only maps.
 */
@Injectable()
export class PrismaUserHealthContext extends UserHealthContextRepositoryPort {
  constructor(private readonly prisma: PrismaService) {
    super();
  }

  override findUserWithHealthContext(userId: string) {
    return this.prisma.user.findFirst({
      where: { id: userId, ...nonDeleted },
      include: userHealthContextInclude,
    });
  }

  override findProfileByUserId(
    userId: string,
    select: { onboardingCompletedAt: boolean },
  ) {
    return this.prisma.userProfile.findUnique({ where: { userId }, select });
  }

  override upsertProfile(
    where: { userId: string },
    create: Prisma.UserProfileUncheckedCreateInput,
    update: Prisma.UserProfileUpdateInput,
  ): ResultAsync<void, DomainFailure> {
    return fromPrismaResult(
      this.prisma.userProfile.upsert({ where, create, update }),
    ).map(() => undefined);
  }

  override createAllergy(
    data: Prisma.UserAllergyUncheckedCreateInput,
  ): ResultAsync<void, DomainFailure> {
    return fromPrismaResult(this.prisma.userAllergy.create({ data })).map(
      () => undefined,
    );
  }

  override updateAllergy(
    id: string,
    data: Prisma.UserAllergyUpdateInput,
  ): ResultAsync<void, DomainFailure> {
    return fromPrismaResult(
      this.prisma.userAllergy.update({ where: { id }, data }),
    ).map(() => undefined);
  }

  override softDeleteAllergy(id: string): ResultAsync<void, DomainFailure> {
    return fromPrismaResult(
      this.prisma.userAllergy.update({
        where: { id },
        data: { isActive: false },
      }),
    ).map(() => undefined);
  }

  override findAllergyById(id: string) {
    return this.prisma.userAllergy.findFirst({
      where: { id },
      select: { userId: true },
    });
  }

  override createCondition(
    data: Prisma.UserConditionCreateInput,
  ): ResultAsync<void, DomainFailure> {
    return fromPrismaResult(this.prisma.userCondition.create({ data })).map(
      () => undefined,
    );
  }

  override updateCondition(
    id: string,
    data: Prisma.UserConditionUpdateInput,
  ): ResultAsync<void, DomainFailure> {
    return fromPrismaResult(
      this.prisma.userCondition.update({ where: { id }, data }),
    ).map(() => undefined);
  }

  override softDeleteCondition(
    id: string,
    resolvedAt: Date,
  ): ResultAsync<void, DomainFailure> {
    return fromPrismaResult(
      this.prisma.userCondition.update({
        where: { id },
        data: { status: 'resolved', resolvedAt },
      }),
    ).map(() => undefined);
  }

  override findConditionById(id: string) {
    return this.prisma.userCondition.findFirst({
      where: { id },
      select: { userId: true },
    });
  }

  override createCurrentMedicine(
    data: Prisma.UserCurrentMedicineUncheckedCreateInput,
  ): ResultAsync<void, DomainFailure> {
    return fromPrismaResult(
      this.prisma.userCurrentMedicine.create({ data }),
    ).map(() => undefined);
  }

  override updateCurrentMedicine(
    id: string,
    data: Prisma.UserCurrentMedicineUpdateInput,
  ): ResultAsync<void, DomainFailure> {
    return fromPrismaResult(
      this.prisma.userCurrentMedicine.update({ where: { id }, data }),
    ).map(() => undefined);
  }

  override softDeleteCurrentMedicine(
    id: string,
    endedAt: Date,
  ): ResultAsync<void, DomainFailure> {
    return fromPrismaResult(
      (async () => {
        const current = await this.prisma.userCurrentMedicine.findUnique({
          where: { id },
          select: { endedAt: true },
        });
        return this.prisma.userCurrentMedicine.update({
          where: { id },
          data: { isCurrent: false, endedAt: current?.endedAt ?? endedAt },
        });
      })(),
    ).map(() => undefined);
  }

  override findCurrentMedicineById(id: string) {
    return this.prisma.userCurrentMedicine.findFirst({
      where: { id },
      select: { userId: true, endedAt: true },
    });
  }

  override findActiveUserById(userId: string) {
    return this.prisma.user.findFirst({
      where: { id: userId, ...nonDeleted },
      select: { id: true },
    });
  }
}
