import { TriggerType } from '../suggestion/suggestion.types.js';
import type { SuggestionSignal } from '../signal/signal.js';

import type { RuleContext } from '../rule/rule-definition.js';

import type { BaselineDimension } from '../baseline/baseline.js';

export function buildContext(
  overrides: Partial<RuleContext> = {},
): RuleContext {
  const baselineStatus = new Map<BaselineDimension, boolean>();
  return {
    userId: 'test-user',
    date: '2026-07-09',
    timeOfDay: 'afternoon',
    baselineStatus,
    ...overrides,
  };
}

export function buildSignal(
  overrides: Partial<SuggestionSignal> = {},
): SuggestionSignal {
  return {
    signalId: 'test-signal',
    source: 'medication',
    kind: 'pending_dose',
    recordedAt: new Date('2026-07-09T00:00:00.000Z'),
    payload: {},
    userId: 'test-user',
    triggerType: TriggerType.EVENT,
    ...overrides,
  };
}
