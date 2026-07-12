import { Test, type TestingModule } from '@nestjs/testing';
import { ResultCode } from '../../common/api';
import { UserHealthContextController } from './user-health-context.controller';
import { UserHealthContextService } from './services';
import type { UserPayload } from '../auth/services/auth.service';

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

  beforeEach(async () => {
    service = {
      getForUser: vi.fn().mockResolvedValue(mockResponse),
      updateProfile: vi.fn().mockResolvedValue(mockResponse),
      createAllergy: vi.fn().mockResolvedValue(mockResponse),
      updateAllergy: vi.fn().mockResolvedValue(mockResponse),
      deleteAllergy: vi.fn().mockResolvedValue(mockResponse),
      createCondition: vi.fn().mockResolvedValue(mockResponse),
      updateCondition: vi.fn().mockResolvedValue(mockResponse),
      deleteCondition: vi.fn().mockResolvedValue(mockResponse),
      createCurrentMedicine: vi.fn().mockResolvedValue(mockResponse),
      updateCurrentMedicine: vi.fn().mockResolvedValue(mockResponse),
      deleteCurrentMedicine: vi.fn().mockResolvedValue(mockResponse),
    } as unknown as vi.Mocked<UserHealthContextService>;

    const module: TestingModule = await Test.createTestingModule({
      controllers: [UserHealthContextController],
      providers: [{ provide: UserHealthContextService, useValue: service }],
    }).compile();

    controller = module.get(UserHealthContextController);
  });

  const expectEnvelope = (result: unknown) => {
    expect(result).toEqual({
      code: ResultCode.SUCCESS,
      message: '',
      data: mockResponse,
    });
  };

  describe('GET /', () => {
    it('returns health context for user', async () => {
      const result = await controller.getUserHealthContext(mockUser);
      expect(service.getForUser).toHaveBeenCalledWith('user-1');
      expectEnvelope(result);
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
      expectEnvelope(result);
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
      expectEnvelope(result);
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
      expectEnvelope(result);
    });
  });

  describe('DELETE /allergies/:id', () => {
    it('deletes allergy and returns health context', async () => {
      const result = await controller.deleteAllergy(mockUser, 'allergy-1');
      expect(service.deleteAllergy).toHaveBeenCalledWith('user-1', 'allergy-1');
      expectEnvelope(result);
    });
  });

  // ── Condition endpoints ──

  describe('POST /conditions', () => {
    it('creates condition and returns health context', async () => {
      const dto = { label: '高血压', status: 'active' } as never;
      const result = await controller.createCondition(mockUser, dto);
      expect(service.createCondition).toHaveBeenCalledWith('user-1', dto);
      expectEnvelope(result);
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
      expectEnvelope(result);
    });
  });

  describe('DELETE /conditions/:id', () => {
    it('deletes condition and returns health context', async () => {
      const result = await controller.deleteCondition(mockUser, 'cond-1');
      expect(service.deleteCondition).toHaveBeenCalledWith('user-1', 'cond-1');
      expectEnvelope(result);
    });
  });

  // ── Current medicine endpoints ──

  describe('POST /current-medicines', () => {
    it('creates current medicine and returns health context', async () => {
      const dto = { displayName: '氨氯地平片', doseText: '5mg' } as never;
      const result = await controller.createCurrentMedicine(mockUser, dto);
      expect(service.createCurrentMedicine).toHaveBeenCalledWith('user-1', dto);
      expectEnvelope(result);
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
      expectEnvelope(result);
    });
  });

  describe('DELETE /current-medicines/:id', () => {
    it('deletes current medicine and returns health context', async () => {
      const result = await controller.deleteCurrentMedicine(mockUser, 'med-1');
      expect(service.deleteCurrentMedicine).toHaveBeenCalledWith(
        'user-1',
        'med-1',
      );
      expectEnvelope(result);
    });
  });
});
