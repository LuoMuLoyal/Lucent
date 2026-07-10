/**
 * Repository abstraction for user account data access during auth flows.
 *
 * Decouples AuthAccountService from direct PrismaService usage.
 */
import { Injectable } from '@nestjs/common';
import { UserStatus } from '#generated/prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';

export abstract class AuthAccountRepositoryPort {
  abstract softDeleteUser(userId: string, deletedAt: Date): Promise<void>;
}

@Injectable()
export class AuthAccountRepository implements AuthAccountRepositoryPort {
  constructor(private readonly prisma: PrismaService) {}

  async softDeleteUser(userId: string, deletedAt: Date): Promise<void> {
    await this.prisma.user.update({
      where: { id: userId },
      data: { deletedAt, status: UserStatus.deleted },
    });
  }
}
