import type { Cache } from 'cache-manager';
import type { BullmqQueueFactory } from '../../../../common/queue/queue.factory.js';
import { SuggestionCopyQueueService } from './queue.service.js';
import type { SuggestionCopyService } from './writer.service.js';
import type { CopyJobData } from '../../types/copy-generation.types.js';
import {
  SuggestionType,
  SuggestionConfidence,
} from '../../types/suggestion.types.js';

function buildFactory(available: boolean): {
  factory: BullmqQueueFactory;
  mockQueue: {
    add: ReturnType<typeof vi.fn>;
    getJob: ReturnType<typeof vi.fn>;
  } | null;
} {
  if (!available) {
    return {
      factory: {
        isAvailable: false,
        createQueue: () => ({ queue: null, worker: null }),
      } as unknown as BullmqQueueFactory,
      mockQueue: null,
    };
  }
  const mockQueue = {
    add: vi.fn().mockResolvedValue({ id: 'job-1' }),
    getJob: vi.fn(),
  };
  return {
    factory: {
      isAvailable: true,
      createQueue: () => ({
        queue: mockQueue,
        worker: { on: vi.fn(), close: vi.fn() },
      }),
    } as unknown as BullmqQueueFactory,
    mockQueue,
  };
}

const mockCache = { get: vi.fn(), set: vi.fn() } as unknown as Cache;

const mockCopyService = {
  generateViaLlm: vi.fn(),
} as unknown as SuggestionCopyService;

const buildJobData = (overrides: Partial<CopyJobData> = {}): CopyJobData => ({
  templateKey: 'water.behind.target',
  params: { completedCount: 2, targetCount: 8 },
  locale: 'zh-CN',
  tone: 'gentle',
  suggestionType: SuggestionType.BEHAVIOR_ADVICE,
  confidence: SuggestionConfidence.MEDIUM,
  ruleId: 'water_behind_target',
  subtype: 'water',
  evidence: [{ kind: 'record', label: '当前杯数', value: '2 杯' }],
  ...overrides,
});

describe('SuggestionCopyQueueService', () => {
  it('is not configured when Redis is unavailable', () => {
    const { factory } = buildFactory(false);
    const svc = new SuggestionCopyQueueService(
      factory,
      mockCache,
      mockCopyService,
    );
    expect(svc.isConfigured).toBe(false);
  });

  it('is configured when Redis is available', () => {
    const { factory } = buildFactory(true);
    const svc = new SuggestionCopyQueueService(
      factory,
      mockCache,
      mockCopyService,
    );
    expect(svc.isConfigured).toBe(true);
  });

  it('returns null from enqueue when queue is not configured', async () => {
    const { factory } = buildFactory(false);
    const svc = new SuggestionCopyQueueService(
      factory,
      mockCache,
      mockCopyService,
    );
    const result = await svc.enqueue(buildJobData());
    expect(result).toBeNull();
  });

  it('returns job id from enqueue when queue is configured', async () => {
    const { factory, mockQueue } = buildFactory(true);
    const svc = new SuggestionCopyQueueService(
      factory,
      mockCache,
      mockCopyService,
    );
    const jobData = buildJobData();
    const result = await svc.enqueue(jobData);
    expect(result).toBe('job-1');
    expect(mockQueue!.add).toHaveBeenCalledWith('generate-copy', jobData);
  });

  it('passes full context including evidence in job data', async () => {
    const { factory, mockQueue } = buildFactory(true);
    const svc = new SuggestionCopyQueueService(
      factory,
      mockCache,
      mockCopyService,
    );
    const jobData = buildJobData({
      evidence: [
        { kind: 'record', label: '当前杯数', value: '2 杯' },
        { kind: 'baseline', label: '近期记录天数', value: '3 天' },
      ],
    });
    await svc.enqueue(jobData);
    const callArg = mockQueue!.add.mock.calls[0]![1] as CopyJobData;
    expect(callArg.evidence).toHaveLength(2);
    expect(callArg.suggestionType).toBe(SuggestionType.BEHAVIOR_ADVICE);
    expect(callArg.confidence).toBe(SuggestionConfidence.MEDIUM);
  });
});
