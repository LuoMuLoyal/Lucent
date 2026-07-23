import type { DeepMocked } from '../../common/types/deep-mocked';
/* eslint-disable @typescript-eslint/no-useless-constructor, @typescript-eslint/require-await */
import { Logger } from '@nestjs/common';
import type { PrismaService } from '../../prisma';
import type { PromptCopy } from '../helpers/localized-copy';
import type { LlmSafetyPolicyService } from './llm-safety-policy.service';
import type { BaseLlmGeneratorService } from './base-llm-generator.service';
import {
  BaseLlmSummaryService,
  type LlmSummaryCopyService,
  type LlmStructuredOutput,
} from './base-llm-summary.service';

// ── Test fixtures ──────────────────────────────────────────────────────────

interface TestContext {
  data: string;
}

type TestOutput = LlmStructuredOutput;

interface TestDataDto {
  summary: string;
  bullets: Array<{ text: string }>;
  actionLabel: string;
  action: string;
  confidenceNote: string;
}

interface TestGenerateDto {
  targetId: string;
}

const fallbackOutput: TestOutput = {
  summary: 'Fallback summary',
  bullets: [{ text: 'Fallback bullet' }],
  actionLabel: 'OK',
  action: 'none',
  confidenceNote: 'low',
};

const generatedOutput: TestOutput = {
  summary: 'AI generated summary',
  bullets: [{ text: 'Bullet 1' }, { text: 'Bullet 2' }],
  actionLabel: 'Review',
  action: 'check',
  confidenceNote: 'high',
};

class TestSummaryService extends BaseLlmSummaryService<
  TestContext,
  TestOutput,
  TestDataDto,
  TestGenerateDto
> {
  protected readonly logger = new Logger('TestSummaryService');

  constructor(
    prisma: PrismaService,
    copyService: LlmSummaryCopyService<TestContext, TestOutput>,
    generatorService: BaseLlmGeneratorService<
      TestContext,
      PromptCopy,
      TestOutput
    >,
    policyService: LlmSafetyPolicyService,
  ) {
    super(prisma, copyService, generatorService, policyService);
  }

  protected async prepare(
    _userId: string,
    dto: TestGenerateDto,
    _locale: string,
  ) {
    return {
      context: { data: dto.targetId },
      locale: _locale,
    };
  }

  protected toDataDto(_context: TestContext, output: TestOutput): TestDataDto {
    return output;
  }

  protected async persistSummary(): Promise<void> {
    // noop
  }

  protected buildLogContext(context: TestContext): string {
    return context.data;
  }
}

// ── Mock factory ───────────────────────────────────────────────────────────

