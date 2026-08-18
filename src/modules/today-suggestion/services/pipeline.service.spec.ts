import { SuggestionPipelineService } from './pipeline.service';
import type { SuggestionSignal } from '../types/signal.types';
import type { SuggestionCandidate } from '../types/candidate.types';
import type { SuggestionRule } from '../types/rule.types';
import { BaselineDimension } from '../types/baseline.types';
import {
  SuggestionType,
  SuggestionConfidence,
} from '../types/suggestion.types';

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
    confidence: SuggestionConfidence.HIGH,
    notificationEligible: false,
    copyGeneration: {
      templateKey: 'test.template',
      params: {},
    },
    ...overrides,
  };
}

function buildRule(overrides: Partial<SuggestionRule> = {}): SuggestionRule {
  return {
    ruleId: 'test_rule',
    ruleVersion: '1.0.0',
    type: SuggestionType.COMPLIANCE,
    triggerType: 'event' as never,
    isBaselineRequired: false,
    match: vi.fn().mockReturnValue(null),
    ...overrides,
  };
}

interface MockDeps {
  medicationCollector: { collect: vi.Mock };
  recordCollector: { collect: vi.Mock; getTimeOfDay: vi.Mock };
  profileCollector: { collect: vi.Mock };
  healthEventCollector: { collect: vi.Mock };
  registry: { getAll: vi.Mock };
  suppression: { filterAndAdjust: vi.Mock };
  arbitration: { arbitrate: vi.Mock };
  baseline: { getBaselineStatus: vi.Mock };
  cache: {
    getSignals: vi.Mock;
    setSignals: vi.Mock;
    getBaselineStatus: vi.Mock;
    setBaselineStatus: vi.Mock;
  };
}

function buildMocks(): MockDeps {
  return {
    medicationCollector: { collect: vi.fn().mockResolvedValue([]) },
    recordCollector: {
      collect: vi.fn().mockResolvedValue([]),
      getTimeOfDay: vi.fn().mockReturnValue('morning' as const),
    },
    profileCollector: { collect: vi.fn().mockResolvedValue([]) },
    healthEventCollector: { collect: vi.fn().mockResolvedValue([]) },
    registry: { getAll: vi.fn().mockReturnValue([]) },
    suppression: {
      filterAndAdjust: vi.fn().mockResolvedValue({
        candidates: [],
        suppressedIds: [],
      }),
    },
    arbitration: {
      arbitrate: vi.fn().mockReturnValue({
        primary: null,
        secondary: [],
        observations: [],
      }),
    },
    baseline: {
      getBaselineStatus: vi.fn().mockResolvedValue(new Map()),
    },
    cache: {
      getSignals: vi.fn().mockResolvedValue(undefined),
      setSignals: vi.fn().mockResolvedValue(undefined),
      getBaselineStatus: vi.fn().mockResolvedValue(undefined),
      setBaselineStatus: vi.fn().mockResolvedValue(undefined),
    },
  };
}

