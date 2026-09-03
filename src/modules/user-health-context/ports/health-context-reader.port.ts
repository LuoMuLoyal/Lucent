import type { HealthContextResponseData } from '../dto/response.dto.js';
import type {
  DomainFailure,
  ResultAsync,
} from '../../../common/result/index.js';

/**
 * Read-only port for user health context.  Consumed by the assistant module
 * to read a user's health profile (allergies, conditions, current medicines)
 * without depending on the full UserHealthContextService API (which also
 * includes write methods for allergies, conditions, medicines, and event
 * emission).
 *
 * Registered in UserHealthContextModule via:
 * `{ provide: IUserHealthContextReader, useExisting: UserHealthContextService }`
 */
export abstract class IUserHealthContextReader {
  abstract getForUser(
    userId: string,
  ): ResultAsync<HealthContextResponseData, DomainFailure>;
}
