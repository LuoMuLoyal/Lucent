import type { I18nService } from 'nestjs-i18n';
import { SuggestionPresentationService } from './presentation.service';
import {
  SuggestionCopyService,
  type CopyGenerationResult,
} from './copy/writer.service';
import type { SuggestionCandidate } from '../types/candidate.types';
import {
  SuggestionType,
  SuggestionConfidence,
  SuggestionLifecycleState,
  SuggestionFeedback,
} from '../types/suggestion.types';
import type { TodaySuggestionsDataDto } from '../dto/suggestion-history.dto';

const mockCopyResult: CopyGenerationResult = {
  title: 'AI Title',
  reason: 'AI Reason',
  boundary: 'AI Boundary',
  actionLabel: 'Go',
  aiGenerated: true,
  fromCache: false,
};

function buildCandidate(
  overrides: Partial<SuggestionCandidate> = {},
): SuggestionCandidate {
  return {
    candidateId: 'cand-1',
    ruleId: 'test_rule',
    ruleVersion: '1.0.0',
    type: SuggestionType.COMPLIANCE,
    triggerType: 'event' as never,
    evidence: [],
    primaryAction: {
      actionId: 'go',
      label: 'Go',
      route: '/test',
      authRequired: true,
    },
    priorityScore: 500,
    confidence: SuggestionConfidence.HIGH,
    notificationEligible: false,
    copyGeneration: {
      templateKey: 'test.template',
      params: {},
    },
    ...overrides,
  };
}

interface MockDeps {
  copyService: {
    getOrEnqueueBatch: vi.Mock;
    generateSyncBatch: vi.Mock;
  };
  copyQueue: {
    isConfigured: boolean;
    enqueue: vi.Mock;
  };
  cache: {
    getSuggestions: vi.Mock;
    setSuggestions: vi.Mock;
  };
  i18n: I18nService;
}

function buildMocks(): MockDeps {
  return {
    copyService: {
      getOrEnqueueBatch: vi.fn().mockResolvedValue(new Map()),
      generateSyncBatch: vi.fn().mockResolvedValue(new Map()),
    },
    copyQueue: {
      isConfigured: true,
      enqueue: vi.fn().mockResolvedValue('job-1'),
    },
    cache: {
      getSuggestions: vi.fn().mockResolvedValue(undefined),
      setSuggestions: vi.fn().mockResolvedValue(undefined),
    },
    i18n: {
      t: vi.fn((key: string, opts?: { lang?: string }) =>
        opts?.lang ? `${key} [${opts.lang}]` : key,
      ),
    } as unknown as I18nService,
  };
}

