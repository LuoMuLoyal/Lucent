import { SuggestionService } from './suggestion.service';
import {
  SuggestionType,
  TriggerType,
  SuggestionConfidence,
  SuggestionLifecycleState,
  SuggestionFeedback,
  BaselineDimension,
} from '../types';
import type { SuggestionCandidate, SuggestionRule } from '../types';

function buildCandidate(
  overrides: Partial<SuggestionCandidate> = {},
): SuggestionCandidate {
  return {
    candidateId: `cand-${Math.random()}`,
    ruleId: 'test_rule',
    ruleVersion: '1.0.0',
    type: SuggestionType.COMPLIANCE,
    triggerType: TriggerType.EVENT,
    title: 'Test Suggestion',
    reason: 'Test reason',
    evidence: [],
    boundary: 'Test boundary',
    primaryAction: {
      actionId: 'go',
      label: 'Go',
      route: '/test',
      authRequired: true,
    },
    priorityScore: 500,
    confidence: SuggestionConfidence.HIGH,
    notificationEligible: false,
    ...overrides,
  };
}

function buildRule(overrides: Partial<SuggestionRule> = {}): SuggestionRule {
  return {
    ruleId: 'test_rule',
    ruleVersion: '1.0.0',
    type: SuggestionType.COMPLIANCE,
    triggerType: TriggerType.EVENT,
    isBaselineRequired: false,
    match: vi.fn().mockReturnValue(null),
    ...overrides,
  };
}

interface MockDeps {
  medicationCollector: { collect: vi.Mock };
  recordCollector: { collect: vi.Mock; getTimeOfDay: vi.Mock };
  profileCollector: { collect: vi.Mock };
  registry: { getAll: vi.Mock };
  suppression: { filterAndAdjust: vi.Mock };
  arbitration: { arbitrate: vi.Mock };
  baseline: { getBaselineStatus: vi.Mock };
  lifecycle: { expireStaleSuggestions: vi.Mock; persistActive: vi.Mock };
  escalation: { escalateIfNeeded: vi.Mock };
}

