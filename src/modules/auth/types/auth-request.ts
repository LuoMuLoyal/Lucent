export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  accessTokenExpiresAt: string;
  refreshTokenExpiresAt: string;
}

export interface UserPayload {
  sub: string;
  email: string | null;
}

export interface AuthRequestContext {
  ipAddress?: string;
  userAgent?: string;
}
