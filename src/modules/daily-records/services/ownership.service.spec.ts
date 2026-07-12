import { Test } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { I18nService } from 'nestjs-i18n';
import { DailyRecordRepositoryPort } from '../repositories/daily-record.repository';
import { DailyRecordsOwnershipService } from './ownership.service';

describe('DailyRecordsOwnershipService', () => {
  let service: DailyRecordsOwnershipService;
  let findOwnershipData: vi.Mock;
  let i18nT: vi.Mock;

  beforeEach(async () => {
    findOwnershipData = vi.fn();
    i18nT = vi.fn().mockReturnValue('Record not found');

    const module = await Test.createTestingModule({
      providers: [
        DailyRecordsOwnershipService,
        {
          provide: DailyRecordRepositoryPort,
          useValue: { findOwnershipData },
        },
        { provide: I18nService, useValue: { t: i18nT } },
      ],
    }).compile();

    service = module.get(DailyRecordsOwnershipService);
  });

  describe('ensureOwnedByUser', () => {
    it('returns snapshot when record belongs to user', async () => {
      findOwnershipData.mockResolvedValue({
        userId: 'u1',
        kind: 'note',
        payload: { key: 'val' },
      });

      const result = await service.ensureOwnedByUser('u1', 'r1');

      expect(result).toEqual({ kind: 'note', payload: { key: 'val' } });
      expect(findOwnershipData).toHaveBeenCalledWith('r1');
    });

    it('throws NotFoundException when record not found', async () => {
      findOwnershipData.mockResolvedValue(null);
      await expect(service.ensureOwnedByUser('u1', 'r1')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('throws NotFoundException when record belongs to different user', async () => {
      findOwnershipData.mockResolvedValue({
        userId: 'u2',
        kind: 'note',
        payload: null,
      });
      await expect(service.ensureOwnedByUser('u1', 'r1')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('throwRecordNotFound', () => {
    it('throws NotFoundException with i18n message', () => {
      expect(() => service.throwRecordNotFound()).toThrow(NotFoundException);
      expect(i18nT).toHaveBeenCalledWith('daily-records.record_not_found');
    });
  });
});
