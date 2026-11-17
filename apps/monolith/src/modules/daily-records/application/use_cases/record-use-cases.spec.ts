import { Test, type TestingModule } from '@nestjs/testing';
import { DailyRecords } from '../../domain/record/records.js';
import type { RecordRow } from '../../domain/record/record-row.js';
import { DomainFailureException } from '../../../../common/result/unwrap-result.js';
import { CreateRecord } from './create-record.js';
import { DeleteRecord } from './delete-record.js';
import { UpdateRecord } from './update-record.js';
import { HealthEventLink } from '../services/health-event-link.js';
import { RecordOwnership } from '../services/record-ownership.js';
import { RecordWriteEffects } from '../services/record-write-effects.js';
import { HealthEventOwnership } from '../ports/health-events.js';
import { MealAnalysisJobs } from '../ports/meal-analysis-jobs.js';
import { RecordChangeEvents } from '../ports/record-change-events.js';

const userId = 'user-1';

function recordRow(overrides: Partial<RecordRow> = {}): RecordRow {
  return {
    id: 'rec-1',
    userId,
    healthEventId: null,
    kind: 'water',
    occurredAt: new Date('2026-07-01T00:00:00.000Z'),
    occurredTime: '08:00',
    title: null,
    value: '250',
    unit: 'ml',
    note: null,
    payload: null,
    source: 'manual',
    mealAnalysisStatus: null,
    mealAnalysisUpdatedAt: null,
    mealAnalysisFailureReason: null,
    mealHeadline: null,
    mealCalorieMin: null,
    mealCalorieMax: null,
    mealCalorieBucket: null,
    mealSourceRevision: 0,
    deletedAt: null,
    createdAt: new Date('2026-07-01T08:00:00.000Z'),
    updatedAt: new Date('2026-07-01T08:00:00.000Z'),
    attachments: [],
    ...overrides,
  };
}

const analyzedMealAnalysis = {
  version: 2,
  analysisStatus: 'analyzed',
  analyzedAt: '2026-07-01T12:30:00.000Z',
  sourceRevision: 2,
  model: 'vision-model',
  promptVersion: 'meal-analysis.v2',
  locale: 'zh-CN',
  failureReason: null,
  calorieRange: { min: 520, max: 780, unit: 'kcal', bucket: 'medium' },
  dishes: [{ name: '红烧肉', source: 'model' }],
  items: [
    {
      rank: 1,
      kind: 'fried',
      polarity: 'watch',
      headline: '油炸偏多',
      detail: '午饭油炸食品摄入偏多',
    },
  ],
  facets: { fried: 'high' },
};

function mealRow(overrides: Partial<RecordRow> = {}): RecordRow {
  return recordRow({
    kind: 'meal',
    value: null,
    unit: null,
    payload: { mealAnalysis: analyzedMealAnalysis },
    mealAnalysisStatus: 'analyzed',
    mealAnalysisUpdatedAt: new Date('2026-07-01T12:30:00.000Z'),
    mealHeadline: '油炸偏多',
    mealCalorieMin: 520,
    mealCalorieMax: 780,
    mealCalorieBucket: 'medium',
    mealSourceRevision: 2,
    ...overrides,
  });
}

/** 一个只记录调用的内存端口（用例测试只要「调了什么」）。 */
function memoryRecords(row: RecordRow | null = recordRow()) {
  const current = { row };
  const port = {
    listPage: vi.fn(),
    listByDay: vi.fn(),
    findById: vi.fn(() => Promise.resolve(current.row)),
    findOwnership: vi.fn(() =>
      Promise.resolve(
        current.row == null
          ? null
          : {
              userId: current.row.userId,
              kind: current.row.kind,
              payload: current.row.payload,
              occurredAt: current.row.occurredAt,
            },
      ),
    ),
    insert: vi.fn(() => Promise.resolve(current.row as RecordRow)),
    update: vi.fn(() => Promise.resolve(current.row as RecordRow)),
    replaceAttachments: vi.fn(() => Promise.resolve(undefined)),
    softDelete: vi.fn(() => Promise.resolve(true)),
    // 事务端口在这里退化成「直接执行回调」：用例测试不验证事务语义，
    // 只验证「事务内做了哪些写」。
    transaction: vi.fn(async <T>(fn: (tx: DailyRecords) => Promise<T>) =>
      fn(port as unknown as DailyRecords),
    ),
    setRow: (next: RecordRow | null) => {
      current.row = next;
    },
    current,
  };
  return port;
}

