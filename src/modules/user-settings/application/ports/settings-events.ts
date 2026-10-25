/**
 * Outbound port: publish `settings.changed` after a successful write.
 *
 * `reports` and `today-suggestion` invalidate their own derived state on this
 * event, so a dropped publish leaves stale dashboards. That is a *degraded*
 * outcome, not a failed write — the user's setting **is** persisted. The
 * adapter logs and swallows, matching the previous behaviour of the service.
 */

import type {
  DomainFailure,
  ResultAsync,
} from '../../../../common/result/index.js';

export abstract class SettingsEvents {
  abstract settingsChanged(userId: string): ResultAsync<void, DomainFailure>;
}
