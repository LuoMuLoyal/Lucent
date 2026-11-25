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

  /** Cloudflare Turnstile human-verification configuration */
  Turnstile = 'turnstile',

  /**
   * A2UI generative-surface configuration (the advertised catalog id).
   *
   * Separate from `Llm`: the catalog id is a client/protocol fact, not a model
   * provider setting — a deployment can change one without the other.
   */
  GenerativeSurface = 'generativeSurface',

  /** Tencent Cloud COS upload configuration */
  TencentCos = 'tencentCos',

  /** Aliyun OSS dedicated SDK configuration */
  AliyunOss = 'aliyunOss',

  /** S3-compatible object storage configuration (self-hosted RustFS) */
  S3Storage = 's3Storage',

  /** JPush notification configuration */
  Jpush = 'jpush',
}
