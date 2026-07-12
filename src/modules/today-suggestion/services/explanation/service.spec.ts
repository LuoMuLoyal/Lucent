import { NotFoundException } from '@nestjs/common';
import type { LlmSafetyPolicyService } from '../../../../common/llm/llm-safety-policy.service';
import type { PrismaService } from '../../../../prisma/prisma.service';
import type { ExplanationGeneratorService } from './generator.service';
import { ExplanationService } from './service';

describe('ExplanationService', () => {
  const mockSuggestion = {
    id: 'sug-123',
    userId: 'user-1',
    type: 'trend',
    triggerType: 'timer',
    confidence: 'medium',
    title: '症状恶化趋势',
    ruleId: 'deteriorating_trend',
    ruleVersion: '1.0.0',
    subtype: 'headache' as string | null,
    evidence: [
      { kind: 'trend', label: '最近7天严重度', value: '3→5→7' },
      { kind: 'baseline', label: '基线值', value: '3' },
    ],
    reason: '规则生成的原始原因',
    boundary: '规则生成的原始边界',
  };

  const createService = (opts: {
    hasModel?: boolean;
    generateResult?: { reason: string; boundary: string };
    isSafe?: boolean;
    suggestion?: typeof mockSuggestion | null;
  }) => {
    const hasModel = opts.hasModel ?? true;
    const generateResult = opts.generateResult ?? {
      reason: 'AI生成的解释',
      boundary: 'AI生成的边界',
    };
    const isSafe = opts.isSafe ?? true;
    const suggestion =
      opts.suggestion === undefined ? mockSuggestion : opts.suggestion;

    const prismaMock = {
      userSuggestion: {
        findFirst: vi.fn().mockResolvedValue(suggestion),
      },
    };

    const generatorMock = {
      hasAnalysisModel: vi.fn().mockReturnValue(hasModel),
      generate: vi.fn().mockResolvedValue(generateResult),
    } as unknown as ExplanationGeneratorService;

    const safetyMock = {
      isSafe: vi.fn().mockReturnValue(isSafe),
    } as unknown as LlmSafetyPolicyService;

    const service = new ExplanationService(
      prismaMock as unknown as PrismaService,
      generatorMock,
      safetyMock,
    );

    return { service, prismaMock, generatorMock, safetyMock };
  };

  describe('explain', () => {
    it('returns AI-generated explanation when model is configured and output is safe', async () => {
      const { service } = createService({});

      const result = await service.explain('user-1', 'sug-123', 'zh-CN');

      expect(result.suggestionId).toBe('sug-123');
      expect(result.reason).toBe('AI生成的解释');
      expect(result.boundary).toBe('AI生成的边界');
      expect(result.aiGenerated).toBe(true);
    });

    it('falls back to original text when model is not configured', async () => {
      const { service, generatorMock } = createService({ hasModel: false });

      const result = await service.explain('user-1', 'sug-123', 'zh-CN');

      expect(result.reason).toBe('规则生成的原始原因');
      expect(result.boundary).toBe('规则生成的原始边界');
      expect(result.aiGenerated).toBe(false);
      expect(generatorMock.generate).not.toHaveBeenCalled();
    });

    it('falls back to original text when safety policy rejects output', async () => {
      const { service, safetyMock } = createService({ isSafe: false });

      const result = await service.explain('user-1', 'sug-123', 'zh-CN');

      expect(result.reason).toBe('规则生成的原始原因');
      expect(result.boundary).toBe('规则生成的原始边界');
      expect(result.aiGenerated).toBe(false);
      expect(safetyMock.isSafe).toHaveBeenCalledWith([
        'AI生成的解释',
        'AI生成的边界',
      ]);
    });

    it('falls back to original text when generator throws', async () => {
      const generatorMock = {
        hasAnalysisModel: vi.fn().mockReturnValue(true),
        generate: vi.fn().mockRejectedValue(new Error('LLM timeout')),
      } as unknown as ExplanationGeneratorService;
      const safetyMock = {
        isSafe: vi.fn().mockReturnValue(true),
      } as unknown as LlmSafetyPolicyService;
      const prismaMock = {
        userSuggestion: {
          findFirst: vi.fn().mockResolvedValue(mockSuggestion),
        },
      } as unknown as PrismaService;

      const service = new ExplanationService(
        prismaMock,
        generatorMock,
        safetyMock,
      );

      const result = await service.explain('user-1', 'sug-123', 'zh-CN');

      expect(result.reason).toBe('规则生成的原始原因');
      expect(result.boundary).toBe('规则生成的原始边界');
      expect(result.aiGenerated).toBe(false);
    });

    it('throws NotFoundException when suggestion does not exist', async () => {
      const { service } = createService({ suggestion: null });

      await expect(
        service.explain('user-1', 'nonexistent', 'zh-CN'),
      ).rejects.toThrow(NotFoundException);
    });

    it('builds context with suggestion subtype when present', async () => {
      const { service, generatorMock } = createService({});

      await service.explain('user-1', 'sug-123', 'zh-CN');

      const generateCall = (generatorMock.generate as vi.Mock).mock.calls[0]!;
      const context = generateCall[0] as { subtype?: string };

      expect(context.subtype).toBe('headache');
    });

    it('builds context without subtype when absent', async () => {
      const suggestionNoSubtype = {
        ...mockSuggestion,
        subtype: null,
      };
      const { service, generatorMock } = createService({
        suggestion: suggestionNoSubtype,
      });

      await service.explain('user-1', 'sug-123', 'zh-CN');

      const generateCall = (generatorMock.generate as vi.Mock).mock.calls[0]!;
      const context = generateCall[0] as { subtype?: string };

      expect(context.subtype).toBeUndefined();
    });

    it('uses English prompt copy for non-Chinese locale', async () => {
      const { service, generatorMock } = createService({});

      await service.explain('user-1', 'sug-123', 'en-US');

      const generateCall = (generatorMock.generate as vi.Mock).mock.calls[0]!;
      const promptCopy = generateCall[1] as { userIntro: string };

      expect(promptCopy.userIntro).toContain('English');
    });
  });
});
