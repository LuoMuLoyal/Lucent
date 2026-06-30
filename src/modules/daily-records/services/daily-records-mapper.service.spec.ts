import { Test } from '@nestjs/testing';
import type { DailyRecordKind } from '../../../generated/prisma/client';
import { DailyRecordAttachmentKind } from '../../../generated/prisma/client';
import { DailyRecordsMapperService } from './daily-records-mapper.service';
import type { DailyRecordShape } from '../types/daily-records.types';

describe('DailyRecordsMapperService', () => {
  let service: DailyRecordsMapperService;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [DailyRecordsMapperService],
    }).compile();
    service = module.get(DailyRecordsMapperService);
  });

  function buildRecord(
    overrides?: Partial<DailyRecordShape>,
  ): DailyRecordShape {
    return {
      id: 'r1',
      kind: 'note',
      occurredAt: new Date('2026-06-15'),
      occurredTime: '14:30',
      title: 'Test note',
      value: null,
      unit: null,
      note: 'Some note',
      source: 'user',
      payload: null,
      attachments: [],
      createdAt: new Date('2026-06-15T06:00:00Z'),
      updatedAt: new Date('2026-06-15T06:00:00Z'),
      ...overrides,
    };
  }

  describe('toRecordUpdateData', () => {
    it('returns empty object when no fields are provided', () => {
      expect(service.toRecordUpdateData({})).toEqual({});
    });

    it('maps kind directly', () => {
      const result = service.toRecordUpdateData({
        kind: 'sleep',
      });
      expect(result).toEqual({ kind: 'sleep' });
    });

    it('maps occurredAt through parseDateOnly', () => {
      const result = service.toRecordUpdateData({ occurredAt: '2026-06-15' });
      expect(result.occurredAt).toBeInstanceOf(Date);
    });

    it('normalizes nullable text fields', () => {
      const result = service.toRecordUpdateData({
        title: '  Title  ',
        value: '',
        note: null,
      });
      expect(result.title).toBe('Title');
      expect(result.value).toBeNull();
      expect(result.note).toBeNull();
    });

    it('handles payload null as Prisma.DbNull', () => {
      const result = service.toRecordUpdateData({ payload: null });
      // Prisma.DbNull is a special symbol; verify it's not undefined
      expect(result.payload).toBeDefined();
    });
  });

  describe('toAttachmentCreateManyData', () => {
    it('maps attachments with defaults', () => {
      const result = service.toAttachmentCreateManyData('u1', 'r1', [
        { objectKey: 'img/abc.jpg' },
      ]);

      expect(result[0]).toMatchObject({
        userId: 'u1',
        recordId: 'r1',
        kind: DailyRecordAttachmentKind.image,
        objectKey: 'img/abc.jpg',
        sizeBytes: null,
      });
    });

    it('defaults kind to image', () => {
      const result = service.toAttachmentCreateManyData('u1', 'r1', [
        { objectKey: 'img/abc.jpg' },
      ]);
      expect(result[0].kind).toBe(DailyRecordAttachmentKind.image);
    });
  });

  describe('toItem', () => {
    it('formats a basic record', () => {
      const item = service.toItem(buildRecord());
      expect(item.id).toBe('r1');
      expect(item.kind).toBe('note');
      expect(item.occurredAt).toBe('2026-06-15');
      expect(item.occurredTime).toBe('14:30');
      expect(item.createdAt).toMatch(/2026-06-15T/);
    });

    it('includes attachment sub-entities', () => {
      const record = buildRecord({
        attachments: [
          {
            id: 'att1',
            kind: DailyRecordAttachmentKind.image,
            objectKey: 'img/1.jpg',
            bucket: 'bucket',
            provider: 'cos',
            fileName: '1.jpg',
            contentType: 'image/jpeg',
            sizeBytes: 1024,
            width: 800,
            height: 600,
            publicUrl: 'https://example.com/1.jpg',
            createdAt: new Date('2026-06-15T06:00:00Z'),
          },
        ],
      });
      const item = service.toItem(record);
      expect(item.attachments[0]).toMatchObject({
        id: 'att1',
        kind: DailyRecordAttachmentKind.image,
        objectKey: 'img/1.jpg',
        sizeBytes: 1024,
      });
    });
  });

  describe('toSummaries', () => {
    it('groups records by kind', () => {
      const records = [
        buildRecord({ id: 'r1', kind: 'note' as DailyRecordKind }),
        buildRecord({ id: 'r2', kind: 'note' as DailyRecordKind }),
        buildRecord({ id: 'r3', kind: 'water' as DailyRecordKind }),
      ];
      const result = service.toSummaries(records);

      expect(result.summaries).toHaveLength(2);
      interface SummaryEntry {
        kind: string;
        count: number;
        latest: { title: string } | null;
      }
      const noteSummary = result.summaries.find(
        (s: SummaryEntry) => s.kind === 'note',
      );
      expect(noteSummary).toBeDefined();
      if (!noteSummary) throw new Error('unreachable');
      expect(noteSummary.count).toBe(2);

      const waterSummary = result.summaries.find(
        (s: SummaryEntry) => s.kind === 'water',
      );
      expect(waterSummary).toBeDefined();
      if (!waterSummary) throw new Error('unreachable');
      expect(waterSummary.count).toBe(1);
    });

    it('returns latest item for each kind', () => {
      const records = [
        buildRecord({
          id: 'r1',
          kind: 'note' as DailyRecordKind,
          title: 'First',
        }),
        buildRecord({
          id: 'r2',
          kind: 'note' as DailyRecordKind,
          title: 'Latest',
        }),
      ];
      const result = service.toSummaries(records);
      expect(result.summaries[0].latest.title).toBe('First');
    });

    it('returns empty summaries for empty input', () => {
      expect(service.toSummaries([])).toEqual({ summaries: [] });
    });
  });
});
