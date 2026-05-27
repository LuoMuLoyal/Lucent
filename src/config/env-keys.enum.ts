/**
 * Environment variable keys.
 *
 * Every key accessed via process.env or ConfigService should be listed here.
 * This avoids magic strings scattered across the codebase.
 */
export enum EnvKey {
  /** Runtime environment: development | test | production */
  NODE_ENV = 'NODE_ENV',

  /** Server listen host */
  HOST = 'HOST',

  /** Server listen port */
  PORT = 'PORT',

  /** CORS origin(s): comma-separated or * */
  CORS_ORIGIN = 'CORS_ORIGIN',

  /** PostgreSQL connection string */
  DATABASE_URL = 'DATABASE_URL',

  /** Redis connection string */
  REDIS_URL = 'REDIS_URL',

  /** JWT access token secret */
  JWT_ACCESS_SECRET = 'JWT_ACCESS_SECRET',

  /** JWT refresh token secret */
  JWT_REFRESH_SECRET = 'JWT_REFRESH_SECRET',

  /** JWT access token TTL (e.g. 15m) */
  JWT_ACCESS_TTL = 'JWT_ACCESS_TTL',

  /** JWT refresh token TTL (e.g. 14d) */
  JWT_REFRESH_TTL = 'JWT_REFRESH_TTL',

  /** AI provider identifier */
  AI_PROVIDER = 'AI_PROVIDER',

  /** AI API key */
  AI_API_KEY = 'AI_API_KEY',

  /** AI base URL */
  AI_BASE_URL = 'AI_BASE_URL',

  /** AI text model name */
  AI_TEXT_MODEL = 'AI_TEXT_MODEL',

  /** AI vision model name */
  AI_VISION_MODEL = 'AI_VISION_MODEL',

  /** Winston log level */
  LOG_LEVEL = 'LOG_LEVEL',

  // ── Mail ─────────────────────────────────────────────────────

  /** Mail driver: "log" (console) or "smtp" (real send) */
  MAIL_DRIVER = 'MAIL_DRIVER',

  /** SMTP host */
  MAIL_HOST = 'MAIL_HOST',

  /** SMTP port */
  MAIL_PORT = 'MAIL_PORT',

  /** SMTP username */
  MAIL_USER = 'MAIL_USER',

  /** SMTP password */
  MAIL_PASS = 'MAIL_PASS',

  /** Sender address */
  MAIL_FROM = 'MAIL_FROM',
}
