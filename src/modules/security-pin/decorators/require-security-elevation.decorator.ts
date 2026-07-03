import { SetMetadata } from '@nestjs/common';

export const REQUIRE_SECURITY_ELEVATION_KEY = 'requireSecurityElevation';

/**
 * Marks a controller or handler as requiring a valid Security PIN elevation token.
 * Combine with JwtAuthGuard and SecurityElevationGuard on sensitive routes.
 */
export const RequireSecurityElevation = () =>
  SetMetadata(REQUIRE_SECURITY_ELEVATION_KEY, true);
