import type { DeepMocked } from '../../../common/types/deep-mocked';
import { Prisma } from '#generated/prisma/client';
import { nonDeleted } from '../../../common';
import type { DomainFailure, ResultAsync } from '../../../common/result';
async function inspectResult<T>(
  result: ResultAsync<T, DomainFailure>,
): Promise<{ ok: true; value: T } | { ok: false; error: DomainFailure }> {
  return result.match(
    (value) => ({ ok: true as const, value }),
    (error) => ({ ok: false as const, error }),
  );
}
import type { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';
import { UserStatus } from '#generated/prisma/client';

import { UserService } from './user.service';
import { PrismaService } from '../../../prisma';

const mockUser = {
  id: 'user-uuid-1',
  email: 'test@example.com',
  nickname: 'TestUser',
  avatar: null,
  status: UserStatus.active,
  emailVerifiedAt: null,
  lastLoginAt: null,
  ...nonDeleted,
  createdAt: new Date('2026-01-01T00:00:00Z'),
  updatedAt: new Date('2026-01-01T00:00:00Z'),
};

describe('UserService', () => {
  let service: UserService;
  let prismaService: DeepMocked<PrismaService>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UserService,
        {
          provide: PrismaService,
          useValue: {
            user: {
              findFirst: vi.fn(),
              create: vi.fn(),
              update: vi.fn(),
            },
            nonDeleted: {
              user: {
                findFirst: vi.fn(),
                findFirstOrThrow: vi.fn(),
              },
            },
          },
        },
      ],
    }).compile();

    service = module.get(UserService);
    prismaService = module.get(PrismaService);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('findById', () => {
    it('should return a user by id', async () => {
      (prismaService.nonDeleted.user.findFirst as vi.Mock).mockResolvedValue(
        mockUser,
      );

      const result = await service.findById('user-uuid-1');

      expect(prismaService.nonDeleted.user.findFirst).toHaveBeenCalledWith({
        where: { id: 'user-uuid-1' },
      });
      expect(result).toEqual(mockUser);
    });

    it('should return null if user not found', async () => {
      (prismaService.nonDeleted.user.findFirst as vi.Mock).mockResolvedValue(
        null,
      );

      const result = await service.findById('non-existent');

      expect(result).toBeNull();
    });
  });

  describe('findByEmail', () => {
    it('should return a user by email', async () => {
      (prismaService.nonDeleted.user.findFirst as vi.Mock).mockResolvedValue(
        mockUser,
      );

      const result = await service.findByEmail('test@example.com');

      expect(prismaService.nonDeleted.user.findFirst).toHaveBeenCalledWith({
        where: { email: 'test@example.com' },
      });
      expect(result).toEqual(mockUser);
    });

    it('should return null if email not found', async () => {
      (prismaService.nonDeleted.user.findFirst as vi.Mock).mockResolvedValue(
        null,
      );

      const result = await service.findByEmail('unknown@example.com');

      expect(result).toBeNull();
    });
  });

  describe('create', () => {
    it('should create a user and backfill an empty profile when one is not provided', async () => {
      (prismaService.user.create as vi.Mock).mockResolvedValue(mockUser);

      const result = await inspectResult(
        service.create({
          email: 'test@example.com',
          nickname: 'TestUser',
        }),
      );

      expect(prismaService.user.create).toHaveBeenCalledWith({
        data: {
          email: 'test@example.com',
          nickname: 'TestUser',
          profile: { create: {} },
        },
      });
      expect(result).toMatchObject({ ok: true, value: mockUser });
    });

    it('should preserve an explicitly provided profile relation', async () => {
      (prismaService.user.create as vi.Mock).mockResolvedValue(mockUser);

      await inspectResult(
        service.create({
          email: 'test@example.com',
          profile: {
            create: {
              locale: 'zh-CN',
            },
          },
        }),
      );

      expect(prismaService.user.create).toHaveBeenCalledWith({
        data: {
          email: 'test@example.com',
          profile: {
            create: {
              locale: 'zh-CN',
            },
          },
        },
      });
    });

    it('should map a P2002 unique constraint violation to RESOURCE_CONFLICT', async () => {
      const error = Object.create(
        Prisma.PrismaClientKnownRequestError.prototype,
      );
      error.code = 'P2002';
      (prismaService.user.create as vi.Mock).mockRejectedValue(error);

      const result = await inspectResult(
        service.create({ email: 'duplicate@example.com' }),
      );

      expect(result).toMatchObject({
        ok: false,
        error: { kind: 'conflict', code: 'RESOURCE_CONFLICT' },
      });
    });
  });

  describe('update', () => {
    it('should update user by id', async () => {
      const updatedUser = { ...mockUser, nickname: 'UpdatedName' };
      (prismaService.user.update as vi.Mock).mockResolvedValue(updatedUser);

      const result = await inspectResult(
        service.update('user-uuid-1', {
          nickname: 'UpdatedName',
        }),
      );

      expect(prismaService.user.update).toHaveBeenCalledWith({
        where: { id: 'user-uuid-1' },
        data: { nickname: 'UpdatedName' },
      });
      expect(result).toMatchObject({ ok: true, value: updatedUser });
    });

    it('should map a missing user to RESOURCE_NOT_FOUND', async () => {
      const error = Object.create(
        Prisma.PrismaClientKnownRequestError.prototype,
      );
      error.code = 'P2025';
      (prismaService.user.update as vi.Mock).mockRejectedValue(error);

      const result = await inspectResult(
        service.update('missing-user', { nickname: 'X' }),
      );

      expect(result).toMatchObject({
        ok: false,
        error: { kind: 'not_found', code: 'RESOURCE_NOT_FOUND' },
      });
    });

    it('should map a unique constraint violation to RESOURCE_CONFLICT', async () => {
      const error = Object.create(
        Prisma.PrismaClientKnownRequestError.prototype,
      );
      error.code = 'P2002';
      (prismaService.user.update as vi.Mock).mockRejectedValue(error);

      const result = await inspectResult(
        service.update('user-uuid-1', { email: 'taken@example.com' }),
      );

      expect(result).toMatchObject({
        ok: false,
        error: { kind: 'conflict', code: 'RESOURCE_CONFLICT' },
      });
    });

    it('should rethrow an unknown database error', async () => {
      const error = new Error('connection lost');
      (prismaService.user.update as vi.Mock).mockRejectedValue(error);

      await expect(
        service.update('user-uuid-1', { nickname: 'X' }).match(
          () => undefined,
          () => undefined,
        ),
      ).rejects.toBe(error);
    });
  });

  describe('updateByEmail', () => {
    it('should find the active user first, then update by id', async () => {
      const updatedUser = {
        ...mockUser,
        emailVerifiedAt: new Date('2026-01-02T00:00:00Z'),
      };
      (prismaService.nonDeleted.user.findFirst as vi.Mock).mockResolvedValue(
        mockUser,
      );
      (prismaService.user.update as vi.Mock).mockResolvedValue(updatedUser);

      const result = await service.updateByEmail('test@example.com', {
        emailVerifiedAt: updatedUser.emailVerifiedAt,
      });

      expect(prismaService.nonDeleted.user.findFirst).toHaveBeenCalledWith({
        where: { email: 'test@example.com' },
      });
      expect(prismaService.user.update).toHaveBeenCalledWith({
        where: { id: 'user-uuid-1' },
        data: { emailVerifiedAt: updatedUser.emailVerifiedAt },
      });
      expect(result?.emailVerifiedAt).toEqual(updatedUser.emailVerifiedAt);
    });

    it('should return null when no active user matches the email', async () => {
      (prismaService.nonDeleted.user.findFirst as vi.Mock).mockResolvedValue(
        null,
      );

      const result = await service.updateByEmail('missing@example.com', {
        emailVerifiedAt: new Date(),
      });

      expect(prismaService.user.update).not.toHaveBeenCalled();
      expect(result).toBeNull();
    });
  });
});