function buildMocks(): MockDeps {
  return {
    medicationCollector: { collect: vi.fn().mockResolvedValue([]) },
    recordCollector: {
      collect: vi.fn().mockResolvedValue([]),
      getTimeOfDay: vi.fn().mockReturnValue('morning' as const),
    },
    profileCollector: { collect: vi.fn().mockResolvedValue([]) },
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
      deps.medicationCollector as never,
      deps.recordCollector as never,
      deps.profileCollector as never,
      deps.registry as never,
      deps.suppression as never,
      deps.arbitration as never,
      deps.baseline as never,
      deps.lifecycle as never,
      deps.escalation as never,
    );
  });

  it('returns empty result when no candidates are produced', async () => {
    const result = await service.generate('user-1', '2026-07-09');

    expect(result.primary).toBeUndefined();
    expect(result.secondary).toBeUndefined();
    expect(result.observations).toBeUndefined();
    expect(result.generatedAt).toBeDefined();
  });

  it('collects signals from all three collectors in parallel', async () => {
    await service.generate('user-1', '2026-07-09');

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
  });

  it('passes a primary candidate through the full pipeline', async () => {
    const candidate = buildCandidate({ candidateId: 'c1' });
    deps.registry.getAll.mockReturnValue([
      buildRule({ match: vi.fn().mockReturnValue(candidate) }),
    ]);
    deps.suppression.filterAndAdjust.mockResolvedValue({
      candidates: [candidate],
      suppressedIds: [],
    });
    deps.arbitration.arbitrate.mockReturnValue({
      primary: candidate,
      secondary: [],
      observations: [],
    });
    deps.lifecycle.persistActive.mockResolvedValue('db-id-1');

    const result = await service.generate('user-1', '2026-07-09');

    expect(result.primary).toBeDefined();
    expect(result.primary!.id).toBe('db-id-1');
    expect(result.primary!.type).toBe(SuggestionType.COMPLIANCE);
    expect(result.primary!.lifecycleState).toBe(
      SuggestionLifecycleState.ACTIVE,
    );
    expect(deps.lifecycle.persistActive).toHaveBeenCalledWith(
      'user-1',
      candidate,
      '2026-07-09',
    );
    expect(deps.escalation.escalateIfNeeded).toHaveBeenCalledWith(
      'user-1',
      'db-id-1',
      candidate,
      '2026-07-09',
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

    deps.arbitration.arbitrate.mockReturnValue({
      primary,
      secondary: [secondary1, secondary2],
      observations: [],
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
      confidence: SuggestionConfidence.LOW,
    });

    deps.arbitration.arbitrate.mockReturnValue({
      primary: null,
      secondary: [],
      observations: [obs],
    });

    const result = await service.generate('user-1', '2026-07-09');

    expect(result.observations).toHaveLength(1);
    expect(result.observations![0]!.id).toMatch(/^obs_/);
    expect(deps.lifecycle.persistActive).not.toHaveBeenCalled();
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

    await service.generate('user-1', '2026-07-09');

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

    await service.generate('user-1', '2026-07-09');

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

    const result = await service.generate('user-1', '2026-07-09');

    expect(result.primary).toBeDefined();
    expect(result.primary!.ruleId).toBe('good_rule');
  });

  it('filters out excluded IDs from the result', async () => {
    const primary = buildCandidate({ candidateId: 'c1' });
    deps.arbitration.arbitrate.mockReturnValue({
      primary,
      secondary: [],
      observations: [],
    });
    deps.lifecycle.persistActive.mockResolvedValue('excluded-id');

    const result = await service.generate('user-1', '2026-07-09', [
      'excluded-id',
    ]);

    expect(result.primary).toBeUndefined();
  });

  it('maps cardTone to urgent for CONFIRMED_RISK type', async () => {
    const candidate = buildCandidate({ type: SuggestionType.CONFIRMED_RISK });
    deps.arbitration.arbitrate.mockReturnValue({
      primary: candidate,
      secondary: [],
      observations: [],
    });
    deps.lifecycle.persistActive.mockResolvedValue('id-1');

    const result = await service.generate('user-1', '2026-07-09');

    expect(result.primary!.cardTone).toBe('urgent');
  });

  it('maps cardTone to warning for TREND type', async () => {
    const candidate = buildCandidate({ type: SuggestionType.TREND });
    deps.arbitration.arbitrate.mockReturnValue({
      primary: candidate,
      secondary: [],
      observations: [],
    });
    deps.lifecycle.persistActive.mockResolvedValue('id-1');

    const result = await service.generate('user-1', '2026-07-09');

    expect(result.primary!.cardTone).toBe('warning');
  });

  it('maps cardTone to soft for BEHAVIOR_ADVICE type', async () => {
    const candidate = buildCandidate({ type: SuggestionType.BEHAVIOR_ADVICE });
    deps.arbitration.arbitrate.mockReturnValue({
      primary: candidate,
      secondary: [],
      observations: [],
    });
    deps.lifecycle.persistActive.mockResolvedValue('id-1');

    const result = await service.generate('user-1', '2026-07-09');

    expect(result.primary!.cardTone).toBe('soft');
  });

  it('maps cardTone to neutral for COVERAGE type', async () => {
    const candidate = buildCandidate({ type: SuggestionType.COVERAGE });
    deps.arbitration.arbitrate.mockReturnValue({
      primary: candidate,
      secondary: [],
      observations: [],
    });
    deps.lifecycle.persistActive.mockResolvedValue('id-1');

    const result = await service.generate('user-1', '2026-07-09');

    expect(result.primary!.cardTone).toBe('neutral');
  });

  it('provides limited feedback options for COVERAGE type', async () => {
    const candidate = buildCandidate({ type: SuggestionType.COVERAGE });
    deps.arbitration.arbitrate.mockReturnValue({
      primary: candidate,
      secondary: [],
      observations: [],
    });
    deps.lifecycle.persistActive.mockResolvedValue('id-1');

    const result = await service.generate('user-1', '2026-07-09');

    expect(result.primary!.feedbackOptions).toEqual([
      SuggestionFeedback.ACCEPTED,
      SuggestionFeedback.LATER,
    ]);
  });

  it('provides full feedback options for non-COVERAGE types', async () => {
    const candidate = buildCandidate({ type: SuggestionType.COMPLIANCE });
    deps.arbitration.arbitrate.mockReturnValue({
      primary: candidate,
      secondary: [],
      observations: [],
    });
    deps.lifecycle.persistActive.mockResolvedValue('id-1');

    const result = await service.generate('user-1', '2026-07-09');

    expect(result.primary!.feedbackOptions).toEqual([
      SuggestionFeedback.ACCEPTED,
      SuggestionFeedback.LATER,
      SuggestionFeedback.NOT_APPLICABLE,
      SuggestionFeedback.SUPPRESS,
    ]);
  });

  it('maps icon based on subtype when available', async () => {
    const candidate = buildCandidate({ subtype: 'water' });
    deps.arbitration.arbitrate.mockReturnValue({
      primary: candidate,
      secondary: [],
      observations: [],
    });
    deps.lifecycle.persistActive.mockResolvedValue('id-1');

    const result = await service.generate('user-1', '2026-07-09');

    expect(result.primary!.icon).toBe('droplets');
  });

  it('falls back to type-based icon when no subtype', async () => {
    const candidate = buildCandidate({
      type: SuggestionType.CONFIRMED_RISK,
    });
    deps.arbitration.arbitrate.mockReturnValue({
      primary: candidate,
      secondary: [],
      observations: [],
    });
    deps.lifecycle.persistActive.mockResolvedValue('id-1');

    const result = await service.generate('user-1', '2026-07-09');

    expect(result.primary!.icon).toBe('alert-triangle');
  });

  it('expires stale suggestions before persisting new ones', async () => {
    deps.arbitration.arbitrate.mockReturnValue({
      primary: buildCandidate(),
      secondary: [],
      observations: [],
    });
    deps.lifecycle.persistActive.mockResolvedValue('id-1');

    await service.generate('user-1', '2026-07-09');

    expect(deps.lifecycle.expireStaleSuggestions).toHaveBeenCalledWith(
      'user-1',
      '2026-07-09',
    );
  });
});
