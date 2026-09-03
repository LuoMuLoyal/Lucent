import { Test, type TestingModule } from '@nestjs/testing';
import { UserHealthContextController } from './user-health-context.controller.js';
import { UserHealthContextService } from './services/health-context.service.js';
import type { UserPayload } from '../auth/index.js';
import { DomainFailureException } from '../../common/result/unwrap-result.js';
import { okAsync, errAsync } from '../../common/result/index.js';
import type { DomainFailure } from '../../common/result/index.js';

describe('UserHealthContextController', () => {
  let controller: UserHealthContextController;
  let service: vi.Mocked<UserHealthContextService>;

  const mockUser: UserPayload = {
    sub: 'user-1',
    email: 'test@example.com',
    status: 'active',
  };
  const mockResponse = {
    profile: null,
    allergies: [],
    conditions: [],
    currentMedicines: [],
  };

  const notFoundFailure: DomainFailure = {
    _tag: 'DomainFailure',
    kind: 'not_found',
    code: 'RESOURCE_NOT_FOUND',
  };
  const forbiddenFailure: DomainFailure = {
    _tag: 'DomainFailure',
    kind: 'authorization',
    code: 'FORBIDDEN',
  };

  beforeEach(async () => {
    service = {
      getForUser: vi.fn().mockReturnValue(okAsync(mockResponse)),
      updateProfile: vi.fn().mockReturnValue(okAsync(mockResponse)),
      createAllergy: vi.fn().mockReturnValue(okAsync(mockResponse)),
      updateAllergy: vi.fn().mockReturnValue(okAsync(mockResponse)),
      deleteAllergy: vi.fn().mockReturnValue(okAsync(mockResponse)),
      createCondition: vi.fn().mockReturnValue(okAsync(mockResponse)),
      updateCondition: vi.fn().mockReturnValue(okAsync(mockResponse)),
      deleteCondition: vi.fn().mockReturnValue(okAsync(mockResponse)),
      createCurrentMedicine: vi.fn().mockReturnValue(okAsync(mockResponse)),
      updateCurrentMedicine: vi.fn().mockReturnValue(okAsync(mockResponse)),
      deleteCurrentMedicine: vi.fn().mockReturnValue(okAsync(mockResponse)),
    } as unknown as vi.Mocked<UserHealthContextService>;

    const module: TestingModule = await Test.createTestingModule({
      controllers: [UserHealthContextController],
      providers: [{ provide: UserHealthContextService, useValue: service }],
    }).compile();

    controller = module.get(UserHealthContextController);
  });

  const expectResource = (result: unknown) => {
    expect(result).toEqual(mockResponse);
  };

  describe('GET /', () => {
    it('returns health context for user', async () => {
      const result = await controller.getUserHealthContext(mockUser);
      expect(service.getForUser).toHaveBeenCalledWith('user-1');
      expectResource(result);
    });

    it('throws DomainFailureException with RESOURCE_NOT_FOUND when user missing', async () => {
      service.getForUser.mockReturnValue(errAsync(notFoundFailure));

      await expect(
        controller.getUserHealthContext(mockUser),
      ).rejects.toMatchObject({
        failure: { kind: 'not_found', code: 'RESOURCE_NOT_FOUND' },
      });
    });
  });

  describe('PATCH /profile', () => {
    it('updates profile and returns health context', async () => {
      const dto = { birthDate: '2000-01-01' };
      const result = await controller.updateUserHealthContextProfile(
        mockUser,
        dto,
      );
      expect(service.updateProfile).toHaveBeenCalledWith('user-1', dto);
      expectResource(result);
    });

    it('throws DomainFailureException when the user is missing', async () => {
      service.updateProfile.mockReturnValue(errAsync(notFoundFailure));

      await expect(
        controller.updateUserHealthContextProfile(mockUser, {}),
      ).rejects.toBeInstanceOf(DomainFailureException);
    });
  });

  // ── Allergy endpoints ──

  describe('POST /allergies', () => {
    it('creates allergy and returns health context', async () => {
      const dto = {
        label: '青霉素',
        reaction: '皮疹',
        severity: 'moderate',
      } as never;
      const result = await controller.createAllergy(mockUser, dto);
      expect(service.createAllergy).toHaveBeenCalledWith('user-1', dto);
      expectResource(result);
    });
  });

  describe('PATCH /allergies/:id', () => {
    it('updates allergy and returns health context', async () => {
      const dto = { severity: 'severe' } as never;
      const result = await controller.updateAllergy(mockUser, 'allergy-1', dto);
      expect(service.updateAllergy).toHaveBeenCalledWith(
        'user-1',
        'allergy-1',
        dto,
      );
      expectResource(result);
    });

    it('throws DomainFailureException with FORBIDDEN for a foreign allergy', async () => {
      service.updateAllergy.mockReturnValue(errAsync(forbiddenFailure));

      await expect(
        controller.updateAllergy(mockUser, 'allergy-1', {}),
      ).rejects.toMatchObject({
        failure: { kind: 'authorization', code: 'FORBIDDEN' },
      });
    });
  });

  describe('DELETE /allergies/:id', () => {
    it('deletes allergy and returns health context', async () => {
      const result = await controller.deleteAllergy(mockUser, 'allergy-1');
      expect(service.deleteAllergy).toHaveBeenCalledWith('user-1', 'allergy-1');
      expectResource(result);
    });

    it('throws DomainFailureException with RESOURCE_NOT_FOUND for a missing allergy', async () => {
      service.deleteAllergy.mockReturnValue(errAsync(notFoundFailure));

      await expect(
        controller.deleteAllergy(mockUser, 'allergy-1'),
      ).rejects.toMatchObject({
        failure: { kind: 'not_found', code: 'RESOURCE_NOT_FOUND' },
      });
    });
  });

  // ── Condition endpoints ──

  describe('POST /conditions', () => {
    it('creates condition and returns health context', async () => {
      const dto = { label: '高血压', status: 'active' } as never;
      const result = await controller.createCondition(mockUser, dto);
      expect(service.createCondition).toHaveBeenCalledWith('user-1', dto);
      expectResource(result);
    });
  });

  describe('PATCH /conditions/:id', () => {
    it('updates condition and returns health context', async () => {
      const dto = { status: 'resolved' } as never;
      const result = await controller.updateCondition(mockUser, 'cond-1', dto);
      expect(service.updateCondition).toHaveBeenCalledWith(
        'user-1',
        'cond-1',
        dto,
      );
      expectResource(result);
    });

    it('throws DomainFailureException with FORBIDDEN for a foreign condition', async () => {
      service.updateCondition.mockReturnValue(errAsync(forbiddenFailure));

      await expect(
        controller.updateCondition(mockUser, 'cond-1', {}),
      ).rejects.toMatchObject({
        failure: { kind: 'authorization', code: 'FORBIDDEN' },
      });
    });
  });

  describe('DELETE /conditions/:id', () => {
    it('deletes condition and returns health context', async () => {
      const result = await controller.deleteCondition(mockUser, 'cond-1');
      expect(service.deleteCondition).toHaveBeenCalledWith('user-1', 'cond-1');
      expectResource(result);
    });
  });

  // ── Current medicine endpoints ──

  describe('POST /current-medicines', () => {
    it('creates current medicine and returns health context', async () => {
      const dto = { displayName: '氨氯地平片', doseText: '5mg' } as never;
      const result = await controller.createCurrentMedicine(mockUser, dto);
      expect(service.createCurrentMedicine).toHaveBeenCalledWith('user-1', dto);
      expectResource(result);
    });
  });

  describe('PATCH /current-medicines/:id', () => {
    it('updates current medicine and returns health context', async () => {
      const dto = { doseText: '10mg' };
      const result = await controller.updateCurrentMedicine(
        mockUser,
        'med-1',
        dto,
      );
      expect(service.updateCurrentMedicine).toHaveBeenCalledWith(
        'user-1',
        'med-1',
        dto,
      );
      expectResource(result);
    });

    it('throws DomainFailureException with FORBIDDEN for a foreign medicine', async () => {
      service.updateCurrentMedicine.mockReturnValue(errAsync(forbiddenFailure));

      await expect(
        controller.updateCurrentMedicine(mockUser, 'med-1', {}),
      ).rejects.toMatchObject({
        failure: { kind: 'authorization', code: 'FORBIDDEN' },
      });
    });
  });

  describe('DELETE /current-medicines/:id', () => {
    it('deletes current medicine and returns health context', async () => {
      const result = await controller.deleteCurrentMedicine(mockUser, 'med-1');
      expect(service.deleteCurrentMedicine).toHaveBeenCalledWith(
        'user-1',
        'med-1',
      );
      expectResource(result);
    });
  });
});