describe('SuggestionPresentationService', () => {
  let service: SuggestionPresentationService;
  let deps: MockDeps;

  beforeEach(() => {
    deps = buildMocks();
    service = new SuggestionPresentationService(
      deps.copyService as never,
      deps.copyQueue as never,
      deps.cache as never,
      deps.i18n,
    );
  });

  // ─── Cache management ───

  describe('getCachedResult', () => {
    it('delegates to cache.getSuggestions', async () => {
      const cached: TodaySuggestionsDataDto = {
        generatedAt: '2026-01-01T00:00:00Z',
        primary: undefined,
        materializationStatus: 'ready',
        sourceVersion: 1,
        computedAt: null,
        retryAfterSeconds: null,
      };
      deps.cache.getSuggestions.mockResolvedValue(cached);

      const result = await service.getCachedResult(
        'user-1',
        '2026-07-09',
        'none',
      );

      expect(deps.cache.getSuggestions).toHaveBeenCalledWith(
        'user-1',
        '2026-07-09',
        'none',
      );
      expect(result).toBe(cached);
    });

    it('returns undefined when cache misses', async () => {
      deps.cache.getSuggestions.mockResolvedValue(undefined);

      const result = await service.getCachedResult(
        'user-1',
        '2026-07-09',
        'none',
      );

      expect(result).toBeUndefined();
    });
  });

  describe('cacheResult', () => {
    it('delegates to cache.setSuggestions', async () => {
      const result: TodaySuggestionsDataDto = {
        generatedAt: 'now',
        materializationStatus: 'ready',
        sourceVersion: 1,
        computedAt: null,
        retryAfterSeconds: null,
      };
      await service.cacheResult('user-1', '2026-07-09', 'none', result);

      expect(deps.cache.setSuggestions).toHaveBeenCalledWith(
        'user-1',
        '2026-07-09',
        'none',
        result,
      );
    });
  });

  // ─── Copy generation ───

  describe('generateCopy', () => {
    it('uses queue path when queue is configured', async () => {
      deps.copyQueue.isConfigured = true;
      deps.copyService.getOrEnqueueBatch.mockResolvedValue(new Map());

      const candidates = [buildCandidate()];
      await service.generateCopy(candidates, 'zh-CN');

      expect(deps.copyService.getOrEnqueueBatch).toHaveBeenCalledWith(
        expect.any(Array),
        deps.copyQueue,
      );
      expect(deps.copyService.generateSyncBatch).not.toHaveBeenCalled();
    });

    it('uses sync path when queue is not configured', async () => {
      deps.copyQueue.isConfigured = false;
      deps.copyService.generateSyncBatch.mockResolvedValue(new Map());

      const candidates = [buildCandidate()];
      await service.generateCopy(candidates, 'zh-CN');

      expect(deps.copyService.generateSyncBatch).toHaveBeenCalledWith(
        expect.any(Array),
      );
      expect(deps.copyService.getOrEnqueueBatch).not.toHaveBeenCalled();
    });

    it('builds copy requests with template key, params, and locale', async () => {
      const candidate = buildCandidate({
        copyGeneration: {
          templateKey: 'coverage.profile.incomplete',
          params: { dimension: 'water', count: 3 },
        },
        subtype: 'water',
        evidence: [
          {
            kind: 'record',
            label: 'water_count',
            value: '2',
          } as never,
        ],
      });

      await service.generateCopy([candidate], 'en');

      const requestArg = (deps.copyService.getOrEnqueueBatch as vi.Mock).mock
        .calls[0]![0] as Array<Record<string, unknown>>;
      expect(requestArg[0]!['templateKey']).toBe('coverage.profile.incomplete');
      expect(requestArg[0]!['params']).toEqual({
        dimension: 'water',
        count: 3,
      });
      expect(requestArg[0]!['locale']).toBe('en');
      expect(requestArg[0]!['tone']).toBe('gentle');
      expect(requestArg[0]!['suggestionType']).toBe(SuggestionType.COMPLIANCE);
      expect(requestArg[0]!['subtype']).toBe('water');
      expect(requestArg[0]!['evidence']).toEqual([
        { kind: 'record', label: 'water_count', value: '2' },
      ]);
    });
  });

  // ─── resolveCopy ───

  describe('resolveCopy', () => {
    it('returns the result from the map when available', () => {
      const results = new Map([
        [
          SuggestionCopyService.buildResultKey('test.template', {}),
          mockCopyResult,
        ],
      ]);

      const result = service.resolveCopy(results, 'test.template', {}, 'zh-CN');

      expect(result).toBe(mockCopyResult);
    });

    it('returns fallback copy when result is missing', () => {
      const results = new Map<string, CopyGenerationResult>();

      const result = service.resolveCopy(
        results,
        'missed_dose.reminder',
        {},
        'zh-CN',
      );

      expect(result.aiGenerated).toBe(false);
      expect(result.fromCache).toBe(false);
      expect(result.title).toBeDefined();
    });

    it('returns i18n fallback when no template fallback exists', () => {
      const results = new Map<string, CopyGenerationResult>();

      const result = service.resolveCopy(
        results,
        'nonexistent.template',
        {},
        'zh-CN',
      );

      expect(result.aiGenerated).toBe(false);
      expect(result.title).toContain('fallback.title');
    });
  });

  // ─── toDto ───

  describe('toDto', () => {
    it('maps all candidate fields to the DTO', () => {
      const candidate = buildCandidate({
        evidence: [
          {
            kind: 'record',
            label: 'water_count',
            value: '2',
          } as never,
        ],
      });
      const copy: CopyGenerationResult = {
        title: 'Title',
        reason: 'Reason',
        boundary: 'Boundary',
        actionLabel: 'Action',
        aiGenerated: true,
        fromCache: false,
      };

      const dto = service.toDto(
        'id-1',
        candidate,
        SuggestionLifecycleState.ACTIVE,
        copy,
        'zh-CN',
      );

      expect(dto.id).toBe('id-1');
      expect(dto.type).toBe(SuggestionType.COMPLIANCE);
      expect(dto.title).toBe('Title');
      expect(dto.reason).toBe('Reason');
      expect(dto.boundary).toBe('Boundary');
      expect(dto.primaryAction.label).toBe('Action');
      expect(dto.lifecycleState).toBe(SuggestionLifecycleState.ACTIVE);
      expect(dto.ruleId).toBe('test_rule');
      expect(dto.ruleVersion).toBe('1.0.0');
      expect(dto.confidence).toBe(SuggestionConfidence.HIGH);
    });

    it('uses copy actionLabel when available, overriding candidate label', () => {
      const candidate = buildCandidate({
        primaryAction: {
          actionId: 'go',
          label: 'Original',
          route: '/test',
          authRequired: true,
        },
      });
      const copy: CopyGenerationResult = {
        title: 'T',
        reason: 'R',
        boundary: 'B',
        actionLabel: 'AI Label',
        aiGenerated: true,
        fromCache: false,
      };

      const dto = service.toDto('id-1', candidate, undefined, copy, 'zh-CN');

      expect(dto.primaryAction.label).toBe('AI Label');
    });

    it('localizes action label when copy has no actionLabel', () => {
      const candidate = buildCandidate({
        primaryAction: {
          actionId: 'go',
          label: 'log_dose',
          route: '/test',
          authRequired: true,
        },
      });
      const copy: CopyGenerationResult = {
        title: 'T',
        reason: 'R',
        boundary: 'B',
        actionLabel: '',
        aiGenerated: false,
        fromCache: false,
      };

      const dto = service.toDto('id-1', candidate, undefined, copy, 'en');

      // i18n.t returns "today-suggestion.action.log_dose [en]"
      expect(dto.primaryAction.label).toContain('action.log_dose');
    });

    it('localizes evidence labels and values', () => {
      const candidate = buildCandidate({
        evidence: [
          {
            kind: 'record',
            label: 'water_count',
            value: 'below_target',
          } as never,
        ],
      });
      const copy: CopyGenerationResult = {
        title: 'T',
        reason: 'R',
        boundary: 'B',
        actionLabel: '',
        aiGenerated: false,
        fromCache: false,
      };

      const dto = service.toDto('id-1', candidate, undefined, copy, 'en');

      expect(dto.evidence[0]!.label).toContain('evidence.water_count');
      // 'below_target' exists as evidence_value key → gets translated
      expect(dto.evidence[0]!.value).toContain('evidence_value.below_target');
    });

    it('falls back to raw value when evidence value key is not found', () => {
      const candidate = buildCandidate({
        evidence: [
          {
            kind: 'record',
            label: 'custom',
            value: 'raw_value_123',
          } as never,
        ],
      });
      const copy: CopyGenerationResult = {
        title: 'T',
        reason: 'R',
        boundary: 'B',
        actionLabel: '',
        aiGenerated: false,
        fromCache: false,
      };

      // Simulate i18n key-not-found for evidence_value: real i18n returns
      // the key path itself when no translation exists.
      const mockT = deps.i18n.t as unknown as vi.Mock;
      const originalImpl = mockT.getMockImplementation();
      mockT.mockImplementation((key: string, opts?: { lang?: string }) => {
        if (key.startsWith('today-suggestion.evidence_value.')) return key;
        return opts?.lang ? `${key} [${opts.lang}]` : key;
      });

      const dto = service.toDto('id-1', candidate, undefined, copy, 'en');

      // i18n returns the key path itself, so the value falls back to raw
      expect(dto.evidence[0]!.value).toBe('raw_value_123');

      mockT.mockImplementation(originalImpl!);
    });
  });

  // ─── cardTone mapping ───

  describe('cardTone mapping via toDto', () => {
    it('maps cardTone to urgent for CONFIRMED_RISK type', () => {
      const candidate = buildCandidate({ type: SuggestionType.CONFIRMED_RISK });
      const dto = service.toDto(
        'id-1',
        candidate,
        undefined,
        mockCopyResult,
        'zh-CN',
      );
      expect(dto.cardTone).toBe('urgent');
    });

    it('maps cardTone to urgent for COMPLIANCE type', () => {
      const candidate = buildCandidate({ type: SuggestionType.COMPLIANCE });
      const dto = service.toDto(
        'id-1',
        candidate,
        undefined,
        mockCopyResult,
        'zh-CN',
      );
      expect(dto.cardTone).toBe('urgent');
    });

    it('maps cardTone to warning for TREND type', () => {
      const candidate = buildCandidate({ type: SuggestionType.TREND });
      const dto = service.toDto(
        'id-1',
        candidate,
        undefined,
        mockCopyResult,
        'zh-CN',
      );
      expect(dto.cardTone).toBe('warning');
    });

    it('maps cardTone to soft for BEHAVIOR_ADVICE type', () => {
      const candidate = buildCandidate({
        type: SuggestionType.BEHAVIOR_ADVICE,
      });
      const dto = service.toDto(
        'id-1',
        candidate,
        undefined,
        mockCopyResult,
        'zh-CN',
      );
      expect(dto.cardTone).toBe('soft');
    });

    it('maps cardTone to neutral for COVERAGE type', () => {
      const candidate = buildCandidate({ type: SuggestionType.COVERAGE });
      const dto = service.toDto(
        'id-1',
        candidate,
        undefined,
        mockCopyResult,
        'zh-CN',
      );
      expect(dto.cardTone).toBe('neutral');
    });
  });

  // ─── icon mapping ───

  describe('icon mapping via toDto', () => {
    it('maps icon based on subtype when available', () => {
      const candidate = buildCandidate({ subtype: 'water' });
      const dto = service.toDto(
        'id-1',
        candidate,
        undefined,
        mockCopyResult,
        'zh-CN',
      );
      expect(dto.icon).toBe('droplets');
    });

    it('maps icon to moon for sleep subtype', () => {
      const candidate = buildCandidate({ subtype: 'sleep' });
      const dto = service.toDto(
        'id-1',
        candidate,
        undefined,
        mockCopyResult,
        'zh-CN',
      );
      expect(dto.icon).toBe('moon');
    });

    it('falls back to type-based icon when no subtype', () => {
      const candidate = buildCandidate({
        type: SuggestionType.CONFIRMED_RISK,
      });
      const dto = service.toDto(
        'id-1',
        candidate,
        undefined,
        mockCopyResult,
        'zh-CN',
      );
      expect(dto.icon).toBe('alert-triangle');
    });

    it('maps icon to pill for COMPLIANCE type', () => {
      const candidate = buildCandidate({ type: SuggestionType.COMPLIANCE });
      const dto = service.toDto(
        'id-1',
        candidate,
        undefined,
        mockCopyResult,
        'zh-CN',
      );
      expect(dto.icon).toBe('pill');
    });
  });

  // ─── feedbackOptions mapping ───

  describe('feedbackOptions mapping via toDto', () => {
    it('provides limited feedback options for COVERAGE type', () => {
      const candidate = buildCandidate({ type: SuggestionType.COVERAGE });
      const dto = service.toDto(
        'id-1',
        candidate,
        undefined,
        mockCopyResult,
        'zh-CN',
      );
      expect(dto.feedbackOptions).toEqual([
        SuggestionFeedback.ACCEPTED,
        SuggestionFeedback.LATER,
      ]);
    });

    it('provides full feedback options for non-COVERAGE types', () => {
      const candidate = buildCandidate({ type: SuggestionType.COMPLIANCE });
      const dto = service.toDto(
        'id-1',
        candidate,
        undefined,
        mockCopyResult,
        'zh-CN',
      );
      expect(dto.feedbackOptions).toEqual([
        SuggestionFeedback.ACCEPTED,
        SuggestionFeedback.LATER,
        SuggestionFeedback.NOT_APPLICABLE,
        SuggestionFeedback.SUPPRESS,
      ]);
    });
  });
});
