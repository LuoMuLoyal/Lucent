/**
 * Collector ports for the Today suggestion engine (`application/ports`).
 *
 * The pipeline orchestrates four collectors, each of which reaches into another
 * context (records, medication, profile, health events) and is therefore an
 * anti-corruption adapter. Declaring their contracts here keeps the pipeline
 * depending on the shape of the data rather than on the adapter files.
 */

import type { SuggestionSignal } from '../../domain/signal/signal.js';

/** DI tokens; the interfaces themselves live below. */
export const MEDICATION_COLLECTOR_PORT = 'MEDICATION_COLLECTOR_PORT';
export const RECORD_COLLECTOR_PORT = 'RECORD_COLLECTOR_PORT';
export const PROFILE_COLLECTOR_PORT = 'PROFILE_COLLECTOR_PORT';
export const HEALTH_EVENT_COLLECTOR_PORT = 'HEALTH_EVENT_COLLECTOR_PORT';

/**
 * Every collector answers the same question — "what signals does this context
 * have for this user on this date?" — so one interface serves all four.
 */
export interface SuggestionSignalCollectorPort {
  collect(userId: string, date: string): Promise<SuggestionSignal[]>;
}
