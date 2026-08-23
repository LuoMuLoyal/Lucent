/**
 * Repository abstraction for user account data access during auth flows.
 *
 * Decouples AuthAccountService from direct PrismaService usage.
 */
import { Injectable } from '@nestjs/common';
import { UserStatus } from '#generated/prisma/client';
import { fromPrismaResult } from '../../../common';
import { PrismaService } from '../../../prisma';
import type { DomainFailure, ResultAsync } from '../../../common/result';

export abstract class AuthAccountRepositoryPort {
  abstract softDeleteUser(
    userId: string,
    deletedAt: Date,
  ): ResultAsync<void, DomainFailure>;
}

@Injectable()
export class AuthAccountRepository implements AuthAccountRepositoryPort {
  constructor(private readonly prisma: PrismaService) {}

  softDeleteUser(
    userId: string,
    deletedAt: Date,
  ): ResultAsync<void, DomainFailure> {
    return fromPrismaResult(
      this.prisma.user
        .update({
          where: { id: userId },
          data: { deletedAt, status: UserStatus.deleted },
        })
        .then(() => undefined),
    );
  }
}
