import { DailyRecordKind } from '#generated/prisma/client.js';
import type { MealAnalysisQueueService } from './meal-analysis/queue.service.js';
import { MealPayloadWriterService } from './meal-payload-writer.service.js';

/**
 * 这一层是「客户端提交 → 落库 payload」的唯一闸门，四条公共方法各自有独立的早返回，
 * 而它们此前只被 `records.service.spec.ts` 的端到端路径间接覆盖（测不到单条分支）。
 * 这里按方法逐一锁定契约：谁能改、谁不能改、什么时候入队。
 */

/** 一份形状合法的已分析 payload，作为「已有分析结果」的基线。 */
function analyzedPayload(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    mealAnalysis: {
      version: 2,
      analysisStatus: 'analyzed',
      analyzedAt: '2026-07-28T04:00:00.000Z',
      sourceRevision: 3,
      model: 'vision-model',
      promptVersion: 'meal-analysis.v2',
      locale: 'zh',
      failureReason: null,
      calorieRange: { min: 400, max: 600, unit: 'kcal', bucket: 'medium' },
      dishes: [{ name: '番茄炒蛋', source: 'model' }],
      items: [
        {
          rank: 1,
          kind: 'protein',
          polarity: 'good',
          headline: '蛋白质充足',
          detail: '鸡蛋提供了优质蛋白。',
        },
      ],
      facets: {},
      ...overrides,
    },
  };
}

function buildService(): {
  service: MealPayloadWriterService;
  enqueue: vi.Mock;
} {
  const enqueue = vi.fn().mockResolvedValue(undefined);

  return {
    service: new MealPayloadWriterService({
      enqueue,
    } as unknown as MealAnalysisQueueService),
    enqueue,
  };
}

