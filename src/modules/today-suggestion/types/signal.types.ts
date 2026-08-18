import type { TriggerType } from './suggestion.types';
import type { ObservedMetric } from '../../../common';

/** Signal source categories. */
export type SignalSource =
  | 'medication'
  | 'record'
  | 'risk_check'
  | 'profile'
  | 'environment'
  | 'health_event';

/**
 * A single unit of raw evidence collected from the database.
 * The rule engine consumes signals to produce candidates.
 */
export interface SuggestionSignal {
  signalId: string;
  source: SignalSource;
  kind: string;
  recordedAt: Date;
  payload: Record<string, unknown> & {
    observedMetric?: ObservedMetric<unknown> | Record<string, unknown>;
  };
  userId: string;
  triggerType: TriggerType;
}

/** Aggregated signals for one user on one date. */
export interface SignalBundle {
  userId: string;
  date: string;
  signals: SuggestionSignal[];
}

/** Evidence item shown on a suggestion card. */
export interface EvidenceItem {
  kind: 'record' | 'reminder' | 'risk_check' | 'trend' | 'profile' | 'baseline';
  label: string;
  value: string;
  /** Optional interpolation args for localizing dynamic values. */
  args?: Record<string, string | number>;
  recordId?: string;
  medicineId?: string;
}

/** Action that the user can take from a suggestion card. */
export interface SuggestionAction {
  actionId: string;
  label: string;
  route: string;
  authRequired: boolean;
}
