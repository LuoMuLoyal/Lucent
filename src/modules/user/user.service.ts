import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { Prisma, User, UserIdentity } from '../../generated/prisma/client';

export interface UserIdentityInput {
  provider: string;
  providerUserId: string;
  providerUnionId?: string | null;
  email?: string | null;
  emailVerifiedAt?: Date | null;
  rawProfile?: Prisma.InputJsonValue;
}

export interface CreateOAuthUserInput {
  email?: string | null;
  nickname?: string | null;
  avatar?: string | null;
  emailVerifiedAt?: Date | null;
  identity: UserIdentityInput;
}

@Injectable()
export class UserService {
  constructor(private readonly prisma: PrismaService) {}

  async findById(id: string): Promise<User | null> {
    return this.prisma.user.findFirst({ where: { id, deletedAt: null } });
  }

  async findByEmail(email: string): Promise<User | null> {
    return this.prisma.user.findFirst({ where: { email, deletedAt: null } });
  }

  async findByIdentity(
    provider: string,
    providerUserId: string,
  ): Promise<User | null> {
    const identity = await this.prisma.userIdentity.findUnique({
      where: { provider_providerUserId: { provider, providerUserId } },
      include: { user: true },
    });

    if (!identity || identity.user.deletedAt !== null) {
      return null;
    }

    return identity.user;
  }

  async findByProviderUnionId(providerUnionId: string): Promise<User | null> {
    const identity = await this.prisma.userIdentity.findFirst({
      where: { providerUnionId },
      include: { user: true },
      orderBy: { createdAt: 'asc' },
    });

    if (!identity || identity.user.deletedAt !== null) {
      return null;
    }

    return identity.user;
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

  async createOAuthUser(data: CreateOAuthUserInput): Promise<User> {
    return this.prisma.user.create({
      data: {
        ...(data.email !== undefined && { email: data.email }),
        passwordHash: null,
        ...(data.nickname !== undefined && { nickname: data.nickname }),
        ...(data.avatar !== undefined && { avatar: data.avatar }),
        ...(data.emailVerifiedAt !== undefined && {
          emailVerifiedAt: data.emailVerifiedAt,
        }),
        profile: { create: {} },
        identities: {
          create: this.toIdentityCreateData(data.identity),
        },
      },
    });
  }

  async linkIdentity(
    userId: string,
    data: UserIdentityInput,
  ): Promise<UserIdentity> {
    return this.prisma.userIdentity.create({
      data: {
        ...this.toIdentityCreateData(data),
        user: { connect: { id: userId } },
      },
    });
  }

  async update(id: string, data: Prisma.UserUpdateInput): Promise<User> {
    return this.prisma.user.update({ where: { id }, data });
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

  private toIdentityCreateData(
    data: UserIdentityInput,
  ): Prisma.UserIdentityCreateWithoutUserInput {
    return {
      provider: data.provider,
      providerUserId: data.providerUserId,
      ...(data.providerUnionId !== undefined && {
        providerUnionId: data.providerUnionId,
      }),
      ...(data.email !== undefined && { email: data.email }),
      ...(data.emailVerifiedAt !== undefined && {
        emailVerifiedAt: data.emailVerifiedAt,
      }),
      ...(data.rawProfile !== undefined && { rawProfile: data.rawProfile }),
    };
  }
}
