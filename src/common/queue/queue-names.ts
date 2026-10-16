/**
 * Canonical registry of every BullMQ queue Lucent declares.
 *
 * This is the single source for two consumers that must never drift:
 *
 * - Each owning service derives its `QUEUE_NAME` constant from here, so the
 *   `BullmqQueueFactory.createQueue({ name })` call can only use a registered
 *   name (`QueueName` is a literal union).
 * - `src/modules/admin/constants/permissions.ts` derives the per-queue
 *   permission points (`queue:<name>:read` / `queue:<name>:write`) from the
 *   same list, so the admin queue panel can never expose a queue that has no
 *   permission point behind it.
 *
 * Adding a queue: add it here, point the service constant at it, and the
 * permission points appear automatically.
 */
export const QUEUE_NAMES = {
  cron: 'lucent-cron',
  reminderDispatch: 'lucent-reminder-dispatch',
  mail: 'lucent-mail',
  mealAnalysis: 'lucent-meal-analysis',
  dataExport: 'data-export',
  medicineRecognition: 'medicine-recognition',
  todayAnalysis: 'today-analysis',
  clinicSummaryPdf: 'clinic-summary-pdf',
  reportSummary: 'report-summary',
  suggestionCopyGeneration: 'suggestion-copy-generation',
  suggestionExplanation: 'suggestion-explanation',
  suggestionRecompute: 'suggestion-recompute',
} as const;

/** Literal union of every registered BullMQ queue name. */
export type QueueName = (typeof QUEUE_NAMES)[keyof typeof QUEUE_NAMES];

/** Iterable form of {@link QUEUE_NAMES}, for permission/enumeration loops. */
export const QUEUE_NAME_LIST: readonly QueueName[] = Object.values(QUEUE_NAMES);

/** Admin permission point guarding reads of a single queue (`queue:<name>:read`). */
export type QueueReadPermission = `queue:${QueueName}:read`;

/** Admin permission point guarding mutations of a single queue (`queue:<name>:write`). */
export type QueueWritePermission = `queue:${QueueName}:write`;

/** A read or write permission point for a single queue. */
export type QueuePermission = QueueReadPermission | QueueWritePermission;

/** Builds the read permission point for `name`. */
export function queueReadPermission(name: QueueName): QueueReadPermission {
  return `queue:${name}:read`;
}

/** Builds the write permission point for `name`. */
export function queueWritePermission(name: QueueName): QueueWritePermission {
  return `queue:${name}:write`;
}

/** Narrows an arbitrary string to a registered queue name. */
export function isQueueName(value: string): value is QueueName {
  return (QUEUE_NAME_LIST as readonly string[]).includes(value);
}
