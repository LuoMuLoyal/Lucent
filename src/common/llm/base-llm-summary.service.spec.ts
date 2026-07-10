/* eslint-disable @typescript-eslint/no-unsafe-call, @typescript-eslint/no-useless-constructor, @typescript-eslint/require-await */
import { Logger } from '@nestjs/common';
import type { PrismaService } from '../../prisma/prisma.service';
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
      findFirst: jest.fn().mockResolvedValue({ value: true }),
    },
  } as unknown as jest.Mocked<PrismaService>;

  const copyService: jest.Mocked<
    LlmSummaryCopyService<TestContext, TestOutput>
  > = {
    resolveLocale: jest.fn().mockReturnValue('zh-CN'),
    buildPromptCopy: jest.fn().mockReturnValue({
      userIntro: 'intro',
      tone: 'tone',
      actionLabelHint: 'hint',
      factsLabel: 'facts',
    }),
    summariesDisabled: jest.fn().mockReturnValue('AI summaries disabled'),
    buildFallback: jest.fn().mockReturnValue(fallbackOutput),
  };

  const generatorService = {
    hasAnalysisModel: jest.fn().mockReturnValue(true),
    generate: jest.fn(),
    generateStream: jest.fn(),
  } as unknown as jest.Mocked<
    BaseLlmGeneratorService<TestContext, PromptCopy, TestOutput>
  >;

  const policyService = {
    isSafe: jest.fn().mockReturnValue(true),
    isSafeSummaryText: jest.fn().mockReturnValue(true),
    isSafeText: jest.fn().mockReturnValue(true),
  } as unknown as jest.Mocked<LlmSafetyPolicyService>;

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
      const onSummary = jest.fn();

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

      const onSummary = jest.fn();
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

      const onSummary = jest.fn();
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

      const onSummary = jest.fn();
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
  });
});
