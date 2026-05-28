import type { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';

import { UserService } from './user.service';
import { PrismaService } from '../prisma/prisma.service';

const mockUser = {
  id: 'user-uuid-1',
  email: 'test@example.com',
  password: '$argon2id$mock',
  nickname: 'TestUser',
  avatar: null,
  emailVerified: false,
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
              findUnique: jest.fn(),
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
      (prismaService.user.findUnique as jest.Mock).mockResolvedValue(mockUser);

      const result = await service.findById('user-uuid-1');

      expect(prismaService.user.findUnique).toHaveBeenCalledWith({
        where: { id: 'user-uuid-1' },
      });
      expect(result).toEqual(mockUser);
    });

    it('should return null if user not found', async () => {
      (prismaService.user.findUnique as jest.Mock).mockResolvedValue(null);

      const result = await service.findById('non-existent');

      expect(result).toBeNull();
    });
  });

  describe('findByEmail', () => {
    it('should return a user by email', async () => {
      (prismaService.user.findUnique as jest.Mock).mockResolvedValue(mockUser);

      const result = await service.findByEmail('test@example.com');

      expect(prismaService.user.findUnique).toHaveBeenCalledWith({
        where: { email: 'test@example.com' },
      });
      expect(result).toEqual(mockUser);
    });

    it('should return null if email not found', async () => {
      (prismaService.user.findUnique as jest.Mock).mockResolvedValue(null);

      const result = await service.findByEmail('unknown@example.com');

      expect(result).toBeNull();
    });
  });

  describe('create', () => {
    it('should create a user with given data', async () => {
      (prismaService.user.create as jest.Mock).mockResolvedValue(mockUser);

      const result = await service.create({
        email: 'test@example.com',
        password: '$argon2id$mock',
        nickname: 'TestUser',
      });

      expect(prismaService.user.create).toHaveBeenCalledWith({
        data: {
          email: 'test@example.com',
          password: '$argon2id$mock',
          nickname: 'TestUser',
        },
      });
      expect(result).toEqual(mockUser);
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
    it('should update user by email', async () => {
      const updatedUser = { ...mockUser, emailVerified: true };
      (prismaService.user.update as jest.Mock).mockResolvedValue(updatedUser);

      const result = await service.updateByEmail('test@example.com', {
        emailVerified: true,
      });

      expect(prismaService.user.update).toHaveBeenCalledWith({
        where: { email: 'test@example.com' },
        data: { emailVerified: true },
      });
      expect(result.emailVerified).toBe(true);
    });
  });
});
