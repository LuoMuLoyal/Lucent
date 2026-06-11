/**
 * NestJS ConfigService namespace keys.
 *
 * Used with @nestjs/config `registerAs()` and `configService.get()`.
 */
export enum ConfigKey {
  /** Application-level configuration (host, port, cors, etc.) */
  App = 'app',

  /** AI provider and model role configuration */
  Ai = 'ai',

  /** JWT configuration */
  Jwt = 'jwt',

  /** Mail configuration */
  Mail = 'mail',

  /** OAuth provider configuration */
  OAuth = 'oauth',

  /** Tencent Cloud COS upload configuration */
  TencentCos = 'tencentCos',
}
