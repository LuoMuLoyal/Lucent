/* eslint-disable @typescript-eslint/no-non-null-assertion, @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-member-access */
import { Test } from '@nestjs/testing';
import type { DailyRecordKind } from '../../../generated/prisma/client';
import { DailyRecordsMapperService } from './daily-records-mapper.service';

describe('DailyRecordsMapperService', () => {
  let service: DailyRecordsMapperService;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [DailyRecordsMapperService],
    }).compile();
    service = module.get(DailyRecordsMapperService);
  });

  describe('toRecordUpdateData', () => {
    it('maps kind and occurredAt', () => {
      const result = service.toRecordUpdateData({
        kind: 'sleep',
        occurredAt: '2026-06-15',
      });
      expect(result.kind).toBe('sleep');
      expect(result.occurredAt).toBeInstanceOf(Date);
    });
  });

  describe('toAttachmentCreateManyData', () => {
    it('maps attachments with defaults', () => {
      const result = service.toAttachmentCreateManyData('u1', 'r1', [
        { objectKey: 'img/abc.jpg' },
      ]);
      expect(result[0]!.userId).toBe('u1');
      expect(result[0]!.recordId).toBe('r1');
      expect(result[0]!.objectKey).toBe('img/abc.jpg');
    });
  });

  describe('toItem', () => {
    it('formats a basic record with dates', () => {
      const item = service.toItem({
        id: 'r1',
        kind: 'note' as DailyRecordKind,
        occurredAt: new Date('2026-06-15'),
        occurredTime: '14:30',
        title: 'Test',
        value: null,
        unit: null,
        note: null,
        source: null,
        payload: null,
        attachments: [],
        createdAt: new Date(),
        updatedAt: new Date(),
      } as any);
      expect(item.id).toBe('r1');
      expect(item.occurredAt).toBe('2026-06-15');
      expect(item.occurredTime).toBe('14:30');
    });
  });

  describe('toSummaries', () => {
    it('groups records by kind and returns counts', () => {
      const base: any = {
        occurredAt: new Date(),
        occurredTime: null,
        title: null,
        value: null,
        unit: null,
        note: null,
        source: null,
        payload: null,
        attachments: [],
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      const records: any[] = [
        { ...base, id: 'r1', kind: 'note' as DailyRecordKind },
        { ...base, id: 'r2', kind: 'note' as DailyRecordKind },
        { ...base, id: 'r3', kind: 'water' as DailyRecordKind },
      ];
      const result = service.toSummaries(records);
      expect(result.summaries).toHaveLength(2);

      const noteSummary = result.summaries.find((s: any) => s.kind === 'note');
      expect(noteSummary).toBeDefined();
      expect(noteSummary!.count).toBe(2);
    });
  });
});
