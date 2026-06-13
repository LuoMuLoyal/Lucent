import { SetMetadata } from '@nestjs/common';

export const SKIP_API_ENVELOPE_KEY = 'skipApiEnvelope';

export const SkipApiEnvelope = () => SetMetadata(SKIP_API_ENVELOPE_KEY, true);
