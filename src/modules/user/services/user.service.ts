import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../prisma';
import { Prisma, User } from '#generated/prisma/client';
import { fromPrismaResult } from '../../../common';
import type { DomainFailure, ResultAsync } from '../../../common/result';

@Injectable()
export class UserService {
  constructor(private readonly prisma: PrismaService) {}

  async findById(id: string): Promise<User | null> {
    return this.prisma.nonDeleted.user.findFirst({ where: { id } });
  }

  async findByEmail(email: string): Promise<User | null> {
    return this.prisma.nonDeleted.user.findFirst({ where: { email } });
  }

  /**
   * Creates a user, mapping P2002 unique-constraint violations to
   * `RESOURCE_CONFLICT` so concurrent same-email registrations receive a
   * proper domain failure instead of an unhandled 500.
   */
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
}
