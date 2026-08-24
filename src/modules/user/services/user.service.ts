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

  async create(data: Prisma.UserCreateInput): Promise<User> {
    const profileData =
      data.profile === undefined
        ? { create: {} satisfies Prisma.UserProfileCreateWithoutUserInput }
        : data.profile;

    return this.prisma.user.create({
      data: {
        ...data,
        profile: profileData,
      },
    });
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
