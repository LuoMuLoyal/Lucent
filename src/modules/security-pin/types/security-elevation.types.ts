export interface SecurityElevationPayload {
  sub: string;
  scope: string;
  version: number;
}

export interface SecurityElevationResult {
  elevationToken: string;
  expiresAt: string;
}

export const SECURITY_ELEVATION_SCOPE = 'security_elevation' as const;
export const SECURITY_ELEVATION_TTL_SECONDS = 15 * 60;
