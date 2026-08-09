import { SuggestionService } from './suggestion.service';
import type { ArbitrationResult } from './arbitration/arbiter.service';
import type { CopyGenerationResult } from './copy/writer.service';
import type { SuggestionCandidate } from '../types/candidate.types';
import {
  SuggestionType,
  SuggestionLifecycleState,
} from '../types/suggestion.types';
import type { SuggestionItemDto } from '../dto/suggestion-response.dto';
import type { TodaySuggestionsDataDto } from '../dto/suggestion-history.dto';
import { SuggestionCacheService } from './cache/suggestion-cache.service';

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
    candidateId: `cand-${Math.random()}`,
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
    confidence: 'high' as never,
    notificationEligible: false,
    copyGeneration: {
      templateKey: 'test.template',
      params: {},
    },
    ...overrides,
  };
}

function buildDto(
  id: string,
  candidate: SuggestionCandidate,
  overrides: Partial<SuggestionItemDto> = {},
): SuggestionItemDto {
  return {
    id,
    type: candidate.type,
    cardTone: 'soft',
    icon: 'lightbulb',
    title: mockCopyResult.title,
    reason: mockCopyResult.reason,
    evidence: [],
    boundary: mockCopyResult.boundary,
    primaryAction: {
      ...candidate.primaryAction,
      label: mockCopyResult.actionLabel,
    },
    confidence: candidate.confidence,
    ruleId: candidate.ruleId,
    ruleVersion: candidate.ruleVersion,
    triggerType: candidate.triggerType,
    lifecycleState: SuggestionLifecycleState.ACTIVE,
    notificationEligible: candidate.notificationEligible,
    feedbackOptions: [
      'accepted' as never,
      'later' as never,
      'not_applicable' as never,
      'suppress' as never,
    ],
    subtype: candidate.subtype,
    ...overrides,
  };
}

interface MockDeps {
  pipeline: { run: vi.Mock };
  presentation: {
    getCachedResult: vi.Mock;
    cacheResult: vi.Mock;
    generateCopy: vi.Mock;
    resolveCopy: vi.Mock;
    toDto: vi.Mock;
  };
  lifecycle: { expireStaleSuggestions: vi.Mock; persistActive: vi.Mock };
  escalation: { escalateIfNeeded: vi.Mock };
}

function buildMocks(): MockDeps {
  return {
    pipeline: {
      run: vi.fn().mockResolvedValue({
        arbitrationResult: {
          primary: null,
          secondary: [],
          observations: [],
        } as ArbitrationResult,
        degraded: false,
      }),
    },
    presentation: {
      getCachedResult: vi.fn().mockResolvedValue(undefined),
      cacheResult: vi.fn().mockResolvedValue(undefined),
      generateCopy: vi.fn().mockResolvedValue(new Map()),
      resolveCopy: vi.fn().mockReturnValue(mockCopyResult),
      toDto: vi
        .fn()
        .mockImplementation((id: string, candidate: SuggestionCandidate) =>
          buildDto(id, candidate),
        ),
    },
    lifecycle: {
      expireStaleSuggestions: vi.fn().mockResolvedValue(undefined),
      persistActive: vi.fn().mockResolvedValue('suggestion-id'),
    },
    escalation: { escalateIfNeeded: vi.fn().mockResolvedValue(undefined) },
  };
}

