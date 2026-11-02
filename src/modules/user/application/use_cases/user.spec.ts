/**
 * `UserService` use-case tests.
 *
 * The use case is a thin delegating surface: it names the module's public write
 * vocabulary and nothing else. What these tests pin is therefore **the delegation
 * contract** — which port method each operation calls, with which arguments, and
 * that nothing is invented in between.
 *
 * The Prisma-specific behaviour (the `nonDeleted` scope, the P2002 → conflict
 * mapping, the `deleted`+`deletedAt` pair) moved into `PrismaUsers` together with
 * the queries, and is covered by `infrastructure/persistence/users.spec.ts`.
 */
import { Test } from '@nestjs/testing';
import { okAsync } from '../../../../common/result/index.js';
import { UserStatus } from '#generated/prisma/client.js';
import { UserService } from './user.js';
import { USER_REPOSITORY, type UserRepositoryPort } from '../ports/users.js';

const mockUser = {
  id: 'user-uuid-1',
  email: 'test@example.com',
  nickname: 'TestUser',
  avatar: null,
  status: UserStatus.active,
};

describe('UserService', () => {
  let service: UserService;
  let repository: {
    findById: ReturnType<typeof vi.fn>;
    findByEmail: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    updateByEmail: ReturnType<typeof vi.fn>;
  };

  beforeEach(async () => {
    repository = {
      findById: vi.fn(),
      findByEmail: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      updateByEmail: vi.fn(),
    };
    const module = await Test.createTestingModule({
      providers: [
        UserService,
        {
          provide: USER_REPOSITORY,
          useValue: repository as unknown as UserRepositoryPort,
        },
      ],
    }).compile();

    service = module.get(UserService);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('findById', () => {
    it('delegates to the repository with the bare id', async () => {
      repository.findById.mockResolvedValue(mockUser);

      const result = await service.findById('user-uuid-1');

      expect(repository.findById).toHaveBeenCalledWith('user-uuid-1');
      expect(result).toEqual(mockUser);
    });

    it('returns null when the user does not exist', async () => {
      repository.findById.mockResolvedValue(null);

      await expect(service.findById('non-existent')).resolves.toBeNull();
    });
  });

  describe('findByEmail', () => {
    it('delegates to the repository with the bare email', async () => {
      repository.findByEmail.mockResolvedValue(mockUser);

      const result = await service.findByEmail('test@example.com');

      expect(repository.findByEmail).toHaveBeenCalledWith('test@example.com');
      expect(result).toEqual(mockUser);
    });

    it('returns null when the email is unknown', async () => {
      repository.findByEmail.mockResolvedValue(null);

      await expect(
        service.findByEmail('unknown@example.com'),
      ).resolves.toBeNull();
    });
  });

  describe('create', () => {
    it('passes the caller data through unchanged', async () => {
      repository.create.mockReturnValue(okAsync(mockUser));

      await service.create({
        email: 'test@example.com',
        nickname: 'TestUser',
      });

      expect(repository.create).toHaveBeenCalledWith({
        email: 'test@example.com',
        nickname: 'TestUser',
      });
    });
  });

  describe('update', () => {
    it('delegates id and patch', async () => {
      repository.update.mockReturnValue(okAsync(mockUser));

      await service.update('user-uuid-1', { nickname: 'Renamed' });

      expect(repository.update).toHaveBeenCalledWith('user-uuid-1', {
        nickname: 'Renamed',
      });
    });
  });

  describe('updateByEmail', () => {
    it('delegates email and patch', async () => {
      repository.updateByEmail.mockResolvedValue(mockUser);

      await service.updateByEmail('test@example.com', { nickname: 'Renamed' });

      expect(repository.updateByEmail).toHaveBeenCalledWith(
        'test@example.com',
        {
          nickname: 'Renamed',
        },
      );
    });

    it('returns null when the email is unknown', async () => {
      repository.updateByEmail.mockResolvedValue(null);

      await expect(
        service.updateByEmail('missing@example.com', { nickname: 'x' }),
      ).resolves.toBeNull();
    });
  });
});
