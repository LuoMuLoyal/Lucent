import type { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';
import { UserStatus } from '../generated/prisma/client';

import { UserService } from './user.service';
import { PrismaService } from '../prisma/prisma.service';

const mockUser = {
  id: 'user-uuid-1',
  email: 'test@example.com',
  passwordHash: '$argon2id$mock',
  nickname: 'TestUser',
  avatar: null,
  status: UserStatus.active,
  emailVerifiedAt: null,
  lastLoginAt: null,
  deletedAt: null,
  createdAt: new Date('2026-01-01T00:00:00Z'),
  updatedAt: new Date('2026-01-01T00:00:00Z'),
};

describe('UserService', () => {
  let service: UserService;
  let prismaService: jest.Mocked<PrismaService>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UserService,
        {
          provide: PrismaService,
          useValue: {
            user: {
              findFirst: jest.fn(),
              create: jest.fn(),
              update: jest.fn(),
            },
          },
        },
      ],
    }).compile();

    service = module.get(UserService);
    prismaService = module.get(PrismaService);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('findById', () => {
    it('should return a user by id', async () => {
      (prismaService.user.findFirst as jest.Mock).mockResolvedValue(mockUser);

      const result = await service.findById('user-uuid-1');

      expect(prismaService.user.findFirst).toHaveBeenCalledWith({
        where: { id: 'user-uuid-1', deletedAt: null },
      });
      expect(result).toEqual(mockUser);
    });

    it('should return null if user not found', async () => {
      (prismaService.user.findFirst as jest.Mock).mockResolvedValue(null);

      const result = await service.findById('non-existent');

      expect(result).toBeNull();
    });
  });

  describe('findByEmail', () => {
    it('should return a user by email', async () => {
      (prismaService.user.findFirst as jest.Mock).mockResolvedValue(mockUser);

      const result = await service.findByEmail('test@example.com');

      expect(prismaService.user.findFirst).toHaveBeenCalledWith({
        where: { email: 'test@example.com', deletedAt: null },
      });
      expect(result).toEqual(mockUser);
    });

    it('should return null if email not found', async () => {
      (prismaService.user.findFirst as jest.Mock).mockResolvedValue(null);

      const result = await service.findByEmail('unknown@example.com');

      expect(result).toBeNull();
    });
  });

  describe('create', () => {
    it('should create a user and backfill an empty profile when one is not provided', async () => {
      (prismaService.user.create as jest.Mock).mockResolvedValue(mockUser);

      const result = await service.create({
        email: 'test@example.com',
        passwordHash: '$argon2id$mock',
        nickname: 'TestUser',
      });

      expect(prismaService.user.create).toHaveBeenCalledWith({
        data: {
          email: 'test@example.com',
          passwordHash: '$argon2id$mock',
          nickname: 'TestUser',
          profile: { create: {} },
        },
      });
      expect(result).toEqual(mockUser);
    });

    it('should preserve an explicitly provided profile relation', async () => {
      (prismaService.user.create as jest.Mock).mockResolvedValue(mockUser);

      await service.create({
        email: 'test@example.com',
        passwordHash: '$argon2id$mock',
        profile: {
          create: {
            locale: 'zh-CN',
          },
        },
      });

      expect(prismaService.user.create).toHaveBeenCalledWith({
        data: {
          email: 'test@example.com',
          passwordHash: '$argon2id$mock',
          profile: {
            create: {
              locale: 'zh-CN',
            },
          },
        },
      });
    });
  });

  describe('update', () => {
    it('should update user by id', async () => {
      const updatedUser = { ...mockUser, nickname: 'UpdatedName' };
      (prismaService.user.update as jest.Mock).mockResolvedValue(updatedUser);

      const result = await service.update('user-uuid-1', {
        nickname: 'UpdatedName',
      });

      expect(prismaService.user.update).toHaveBeenCalledWith({
        where: { id: 'user-uuid-1' },
        data: { nickname: 'UpdatedName' },
      });
      expect(result.nickname).toBe('UpdatedName');
    });
  });

  describe('updateByEmail', () => {
    it('should find the active user first, then update by id', async () => {
      const updatedUser = {
        ...mockUser,
        emailVerifiedAt: new Date('2026-01-02T00:00:00Z'),
      };
      (prismaService.user.findFirst as jest.Mock).mockResolvedValue(mockUser);
      (prismaService.user.update as jest.Mock).mockResolvedValue(updatedUser);

      const result = await service.updateByEmail('test@example.com', {
        emailVerifiedAt: updatedUser.emailVerifiedAt,
      });

      expect(prismaService.user.findFirst).toHaveBeenCalledWith({
        where: { email: 'test@example.com', deletedAt: null },
      });
      expect(prismaService.user.update).toHaveBeenCalledWith({
        where: { id: 'user-uuid-1' },
        data: { emailVerifiedAt: updatedUser.emailVerifiedAt },
      });
      expect(result?.emailVerifiedAt).toEqual(updatedUser.emailVerifiedAt);
    });

    it('should return null when no active user matches the email', async () => {
      (prismaService.user.findFirst as jest.Mock).mockResolvedValue(null);

      const result = await service.updateByEmail('missing@example.com', {
        emailVerifiedAt: new Date(),
      });

      expect(prismaService.user.update).not.toHaveBeenCalled();
      expect(result).toBeNull();
    });
  });
});
