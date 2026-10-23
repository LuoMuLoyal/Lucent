import { isQueueName } from '../../../common/queue/queue-names.js';
import {
  QUEUE_PANEL_API_PREFIX,
  QUEUE_PANEL_AUDIT_ACTION_FALLBACK,
  QUEUE_PANEL_AUDIT_ACTION_PREFIX,
} from '../constants/queue-panel.constants.js';

/** Rejects anything that could break a `Set-Cookie` value or a path segment. */
const UNSAFE_COOKIE_VALUE = /[^\w.\-~+/=]/;

/** Route prefix that carries a queue name in its first segment. */
const QUEUES_API_SEGMENT = `${QUEUE_PANEL_API_PREFIX}/queues`;

/**
 * Mutation verbs bull-board exposes. Scanning for a known verb (rather than
 * taking the last path segment) keeps actions stable across routes that append
 * a parameter, e.g. `.../retry/:queueStatus` and `.../:jobId/retry`.
 */
const QUEUE_MUTATION_VERBS: ReadonlySet<string> = new Set([
  'add',
  'clean',
  'concurrency',
  'delay',
  'empty',
  'obliterate',
  'pause',
  'priority',
  'promote',
  'remove',
  'remove-unprocessed-children',
  'resume',
  'retry',
  'run',
  'update-data',
]);

/** How a queue-panel mutation is attributed in the audit log. */
export interface QueueMutationDescriptor {
  queueName: string | null;
  action: string;
}

/** True for HTTP methods that never mutate state. */
export function isReadMethod(method: string): boolean {
  const upper = method.toUpperCase();
  return upper === 'GET' || upper === 'HEAD' || upper === 'OPTIONS';
}

/** Extracts the token from an `Authorization: Bearer <token>` header. */
export function readBearerToken(header: string | undefined): string | null {
  if (header === undefined) {
    return null;
  }
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match?.[1]?.trim() || null;
}

/** Reads a single string-valued query parameter from a Fastify query object. */
export function readQueryString(
  query: unknown,
  name: string,
): string | null {
  if (typeof query !== 'object' || query === null) {
    return null;
  }
  const value = (query as Record<string, unknown>)[name];
  return typeof value === 'string' && value.length > 0 ? value : null;
}

/** True when `value` is safe to place verbatim in a `Set-Cookie` header. */
export function isSafeCookieValue(value: string): boolean {
  return value.length > 0 && !UNSAFE_COOKIE_VALUE.test(value);
}


/** Removes one query parameter from a request URL, preserving the rest. */
export function stripQueryParam(url: string, name: string): string {
  const parsed = new URL(url, 'http://localhost');
  parsed.searchParams.delete(name);
  return `${parsed.pathname}${parsed.search}`;
}

/** Extracts the pathname from a raw request URL. */
export function pathnameOf(url: string): string {
  return new URL(url, 'http://localhost').pathname;
}

/**
 * Derives the audit descriptor for a queue-panel API mutation from its path.
 *
 * Queue-scoped routes (`/api/queues/:queueName/<verb>`) report the queue name
 * and `admin.queue.<verb>`; global routes (`/api/queues/pause|resume`) report
 * no queue and the `...All` verb. Anything unrecognised falls back to
 * `admin.queue.mutation` so a new bull-board route is still audited.
 */
export function resolveQueueMutation(pathname: string): QueueMutationDescriptor {
  if (
    pathname !== QUEUES_API_SEGMENT &&
    !pathname.startsWith(`${QUEUES_API_SEGMENT}/`)
  ) {
    return { queueName: null, action: QUEUE_PANEL_AUDIT_ACTION_FALLBACK };
  }

  const segments = pathname
    .slice(QUEUES_API_SEGMENT.length)
    .split('/')
    .filter((segment) => segment !== '');
  const [head, ...rest] = segments;
  if (head === undefined) {
    return { queueName: null, action: QUEUE_PANEL_AUDIT_ACTION_FALLBACK };
  }

  if (isQueueName(head)) {
    const verb = rest.find((segment) => QUEUE_MUTATION_VERBS.has(segment));
    return {
      queueName: head,
      action:
        verb === undefined
          ? QUEUE_PANEL_AUDIT_ACTION_FALLBACK
          : `${QUEUE_PANEL_AUDIT_ACTION_PREFIX}.${verb}`,
    };
  }

  // Global route: `pause` / `resume` apply to every visible queue.
  return {
    queueName: null,
    action: QUEUE_MUTATION_VERBS.has(head)
      ? `${QUEUE_PANEL_AUDIT_ACTION_PREFIX}.${head}All`
      : QUEUE_PANEL_AUDIT_ACTION_FALLBACK,
  };
}