describe('SuggestionPipelineService', () => {
  let service: SuggestionPipelineService;
  let deps: MockDeps;

  beforeEach(() => {
    deps = buildMocks();
    service = new SuggestionPipelineService(
      deps.medicationCollector as never,
      deps.recordCollector as never,
      deps.profileCollector as never,
      deps.healthEventCollector as never,
      deps.registry as never,
      deps.suppression as never,
      deps.arbitration as never,
      deps.baseline as never,
      deps.cache as never,
    );
  });

  it('returns empty arbitration result when no candidates are produced', async () => {
    const result = await service.run('user-1', '2026-07-09');

    expect(result.arbitrationResult.primary).toBeNull();
    expect(result.arbitrationResult.secondary).toEqual([]);
    expect(result.arbitrationResult.observations).toEqual([]);
    expect(result.degraded).toBe(false);
  });

  it('collects signals from all collectors in parallel', async () => {
    await service.run('user-1', '2026-07-09');

    expect(deps.medicationCollector.collect).toHaveBeenCalledWith(
      'user-1',
      '2026-07-09',
    );
    expect(deps.recordCollector.collect).toHaveBeenCalledWith(
      'user-1',
      '2026-07-09',
    );
    expect(deps.profileCollector.collect).toHaveBeenCalledWith(
      'user-1',
      '2026-07-09',
    );
    expect(deps.healthEventCollector.collect).toHaveBeenCalledWith(
      'user-1',
      '2026-07-09',
    );
  });

  it('returns the collected signals for post-recompute side effects', async () => {
    const signals: SuggestionSignal[] = [
      {
        signalId: 'water-1',
        source: 'record',
        kind: 'water_count',
        recordedAt: new Date('2026-07-09T00:00:00.000Z'),
        payload: { observedValue: 2, coverage: { sufficient: true } },
        userId: 'user-1',
        triggerType: 'timer' as never,
      },
    ];
    deps.recordCollector.collect.mockResolvedValue(signals);

    const result = await service.run('user-1', '2026-07-09');

    expect(result.signals).toEqual(signals);
  });

  it('uses cached signals when available, skipping collector calls', async () => {
    const cachedSignals: SuggestionSignal[] = [
      {
        signalId: 'cached',
        source: 'record',
        kind: 'water_count',
        recordedAt: new Date(),
        payload: {},
        userId: 'user-1',
        triggerType: 'timer' as never,
      },
    ];
    deps.cache.getSignals.mockResolvedValue(cachedSignals);

    await service.run('user-1', '2026-07-09');

    expect(deps.medicationCollector.collect).not.toHaveBeenCalled();
    expect(deps.recordCollector.collect).not.toHaveBeenCalled();
    expect(deps.profileCollector.collect).not.toHaveBeenCalled();
    expect(deps.healthEventCollector.collect).not.toHaveBeenCalled();
  });

  it('caches collected signals for subsequent requests', async () => {
    await service.run('user-1', '2026-07-09');

    expect(deps.cache.setSignals).toHaveBeenCalledWith(
      'user-1',
      '2026-07-09',
      expect.any(Array),
    );
  });

  it('uses cached baseline status when available, skipping baseline query', async () => {
    const cachedStatus = new Map([[BaselineDimension.WATER_INTAKE, true]]);
    deps.cache.getBaselineStatus.mockResolvedValue(cachedStatus);

    await service.run('user-1', '2026-07-09');

    expect(deps.baseline.getBaselineStatus).not.toHaveBeenCalled();
  });

  it('caches baseline status after fetching from baseline service', async () => {
    const status = new Map([[BaselineDimension.WATER_INTAKE, true]]);
    deps.baseline.getBaselineStatus.mockResolvedValue(status);

    await service.run('user-1', '2026-07-09');

    expect(deps.cache.setBaselineStatus).toHaveBeenCalledWith('user-1', status);
  });

  it('skips rules that require baselines when baseline is not ready', async () => {
    const rule = buildRule({
      isBaselineRequired: true,
      baselineDimensions: [BaselineDimension.WATER_INTAKE],
      match: vi.fn().mockReturnValue(buildCandidate()),
    });
    deps.registry.getAll.mockReturnValue([rule]);
    const baselineStatus = new Map();
    baselineStatus.set(BaselineDimension.WATER_INTAKE, false);
    deps.baseline.getBaselineStatus.mockResolvedValue(baselineStatus);

    await service.run('user-1', '2026-07-09');

    expect(rule.match).not.toHaveBeenCalled();
  });

  it('runs rules that require baselines when baseline is ready', async () => {
    const candidate = buildCandidate();
    const rule = buildRule({
      isBaselineRequired: true,
      baselineDimensions: [BaselineDimension.WATER_INTAKE],
      match: vi.fn().mockReturnValue(candidate),
    });
    deps.registry.getAll.mockReturnValue([rule]);
    const baselineStatus = new Map();
    baselineStatus.set(BaselineDimension.WATER_INTAKE, true);
    deps.baseline.getBaselineStatus.mockResolvedValue(baselineStatus);
    deps.suppression.filterAndAdjust.mockResolvedValue({
      candidates: [candidate],
      suppressedIds: [],
    });
    deps.arbitration.arbitrate.mockReturnValue({
      primary: candidate,
      secondary: [],
      observations: [],
    });

    await service.run('user-1', '2026-07-09');

    expect(rule.match).toHaveBeenCalled();
  });

  it('catches errors from individual rules without failing the pipeline', async () => {
    const goodCandidate = buildCandidate({
      candidateId: 'good',
      ruleId: 'good_rule',
    });
    const throwingRule = buildRule({
      ruleId: 'throwing_rule',
      match: vi.fn().mockImplementation(() => {
        throw new Error('Rule exploded');
      }),
    });
    const goodRule = buildRule({
      ruleId: 'good_rule',
      match: vi.fn().mockReturnValue(goodCandidate),
    });
    deps.registry.getAll.mockReturnValue([throwingRule, goodRule]);
    deps.suppression.filterAndAdjust.mockResolvedValue({
      candidates: [goodCandidate],
      suppressedIds: [],
    });
    deps.arbitration.arbitrate.mockReturnValue({
      primary: goodCandidate,
      secondary: [],
      observations: [],
    });

    const result = await service.run('user-1', '2026-07-09');

    expect(result.degraded).toBe(true);
    expect(result.arbitrationResult.primary).toBe(goodCandidate);
  });

  it('passes candidates through suppression before arbitration', async () => {
    const candidate = buildCandidate();
    deps.registry.getAll.mockReturnValue([
      buildRule({ match: vi.fn().mockReturnValue(candidate) }),
    ]);
    const suppressionResult = {
      candidates: [candidate],
      suppressedIds: [],
    };
    deps.suppression.filterAndAdjust.mockResolvedValue(suppressionResult);

    await service.run('user-1', '2026-07-09');

    expect(deps.suppression.filterAndAdjust).toHaveBeenCalledWith('user-1', [
      candidate,
    ]);
    expect(deps.arbitration.arbitrate).toHaveBeenCalledWith([candidate]);
  });

  it('returns arbitration result with primary, secondary, and observations', async () => {
    const primary = buildCandidate({ candidateId: 'c1', priorityScore: 800 });
    const secondary = buildCandidate({
      candidateId: 'c2',
      priorityScore: 400,
    });
    const observations = buildCandidate({
      candidateId: 'c3',
      priorityScore: 100,
    });

    deps.registry.getAll.mockReturnValue([
      buildRule({ match: vi.fn().mockReturnValue(primary) }),
      buildRule({
        ruleId: 'rule2',
        match: vi.fn().mockReturnValue(secondary),
      }),
      buildRule({
        ruleId: 'rule3',
        match: vi.fn().mockReturnValue(observations),
      }),
    ]);
    deps.suppression.filterAndAdjust.mockResolvedValue({
      candidates: [primary, secondary, observations],
      suppressedIds: [],
    });
    deps.arbitration.arbitrate.mockReturnValue({
      primary,
      secondary: [secondary],
      observations: [observations],
    });

    const result = await service.run('user-1', '2026-07-09');

    expect(result.arbitrationResult.primary).toBe(primary);
    expect(result.arbitrationResult.secondary).toEqual([secondary]);
    expect(result.arbitrationResult.observations).toEqual([observations]);
  });
});
