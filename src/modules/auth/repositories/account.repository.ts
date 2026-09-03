/**
 * Repository abstraction for user account data access during auth flows.
 *
 * Decouples AuthAccountService from direct PrismaService usage.
 */
import { Injectable } from '@nestjs/common';
import { UserStatus } from '#generated/prisma/client.js';
import { fromPrismaResult } from '../../../common/index.js';
import { PrismaService } from '../../../prisma/index.js';
import type {
  DomainFailure,
  ResultAsync,
} from '../../../common/result/index.js';

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