describe('record write use cases', () => {
  let records: ReturnType<typeof memoryRecords>;
  let jobs: { enqueue: ReturnType<typeof vi.fn> };
  let events: { publish: ReturnType<typeof vi.fn> };
  let healthEvents: { ensureActive: ReturnType<typeof vi.fn> };
  let testingModule: TestingModule;

  beforeEach(async () => {
    records = memoryRecords();
    jobs = { enqueue: vi.fn(() => Promise.resolve(undefined)) };
    events = { publish: vi.fn(() => Promise.resolve(undefined)) };
    healthEvents = { ensureActive: vi.fn(() => Promise.resolve(undefined)) };

    testingModule = await Test.createTestingModule({
      providers: [
        { provide: DailyRecords, useValue: records },
        { provide: MealAnalysisJobs, useValue: jobs },
        { provide: RecordChangeEvents, useValue: events },
        { provide: HealthEventOwnership, useValue: healthEvents },
        RecordOwnership,
        HealthEventLink,
        RecordWriteEffects,
        CreateRecord,
        UpdateRecord,
        DeleteRecord,
      ],
    }).compile();
  });

  describe('CreateRecord', () => {
    it('writes the record and invalidates the day', async () => {
      const result = await testingModule
        .get(CreateRecord)
        .execute(userId, { kind: 'water', occurredAt: '2026-07-01' });

      expect(result.isOk()).toBe(true);
      expect(records.insert).toHaveBeenCalledTimes(1);
      expect(events.publish).toHaveBeenCalledWith({
        userId,
        date: '2026-07-01',
        kind: 'water',
        recordId: 'rec-1',
      });
    });

    it('rejects an invalid sleep payload before touching storage', async () => {
      const result = await testingModule.get(CreateRecord).execute(userId, {
        kind: 'sleep',
        occurredAt: '2026-07-01',
        payload: { durationMinutes: 0 },
      });

      expect(result.isErr()).toBe(true);
      expect(records.insert).not.toHaveBeenCalled();
    });

    it('enqueues the analysis when a meal record gets exactly one image', async () => {
      records.setRow(
        mealRow({
          payload: {
            mealAnalysis: {
              ...analyzedMealAnalysis,
              analysisStatus: 'analyzing',
            },
          },
          mealSourceRevision: 3,
          attachments: [
            {
              id: 'att-1',
              kind: 'image',
              objectKey: 'daily-records/u1/m.jpg',
              bucket: null,
              provider: null,
              fileName: null,
              contentType: null,
              sizeBytes: null,
              width: null,
              height: null,
              publicUrl: null,
              createdAt: new Date('2026-07-01T09:00:00.000Z'),
            },
          ],
        }),
      );

      await testingModule.get(CreateRecord).execute(userId, {
        kind: 'meal',
        occurredAt: '2026-07-01',
        attachments: [{ objectKey: 'daily-records/u1/m.jpg' }],
      });

      expect(jobs.enqueue).toHaveBeenCalledWith(
        expect.objectContaining({ userId, recordId: 'rec-1' }),
      );
    });

    it('propagates a health-event ownership failure as a domain failure', async () => {
      healthEvents.ensureActive.mockRejectedValueOnce(
        new DomainFailureException({
          _tag: 'DomainFailure',
          kind: 'not_found',
          code: 'RESOURCE_NOT_FOUND',
        }),
      );

      const result = await testingModule.get(CreateRecord).execute(userId, {
        kind: 'water',
        occurredAt: '2026-07-01',
        healthEventId: 'event-1',
      });

      expect(result.isErr()).toBe(true);
      expect(records.insert).not.toHaveBeenCalled();
    });
  });

  describe('UpdateRecord', () => {
    it("returns RESOURCE_NOT_FOUND for another user's record", async () => {
      records.setRow(recordRow({ userId: 'someone-else' }));

      const result = await testingModule
        .get(UpdateRecord)
        .execute(userId, 'rec-1', { title: 'x' });

      expect(result.isErr()).toBe(true);
      expect(records.update).not.toHaveBeenCalled();
    });

    it('rejects a half-filled sleep interval', async () => {
      records.setRow(
        recordRow({ kind: 'sleep', payload: { durationMinutes: 480 } }),
      );

      const result = await testingModule
        .get(UpdateRecord)
        .execute(userId, 'rec-1', {
          payload: {
            durationMinutes: 480,
            startedAt: '2026-07-01T23:00:00.000Z',
          },
        });

      expect(result.isErr()).toBe(true);
      expect(records.update).not.toHaveBeenCalled();
    });

    it('replaces attachments and enqueues the bumped revision in one transaction', async () => {
      records.setRow(
        mealRow({
          payload: {
            mealAnalysis: { ...analyzedMealAnalysis, sourceRevision: 3 },
          },
          mealSourceRevision: 3,
          attachments: [
            {
              id: 'att-2',
              kind: 'image',
              objectKey: 'daily-records/u1/new.jpg',
              bucket: null,
              provider: null,
              fileName: null,
              contentType: null,
              sizeBytes: null,
              width: null,
              height: null,
              publicUrl: null,
              createdAt: new Date('2026-07-01T09:00:00.000Z'),
            },
          ],
        }),
      );

      const result = await testingModule
        .get(UpdateRecord)
        .execute(userId, 'rec-1', {
          attachments: [{ objectKey: 'daily-records/u1/new.jpg' }],
        });

      expect(result.isOk()).toBe(true);
      expect(records.transaction).toHaveBeenCalledTimes(1);
      expect(records.replaceAttachments).toHaveBeenCalledTimes(1);
      expect(jobs.enqueue).toHaveBeenCalledWith(
        expect.objectContaining({ userId, recordId: 'rec-1' }),
      );
    });

    it('invalidates both the previous and the new day when the record moves', async () => {
      await testingModule
        .get(UpdateRecord)
        .execute(userId, 'rec-1', { occurredAt: '2026-07-02' });

      const dates = events.publish.mock.calls.map(
        (call) => (call[0] as { date: string }).date,
      );
      expect(new Set(dates)).toEqual(new Set(['2026-07-01', '2026-07-02']));
    });
  });

  describe('DeleteRecord', () => {
    it('soft deletes and invalidates the record day', async () => {
      const result = await testingModule
        .get(DeleteRecord)
        .execute(userId, 'rec-1');

      expect(result.isOk()).toBe(true);
      expect(records.softDelete).toHaveBeenCalledWith(
        'rec-1',
        expect.any(Date),
      );
      expect(events.publish).toHaveBeenCalledWith(
        expect.objectContaining({ date: '2026-07-01' }),
      );
    });

    it('maps a missing record to RESOURCE_NOT_FOUND', async () => {
      records.setRow(null);

      const result = await testingModule
        .get(DeleteRecord)
        .execute(userId, 'rec-1');

      expect(result.isErr()).toBe(true);
      expect(records.softDelete).not.toHaveBeenCalled();
    });
  });
});
