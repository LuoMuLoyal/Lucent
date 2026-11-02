/**
 * Prisma implementation of `UserRepositoryPort`
 * (`application/ports/users.ts`).
 *
 * This is the module's only Prisma touchpoint. The queries are the ones the old
 * `services/user.service.ts` and `services/admin.service.ts` issued inline —
 * moved, not rewritten, so behaviour (the `nonDeleted` scope, the P2002 mapping,
 * the `UserStatus.deleted` + `deletedAt` pair) is unchanged.
 */

import { Injectable } from '@nestjs/common';
import { UserStatus } from '#generated/prisma/client.js';
import type { Prisma, User } from '#generated/prisma/client.js';
import { PrismaService } from '../../../../prisma/index.js';
import { fromPrismaResult } from '../../../../common/index.js';
import type {
  DomainFailure,
  ResultAsync,
} from '../../../../common/result/index.js';
import type {
  UserRepositoryPort,
  UserStatusSnapshot,
} from '../../application/ports/users.js';

@Injectable()
export class PrismaUsers implements UserRepositoryPort {
  constructor(private readonly prisma: PrismaService) {}

  findById(id: string): Promise<User | null> {
    return this.prisma.nonDeleted.user.findFirst({ where: { id } });
  }

  findByEmail(email: string): Promise<User | null> {
    return this.prisma.nonDeleted.user.findFirst({ where: { email } });
  }

  create(data: Prisma.UserCreateInput): ResultAsync<User, DomainFailure> {
    const profileData =
      data.profile === undefined
        ? { create: {} satisfies Prisma.UserProfileCreateWithoutUserInput }
        : data.profile;

    return fromPrismaResult(
      this.prisma.user.create({
        data: {
          ...data,
          profile: profileData,
        },
      }),
    );
  }

  update(
    id: string,
    data: Prisma.UserUpdateInput,
  ): ResultAsync<User, DomainFailure> {
    return fromPrismaResult(this.prisma.user.update({ where: { id }, data }));
  }

  async updateByEmail(
    email: string,
    data: Prisma.UserUpdateInput,
  ): Promise<User | null> {
    const user = await this.findByEmail(email);
    if (!user) {
      return null;
    }
    return this.prisma.user.update({ where: { id: user.id }, data });
  }

  async findStatus(userId: string): Promise<UserStatusSnapshot | null> {
    return this.prisma.user.findFirst({
      where: { id: userId, status: { not: UserStatus.deleted } },
      select: { status: true },
    });
  }

  async setStatus(
    userId: string,
    status: UserStatus,
  ): Promise<UserStatusSnapshot> {
    return this.prisma.user.update({
      where: { id: userId },
      data: { status },
      select: { status: true },
    });
  }

  async softDelete(userId: string, at: Date): Promise<void> {
    await this.prisma.user.update({
      where: { id: userId },
      data: { status: UserStatus.deleted, deletedAt: at },
    });
  }
}
