/**
 * Same-origin mount point of the bull-board queue panel. Kept outside the
 * `/api` prefix and versioning (registered directly on Fastify, like the admin
 * console) so the bundled UI's own relative asset/API paths resolve.
 */
export const QUEUE_PANEL_PATH = '/admin/queues';

/** Prefix of every bull-board JSON API route, under {@link QUEUE_PANEL_PATH}. */
export const QUEUE_PANEL_API_PREFIX = `${QUEUE_PANEL_PATH}/api`;

/** httpOnly cookie the handshake sets so the bundled UI authenticates its own XHRs. */
export const QUEUE_PANEL_COOKIE_NAME = 'lucent_admin_queues';

/** Query parameter accepted once on the HTML entry to mint {@link QUEUE_PANEL_COOKIE_NAME}. */
export const QUEUE_PANEL_TOKEN_QUERY_PARAM = 'access_token';

/**
 * Audit action prefix (`admin.queue.<verb>`), matching the existing `admin.*`
 * audit naming. The verb is the last path segment of the mutation route.
 */
export const QUEUE_PANEL_AUDIT_ACTION_PREFIX = 'admin.queue';

/** Action used when the mutation verb cannot be read from the path. */
export const QUEUE_PANEL_AUDIT_ACTION_FALLBACK = `${QUEUE_PANEL_AUDIT_ACTION_PREFIX}.mutation`;

/** `resource_type` recorded on queue-panel audit entries. */
export const QUEUE_PANEL_AUDIT_RESOURCE_TYPE = 'queue';
