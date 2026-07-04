import { SetMetadata } from '@nestjs/common';

export const SKIP_API_ENVELOPE_KEY = 'skipApiEnvelope';

/**
 * Decorator that opts a controller or handler out of the global API response
 * envelope.
 */
export const SkipApiEnvelope = () => SetMetadata(SKIP_API_ENVELOPE_KEY, true);