describe('MealPayloadWriterService', () => {
  describe('prepareMealPayloadForWrite', () => {
    it('returns null when there is no existing analysis to build on', () => {
      const { service } = buildService();

      // 客户端提交不能凭空造出分析结果：没有既有分析就没有可编辑的菜名。
      expect(service.prepareMealPayloadForWrite({}, [], undefined)).toBeNull();
    });

    it('keeps the existing analysis untouched when no image is attached', () => {
      const { service } = buildService();

      const result = service.prepareMealPayloadForWrite(
        {},
        [],
        analyzedPayload(),
      );

      expect(result).toEqual(analyzedPayload());
    });

    it('keeps the existing analysis untouched when more than one image is attached', () => {
      const { service } = buildService();

      // 多张图无法分析：不置 analyzing，保留上一轮结果。
      const result = service.prepareMealPayloadForWrite(
        {},
        [{ objectKey: 'a' }, { objectKey: 'b' }],
        analyzedPayload(),
      );

      expect(result).toEqual(analyzedPayload());
    });

    it('applies client dish edits and marks them as user-sourced', () => {
      const { service } = buildService();

      const result = service.prepareMealPayloadForWrite(
        { mealAnalysis: { dishes: [{ name: '番茄炒蛋' }] } },
        [],
        analyzedPayload(),
      );

      expect(result?.['mealAnalysis']).toMatchObject({
        dishes: [{ name: '番茄炒蛋', source: 'user' }],
        // 改菜名不重算结论，也不改状态。
        analysisStatus: 'analyzed',
        sourceRevision: 3,
      });
    });

    it('switches exactly one image to the analyzing marker and bumps the revision', () => {
      const { service } = buildService();

      const result = service.prepareMealPayloadForWrite(
        {},
        [{ objectKey: 'only' }],
        analyzedPayload(),
      );

      // 恰好一张图 ⇒ 入队占位：状态回 analyzing、revision 递增（幂等靠它）。
      expect(result?.['mealAnalysis']).toMatchObject({
        analysisStatus: 'analyzing',
        sourceRevision: 4,
      });
    });

    it('ignores a client attempt to set the analysis status', () => {
      const { service } = buildService();

      const result = service.prepareMealPayloadForWrite(
        {
          mealAnalysis: {
            dishes: [{ name: '番茄炒蛋' }],
            analysisStatus: 'analyzed',
            sourceRevision: 99,
          },
        },
        [],
        analyzedPayload(),
      );

      // 状态与 revision 由服务端独占，客户端的这两个字段一律被丢掉。
      expect(result?.['mealAnalysis']).toMatchObject({
        analysisStatus: 'analyzed',
        sourceRevision: 3,
      });
    });
  });

  describe('withMealHotFields', () => {
    it('returns the input data unchanged when there is no meal payload', () => {
      const { service } = buildService();
      const data = { title: '午饭' };

      expect(service.withMealHotFields(data, null)).toBe(data);
    });

    it('writes the payload and projects the hot columns', () => {
      const { service } = buildService();

      const result = service.withMealHotFields(
        { title: '午饭' },
        analyzedPayload(),
      );

      expect(result).toMatchObject({
        title: '午饭',
        mealAnalysisStatus: 'analyzed',
        mealHeadline: '蛋白质充足',
        mealCalorieMin: 400,
        mealCalorieMax: 600,
        mealCalorieBucket: 'medium',
        mealSourceRevision: 3,
      });
      expect(result.payload).toBeDefined();
    });

    it('leaves hot columns at their defaults when the payload has no analysis', () => {
      const { service } = buildService();

      const result = service.withMealHotFields({ title: '午饭' }, {});

      // 形状不匹配按「没有分析」处理，而不是把半截对象投影成热列。
      expect(result).toMatchObject({
        mealAnalysisStatus: null,
        mealHeadline: null,
        mealCalorieMin: null,
        mealSourceRevision: 0,
      });
    });
  });

  describe('toCreateFields', () => {
    it('returns no create fields when there is no meal payload', () => {
      const { service } = buildService();

      expect(service.toCreateFields(null)).toEqual({});
    });

    it('returns the payload plus hot columns', () => {
      const { service } = buildService();

      expect(service.toCreateFields(analyzedPayload())).toMatchObject({
        payload: analyzedPayload(),
        mealAnalysisStatus: 'analyzed',
        mealSourceRevision: 3,
      });
    });
  });

  describe('enqueueAnalysisIfNeeded', () => {
    it('does nothing for a non-meal record', async () => {
      const { service, enqueue } = buildService();

      await service.enqueueAnalysisIfNeeded('u1', {
        id: 'r1',
        kind: DailyRecordKind.vital,
        attachments: [{ objectKey: 'only' }],
      });

      expect(enqueue).not.toHaveBeenCalled();
    });

    it('does nothing for a meal without exactly one image', async () => {
      const { service, enqueue } = buildService();

      await service.enqueueAnalysisIfNeeded('u1', {
        id: 'r1',
        kind: DailyRecordKind.meal,
        attachments: [],
      });

      expect(enqueue).not.toHaveBeenCalled();
    });

    it('does nothing when the payload is not in the analyzing state', async () => {
      const { service, enqueue } = buildService();

      // 并发写入已经把结果写完（analyzed / analysis_failed）时不能再入队覆盖。
      await service.enqueueAnalysisIfNeeded('u1', {
        id: 'r1',
        kind: DailyRecordKind.meal,
        attachments: [{ objectKey: 'only' }],
        payload: analyzedPayload(),
      });

      expect(enqueue).not.toHaveBeenCalled();
    });

    it('enqueues with the payload revision when the record is still analyzing', async () => {
      const { service, enqueue } = buildService();

      await service.enqueueAnalysisIfNeeded('u1', {
        id: 'r1',
        kind: DailyRecordKind.meal,
        attachments: [{ objectKey: 'only' }],
        payload: analyzedPayload({ analysisStatus: 'analyzing' }),
      });

      expect(enqueue).toHaveBeenCalledWith({
        userId: 'u1',
        recordId: 'r1',
        sourceRevision: 3,
      });
    });

    it('reads the analyzing flag raw but the revision through the parser', async () => {
      const { service, enqueue } = buildService();

      // 两处读法不同，这是既有实现的事实：状态判定直接取原始字段，revision 走
      // `parseMealRecordPayload` 的契约校验。半截 payload 因此会以 revision 0 入队
      //（写入侧给的是 `toInputJsonValue` 产物，正常路径不会出现半截形状）。
      // 用这条用例把当前行为钉住，改动其一时必须同时面对这个差异。
      await service.enqueueAnalysisIfNeeded('u1', {
        id: 'r1',
        kind: DailyRecordKind.meal,
        attachments: [{ objectKey: 'only' }],
        payload: {
          mealAnalysis: { analysisStatus: 'analyzing', sourceRevision: 7 },
        },
      });

      expect(enqueue).toHaveBeenCalledWith({
        userId: 'u1',
        recordId: 'r1',
        sourceRevision: 0,
      });
    });

    it('prefers the revision override without consulting the payload status', async () => {
      const { service, enqueue } = buildService();

      // 「写完再过一遍」的路径：payload 已在事务里写过，状态还不能作为判据。
      await service.enqueueAnalysisIfNeeded(
        'u1',
        {
          id: 'r1',
          kind: DailyRecordKind.meal,
          attachments: [{ objectKey: 'only' }],
        },
        5,
      );

      expect(enqueue).toHaveBeenCalledWith({
        userId: 'u1',
        recordId: 'r1',
        sourceRevision: 5,
      });
    });

    it('still requires exactly one image when a revision override is given', async () => {
      const { service, enqueue } = buildService();

      await service.enqueueAnalysisIfNeeded(
        'u1',
        {
          id: 'r1',
          kind: DailyRecordKind.meal,
          attachments: [],
        },
        5,
      );

      expect(enqueue).not.toHaveBeenCalled();
    });
  });
});
