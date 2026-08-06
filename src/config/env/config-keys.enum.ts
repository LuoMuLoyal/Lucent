/**
 * NestJS ConfigService namespace keys.
 *
 * Used with @nestjs/config `registerAs()` and `configService.get()`.
 */
export enum ConfigKey {
  /** Application-level configuration (host, port, cors, etc.) */
  App = 'app',

  /** LLM provider and model role configuration */
  Llm = 'llm',

  /** JWT configuration */
  Jwt = 'jwt',

  /** Mail configuration */
  Mail = 'mail',

  /** OAuth provider configuration */
  OAuth = 'oauth',

  /** Tencent Cloud COS upload configuration */
  TencentCos = 'tencentCos',

  /** JPush notification configuration */
  Jpush = 'jpush',
}
