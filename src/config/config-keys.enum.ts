/**
 * NestJS ConfigService namespace keys.
 *
 * Used with @nestjs/config `registerAs()` and `configService.get()`.
 */
export enum ConfigKey {
  /** Application-level configuration (host, port, cors, etc.) */
  App = 'app',

  /** Mail configuration */
  Mail = 'mail',
}