function createMocks() {
  const prisma = {
    userSetting: {
      findFirst: vi.fn().mockResolvedValue({ value: true }),
    },
  } as unknown as DeepMocked<PrismaService>;

  const copyService: vi.Mocked<LlmSummaryCopyService<TestContext, TestOutput>> =
    {
      resolveLocale: vi.fn().mockReturnValue('zh-CN'),
      buildPromptCopy: vi.fn().mockReturnValue({
        userIntro: 'intro',
        tone: 'tone',
        actionLabelHint: 'hint',
        factsLabel: 'facts',
      }),
      summariesDisabled: vi.fn().mockReturnValue('AI summaries disabled'),
      buildFallback: vi.fn().mockReturnValue(fallbackOutput),
    };

  const generatorService = {
    hasAnalysisModel: vi.fn().mockReturnValue(true),
    generate: vi.fn(),
    generateStream: vi.fn(),
  } as unknown as vi.Mocked<
    BaseLlmGeneratorService<TestContext, PromptCopy, TestOutput>
  >;

  const policyService = {
    isSafe: vi.fn().mockReturnValue(true),
    isSafeSummaryText: vi.fn().mockReturnValue(true),
    isSafeText: vi.fn().mockReturnValue(true),
  } as unknown as vi.Mocked<LlmSafetyPolicyService>;

  return { prisma, copyService, generatorService, policyService };
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe('BaseLlmSummaryService', () => {
  let service: TestSummaryService;
  let mocks: ReturnType<typeof createMocks>;

  beforeEach(() => {
    mocks = createMocks();
    service = new TestSummaryService(
      mocks.prisma,
      mocks.copyService,
      mocks.generatorService,
      mocks.policyService,
    );
  });

  describe('generate', () => {
    it('returns generated output when model is configured and safe', async () => {
      mocks.generatorService.generate.mockResolvedValue(generatedOutput);

      const result = await service.generate(
        'user-1',
        { targetId: 'rec-1' },
        'zh',
      );

      expect(result).toEqual(generatedOutput);
      expect(mocks.copyService.resolveLocale).toHaveBeenCalledWith('zh');
      expect(mocks.generatorService.generate).toHaveBeenCalledTimes(1);
    });

    it('returns fallback when model is not configured', async () => {
      mocks.generatorService.hasAnalysisModel.mockReturnValue(false);

      const result = await service.generate(
        'user-1',
        { targetId: 'rec-1' },
        'zh',
      );

      expect(result).toEqual(fallbackOutput);
      expect(mocks.copyService.buildFallback).toHaveBeenCalledWith(
        { data: 'rec-1' },
        'zh-CN',
      );
      expect(mocks.generatorService.generate).not.toHaveBeenCalled();
    });

    it('returns fallback when safety policy rejects output', async () => {
      mocks.generatorService.generate.mockResolvedValue(generatedOutput);
      mocks.policyService.isSafe.mockReturnValue(false);

      const result = await service.generate(
        'user-1',
        { targetId: 'rec-1' },
        'zh',
      );

      expect(result).toEqual(fallbackOutput);
      expect(mocks.copyService.buildFallback).toHaveBeenCalled();
    });

    it('returns fallback when generation throws', async () => {
      mocks.generatorService.generate.mockRejectedValue(new Error('LLM down'));

      const result = await service.generate(
        'user-1',
        { targetId: 'rec-1' },
        'zh',
      );

      expect(result).toEqual(fallbackOutput);
      expect(mocks.copyService.buildFallback).toHaveBeenCalled();
    });

    it('throws ForbiddenException when AI summaries are disabled', async () => {
      mocks.prisma.userSetting.findFirst.mockResolvedValue({ value: false });

      await expect(
        service.generate('user-1', { targetId: 'rec-1' }, 'zh'),
      ).rejects.toThrow();
    });

    it('proceeds when user setting is not found (default enabled)', async () => {
      mocks.prisma.userSetting.findFirst.mockResolvedValue(null);
      mocks.generatorService.generate.mockResolvedValue(generatedOutput);

      const result = await service.generate(
        'user-1',
        { targetId: 'rec-1' },
        'zh',
      );

      expect(result).toEqual(generatedOutput);
    });
  });

  describe('generateStream', () => {
    it('returns fallback and emits summary when model is not configured', async () => {
      mocks.generatorService.hasAnalysisModel.mockReturnValue(false);
      const onSummary = vi.fn();

      const result = await service.generateStream(
        'user-1',
        { targetId: 'rec-1' },
        'zh',
        onSummary,
      );

      expect(result).toEqual(fallbackOutput);
      expect(onSummary).toHaveBeenCalledWith({
        summary: fallbackOutput.summary,
      });
    });

    it('returns generated output on successful stream', async () => {
      mocks.generatorService.generateStream.mockImplementation(
        async (_ctx, _copy, onSummary) => {
          await onSummary('partial summary');
          return generatedOutput;
        },
      );

      const onSummary = vi.fn();
      const result = await service.generateStream(
        'user-1',
        { targetId: 'rec-1' },
        'zh',
        onSummary,
      );

      expect(result).toEqual(generatedOutput);
      expect(onSummary).toHaveBeenCalledWith({ summary: 'partial summary' });
    });

    it('returns fallback when stream throws', async () => {
      mocks.generatorService.generateStream.mockRejectedValue(
        new Error('Stream error'),
      );

      const onSummary = vi.fn();
      const result = await service.generateStream(
        'user-1',
        { targetId: 'rec-1' },
        'zh',
        onSummary,
      );

      expect(result).toEqual(fallbackOutput);
    });

    it('does not emit unsafe summary text during streaming', async () => {
      mocks.policyService.isSafeSummaryText.mockReturnValue(false);
      mocks.generatorService.generateStream.mockImplementation(
        async (_ctx, _copy, onSummary) => {
          await onSummary('unsafe text with 诊断');
          return generatedOutput;
        },
      );
      // The final output also needs to pass safety check
      mocks.policyService.isSafe.mockReturnValue(true);

      const onSummary = vi.fn();
      await service.generateStream(
        'user-1',
        { targetId: 'rec-1' },
        'zh',
        onSummary,
      );

      // The unsafe partial should not be emitted
      expect(onSummary).not.toHaveBeenCalledWith({
        summary: 'unsafe text with 诊断',
      });
    });

    it('returns fallback when final output is rejected by safety policy', async () => {
      // Stream succeeds but final output is unsafe
      mocks.generatorService.generateStream.mockImplementation(
        async (_ctx, _copy, onSummary) => {
          await onSummary('safe partial summary');
          return generatedOutput;
        },
      );
      // isSafeSummaryText passes for the partial, but isSafe fails for the final output
      mocks.policyService.isSafeSummaryText.mockReturnValue(true);
      mocks.policyService.isSafe.mockReturnValue(false);

      const onSummary = vi.fn();
      const result = await service.generateStream(
        'user-1',
        { targetId: 'rec-1' },
        'zh',
        onSummary,
      );

      expect(result).toEqual(fallbackOutput);
      // Since a summary was already emitted during streaming, the fallback
      // summary is NOT re-emitted (emitGuaranteedSummary skips when
      // alreadyEmitted is true).
      expect(onSummary).toHaveBeenCalledWith({
        summary: 'safe partial summary',
      });
      expect(onSummary).not.toHaveBeenCalledWith({
        summary: fallbackOutput.summary,
      });
    });

    it('emits fallback summary when stream fails and no summary was emitted', async () => {
      mocks.generatorService.generateStream.mockRejectedValue(
        new Error('Stream error'),
      );

      const onSummary = vi.fn();
      const result = await service.generateStream(
        'user-1',
        { targetId: 'rec-1' },
        'zh',
        onSummary,
      );

      expect(result).toEqual(fallbackOutput);
      // Should emit the fallback summary since nothing was emitted during stream
      expect(onSummary).toHaveBeenCalledWith({
        summary: fallbackOutput.summary,
      });
    });

    it('does not emit duplicate summary when stream already emitted one', async () => {
      mocks.generatorService.generateStream.mockImplementation(
        async (_ctx, _copy, onSummary) => {
          await onSummary('partial summary');
          throw new Error('Stream error after partial');
        },
      );
      mocks.policyService.isSafeSummaryText.mockReturnValue(true);

      const onSummary = vi.fn();
      const result = await service.generateStream(
        'user-1',
        { targetId: 'rec-1' },
        'zh',
        onSummary,
      );

      expect(result).toEqual(fallbackOutput);
      // Should NOT emit fallback summary because a summary was already emitted
      expect(onSummary).not.toHaveBeenCalledWith({
        summary: fallbackOutput.summary,
      });
    });

    it('does not emit fallback when fallback summary is whitespace-only', async () => {
      const whitespaceFallback: TestOutput = {
        summary: '   ',
        bullets: [{ text: 'Fallback bullet' }],
        actionLabel: 'OK',
        action: 'none',
        confidenceNote: 'low',
      };
      mocks.copyService.buildFallback.mockReturnValue(whitespaceFallback);
      mocks.generatorService.generateStream.mockRejectedValue(
        new Error('Stream error'),
      );

      const onSummary = vi.fn();
      const result = await service.generateStream(
        'user-1',
        { targetId: 'rec-1' },
        'zh',
        onSummary,
      );

      expect(result).toEqual(whitespaceFallback);
      // Should not emit because summary is whitespace-only
      expect(onSummary).not.toHaveBeenCalled();
    });
  });
});
