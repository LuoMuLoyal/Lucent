import { Test } from '@nestjs/testing';
import type { DailyRecordKind } from '#generated/prisma/client';
import type { DailyRecordShape } from '../types';
import { DailyRecordsMapperService } from './mapper.service';

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

    it('replaces only mealInput and keeps server-owned mealAnalysis', () => {
      const result = service.toRecordUpdateData(
        {
          payload: {
            mealInput: {
              manualSummary: 'updated by user',
            },
            mealAnalysis: {
              analysisStatus: 'analysis_failed',
            },
          },
        },
        {
          kind: 'meal' as DailyRecordKind,
          payload: {
            mealInput: {
              manualSummary: 'old text',
            },
            mealAnalysis: {
              analysisStatus: 'confirmed',
              mealDescription: 'trusted result',
            },
          },
        },
      );

      expect(result.payload).toEqual({
        mealInput: {
          manualSummary: 'updated by user',
        },
        mealAnalysis: {
          analysisStatus: 'confirmed',
          mealDescription: 'trusted result',
        },
      });
    });
  });

  describe('toAttachmentCreateManyData', () => {
    it('maps attachments with defaults', () => {
      const result = service.toAttachmentCreateManyData('u1', 'r1', [
        { objectKey: 'img/abc.jpg' },
      ]);
      expect(result[0]?.userId).toBe('u1');
      expect(result[0]?.recordId).toBe('r1');
      expect(result[0]?.objectKey).toBe('img/abc.jpg');
    });

    it('maps multiple attachments', () => {
      const result = service.toAttachmentCreateManyData('u1', 'r1', [
        { objectKey: 'img/a.jpg' },
        { objectKey: 'img/b.jpg' },
        { objectKey: 'img/c.jpg' },
      ]);
      expect(result).toHaveLength(3);
      expect(result[1]?.objectKey).toBe('img/b.jpg');
    });

    it('returns empty array for empty input', () => {
      const result = service.toAttachmentCreateManyData('u1', 'r1', []);
      expect(result).toEqual([]);
    });

    it('trims objectKey', () => {
      const result = service.toAttachmentCreateManyData('u1', 'r1', [
        { objectKey: '  img/abc.jpg  ' },
      ]);
      expect(result[0]?.objectKey).toBe('img/abc.jpg');
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
      } as unknown as DailyRecordShape);
      expect(item.id).toBe('r1');
      expect(item.occurredAt).toBe('2026-06-15');
      expect(item.occurredTime).toBe('14:30');
    });

    it('keeps full meal payload for detail reads when requested', () => {
      const payload = {
        mealInput: { manualSummary: 'rice' },
        mealAnalysis: { analysisStatus: 'confirmed' },
      };
      const item = service.toItem(
        {
          id: 'meal-1',
          kind: 'meal' as DailyRecordKind,
          occurredAt: new Date('2026-07-01'),
          occurredTime: '12:10',
          title: 'Lunch',
          value: null,
          unit: null,
          note: null,
          source: null,
          payload,
          attachments: [],
          createdAt: new Date(),
          updatedAt: new Date(),
        } as unknown as DailyRecordShape,
        { includeMealPayload: true },
      );

      expect(item.payload).toEqual(payload);
    });
  });

  describe('toSummaries', () => {
    it('groups records by kind and returns counts', () => {
      const base = {
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
      } as unknown as DailyRecordShape;
      const records: DailyRecordShape[] = [
        { ...base, id: 'r1', kind: 'note' },
        { ...base, id: 'r2', kind: 'note' },
        { ...base, id: 'r3', kind: 'water' },
      ];
      const result = service.toSummaries(records);
      expect(result.summaries).toHaveLength(2);

      const noteSummary = result.summaries.find((s) => s.kind === 'note');
      expect(noteSummary).toBeDefined();
      if (!noteSummary) throw new Error('note summary not found');
      expect(noteSummary.count).toBe(2);
    });

    it('returns empty summaries for empty records', () => {
      const result = service.toSummaries([]);
      expect(result.summaries).toEqual([]);
    });

    it('returns single summary when all records are same kind', () => {
      const base = {
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
      } as unknown as DailyRecordShape;
      const records: DailyRecordShape[] = [
        { ...base, id: 'r1', kind: 'water' },
        { ...base, id: 'r2', kind: 'water' },
        { ...base, id: 'r3', kind: 'water' },
      ];
      const result = service.toSummaries(records);
      expect(result.summaries).toHaveLength(1);
      expect(result.summaries[0]?.count).toBe(3);
    });
  });
});
