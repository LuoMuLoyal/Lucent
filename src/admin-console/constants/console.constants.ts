/**
 * Same-origin mount point of the built administration SPA. The browser app is
 * built with `base = '/admin/'` and its router uses `/admin` as basepath, so
 * these two constants and `admin/vite.config.ts` must stay in sync.
 */
export const ADMIN_CONSOLE_ROOT_PATH = '/admin';

/** Status returned when a request path has no servable asset behind it. */
export const CONSOLE_NOT_FOUND_STATUS = 404;

/** Content types for the asset kinds a Vite production build emits. */
export const CONSOLE_CONTENT_TYPES: Readonly<Record<string, string>> = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

/** Hashed Vite assets are content-addressed, so a long immutable cache is safe. */
export const CONSOLE_IMMUTABLE_CACHE_CONTROL =
  'public, max-age=31536000, immutable';

/** `index.html` is the SPA entry point and must never be cached. */
export const CONSOLE_INDEX_CACHE_CONTROL = 'no-cache';
