export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  accessTokenExpiresAt: string;
  refreshTokenExpiresAt: string;
}

export interface UserPayload {
  sub: string;
  email: string | null;
  /** User status at token sign time. Old tokens may omit this field. */
  status?: string;
}

export interface AuthRequestContext {
  ipAddress?: string;
  userAgent?: string;
}