describe('SuggestionService', () => {
  let service: SuggestionService;
  let deps: MockDeps;

  beforeEach(() => {
    deps = buildMocks();
    service = new SuggestionService(
      deps.pipeline as never,
      deps.presentation as never,
      deps.lifecycle as never,
      deps.escalation as never,
    );
  });

  it('returns cached result when available, bypassing the pipeline', async () => {
    const cached: TodaySuggestionsDataDto = {
      generatedAt: 'old',
      primary: buildDto('cached-1', buildCandidate()),
    };
    deps.presentation.getCachedResult.mockResolvedValue(cached);

    const result = await service.generate('user-1', '2026-07-09');

    expect(result.primary).toBeDefined();
    expect(result.primary!.id).toBe('cached-1');
    expect(result.generatedAt).not.toBe('old'); // generatedAt is always fresh
    expect(deps.pipeline.run).not.toHaveBeenCalled();
  });

  it('returns empty result when pipeline produces no candidates', async () => {
    const result = await service.generate('user-1', '2026-07-09');

    expect(result.primary).toBeUndefined();
    expect(result.secondary).toBeUndefined();
    expect(result.observations).toBeUndefined();
    expect(result.generatedAt).toBeDefined();
  });

  it('characterizes cache-miss generate as pull-triggered pipeline execution', async () => {
    await service.generate('user-1', '2026-07-09');

    expect(deps.pipeline.run).toHaveBeenCalledWith('user-1', '2026-07-09');
  });

  it('red: readCurrent returns materialized data without running the pipeline', async () => {
    const cached: TodaySuggestionsDataDto = {
      generatedAt: 'materialized-at',
      primary: buildDto('materialized-1', buildCandidate()),
    };
    deps.presentation.getCachedResult.mockResolvedValue(cached);

    const readCurrent = (
      service as unknown as {
        readCurrent?: (
          userId: string,
          date: string,
          excludeIds?: string[],
        ) => Promise<TodaySuggestionsDataDto>;
      }
    ).readCurrent;

    // Planned API: Task 4 will split readCurrent from recompute/generate.
    expect(readCurrent).toBeTypeOf('function');
    if (readCurrent == null) return;

    const result = await readCurrent.call(service, 'user-1', '2026-07-09');

    expect(result).toEqual(cached);
    expect(deps.pipeline.run).not.toHaveBeenCalled();
  });

  it('passes a primary candidate through the full pipeline', async () => {
    const candidate = buildCandidate({ candidateId: 'c1' });
    deps.pipeline.run.mockResolvedValue({
      arbitrationResult: {
        primary: candidate,
        secondary: [],
        observations: [],
      },
      degraded: false,
    });
    deps.lifecycle.persistActive.mockResolvedValue('db-id-1');
    const dto = buildDto('db-id-1', candidate);
    deps.presentation.toDto.mockReturnValue(dto);

    const result = await service.generate('user-1', '2026-07-09');

    expect(result.primary).toBeDefined();
    expect(result.primary!.id).toBe('db-id-1');
    expect(deps.lifecycle.persistActive).toHaveBeenCalledWith(
      'user-1',
      candidate,
      '2026-07-09',
      mockCopyResult,
      'zh-CN',
    );
    expect(deps.escalation.escalateIfNeeded).toHaveBeenCalledWith(
      'user-1',
      'db-id-1',
      candidate,
      '2026-07-09',
      mockCopyResult,
    );
  });

  it('persists secondary candidates and maps them to DTOs', async () => {
    const primary = buildCandidate({ candidateId: 'c1', priorityScore: 800 });
    const secondary1 = buildCandidate({
      candidateId: 'c2',
      priorityScore: 400,
      type: SuggestionType.TREND,
    });
    const secondary2 = buildCandidate({
      candidateId: 'c3',
      priorityScore: 300,
      type: SuggestionType.BEHAVIOR_ADVICE,
    });

    deps.pipeline.run.mockResolvedValue({
      arbitrationResult: {
        primary,
        secondary: [secondary1, secondary2],
        observations: [],
      },
      degraded: false,
    });
    deps.lifecycle.persistActive
      .mockResolvedValueOnce('db-id-1')
      .mockResolvedValueOnce('db-id-2')
      .mockResolvedValueOnce('db-id-3');

    const result = await service.generate('user-1', '2026-07-09');

    expect(result.secondary).toHaveLength(2);
    expect(result.secondary![0]!.id).toBe('db-id-2');
    expect(result.secondary![1]!.id).toBe('db-id-3');
  });

  it('maps observations without persisting them', async () => {
    const obs = buildCandidate({
      candidateId: 'obs-1',
      type: SuggestionType.COVERAGE,
      confidence: 'low' as never,
    });

    deps.pipeline.run.mockResolvedValue({
      arbitrationResult: {
        primary: null,
        secondary: [],
        observations: [obs],
      },
      degraded: false,
    });

    const result = await service.generate('user-1', '2026-07-09');

    expect(result.observations).toHaveLength(1);
    expect(result.observations![0]!.id).toMatch(/^obs_/);
    expect(deps.lifecycle.persistActive).not.toHaveBeenCalled();
  });

  it('filters out excluded IDs from the result', async () => {
    const candidate = buildCandidate({ candidateId: 'c1' });
    deps.pipeline.run.mockResolvedValue({
      arbitrationResult: {
        primary: candidate,
        secondary: [],
        observations: [],
      },
      degraded: false,
    });
    deps.lifecycle.persistActive.mockResolvedValue('excluded-id');
    deps.presentation.toDto.mockReturnValue(buildDto('excluded-id', candidate));

    const result = await service.generate('user-1', '2026-07-09', [
      'excluded-id',
    ]);

    expect(result.primary).toBeUndefined();
  });

  it('includes degraded flag when pipeline reports degradation', async () => {
    deps.pipeline.run.mockResolvedValue({
      arbitrationResult: {
        primary: null,
        secondary: [],
        observations: [],
      },
      degraded: true,
    });

    const result = await service.generate('user-1', '2026-07-09');

    expect(result.degraded).toBe(true);
  });

  it('expires stale suggestions before persisting new ones', async () => {
    const candidate = buildCandidate({ candidateId: 'c1' });
    deps.pipeline.run.mockResolvedValue({
      arbitrationResult: {
        primary: candidate,
        secondary: [],
        observations: [],
      },
      degraded: false,
    });
    deps.lifecycle.persistActive.mockResolvedValue('id-1');

    await service.generate('user-1', '2026-07-09');

    expect(deps.lifecycle.expireStaleSuggestions).toHaveBeenCalledWith(
      'user-1',
      '2026-07-09',
    );
  });

  it('caches the final result', async () => {
    await service.generate('user-1', '2026-07-09');

    const expectedExcludeKey =
      SuggestionCacheService.buildExcludeKey(undefined);
    expect(deps.presentation.cacheResult).toHaveBeenCalledWith(
      'user-1',
      '2026-07-09',
      expectedExcludeKey,
      expect.objectContaining({ generatedAt: expect.any(String) }),
    );
  });

  it('passes locale through to copy generation and persistence', async () => {
    const candidate = buildCandidate({ candidateId: 'c1' });
    deps.pipeline.run.mockResolvedValue({
      arbitrationResult: {
        primary: candidate,
        secondary: [],
        observations: [],
      },
      degraded: false,
    });
    deps.lifecycle.persistActive.mockResolvedValue('id-1');

    await service.generate('user-1', '2026-07-09', undefined, {
      locale: 'en-US',
    });

    expect(deps.presentation.generateCopy).toHaveBeenCalledWith(
      expect.any(Array),
      'en-US',
    );
    expect(deps.lifecycle.persistActive).toHaveBeenCalledWith(
      'user-1',
      candidate,
      '2026-07-09',
      mockCopyResult,
      'en-US',
    );
  });
});
