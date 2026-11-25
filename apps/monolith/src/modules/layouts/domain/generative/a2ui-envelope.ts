/**
 * A2UI v1.0 message envelope checks (ADR-0024 domain layer).
 *
 * A2UI 1.0 removed the closed vocabulary this module used to enforce: the
 * client's catalog is now full (Button, TextField, Slider, Modal … all
 * registered) and it is *advertised* by the client with every request, so the
 * server no longer owns a second copy of the component list. What was
 * `surface-policy.ts` — no numbers, no writable actions, findings by id — is
 * gone with the protocol version that motivated it.
 *
 * What remains is the part a server doing structured output still owes its
 * client: the model must produce **well-formed A2UI v1.0 envelopes**. Anything
 * else is not a policy violation but a parse failure, and the client's renderer
 * would reject it message by message with nothing useful on screen.
 *
 * Two things are checked:
 *
 * 1. every message is an object carrying `version: "1.0"` and exactly one of the
 *    six agent-to-renderer body keys;
 * 2. the sequence builds a surface — a `createSurface` exists and some component
 *    has `id: "root"`.
 *
 * Pure functions, no I/O, no framework — so every case is a unit test rather
 * than an e2e run against a real model.
 */

/** The protocol version this endpoint emits. */
export const A2UI_PROTOCOL_VERSION = '1.0';

/**
 * Body keys of an agent-to-renderer message in v1.0.
 *
 * Six, not four: v1.0 added bidirectional function calls, so a renderer can be
 * told to answer (`callRendererFunction`) and can receive the answer to a call
 * it made (`agentFunctionResponse`).
 */
export const A2UI_MESSAGE_KEYS = [
  'createSurface',
  'updateComponents',
  'updateDataModel',
  'deleteSurface',
  'callRendererFunction',
  'agentFunctionResponse',
] as const;

export type A2uiMessageKey = (typeof A2UI_MESSAGE_KEYS)[number];

/** Why a produced sequence was rejected. */
export type SurfaceViolationKind =
  | 'invalidMessage'
  | 'wrongVersion'
  | 'noBodyKey'
  | 'missingRoot'
  | 'missingCreateSurface';

/** One reason the sequence was rejected. */
export interface SurfaceViolation {
  readonly kind: SurfaceViolationKind;
  /** Index of the offending message in the sequence, when message-scoped. */
  readonly index?: number | undefined;
  /** Developer-facing detail; never user-facing copy. */
  readonly detail?: string | undefined;
}

/**
 * Checks a produced message sequence.
 *
 * Returns every violation found (empty means the sequence may ship). Reporting
 * all of them rather than the first keeps the log useful.
 */
export function checkSurfaceProduction(
  messages: readonly unknown[],
): SurfaceViolation[] {
  const violations: SurfaceViolation[] = [];

  if (messages.length === 0) {
    return [
      { kind: 'invalidMessage', detail: 'the model produced no messages' },
    ];
  }

  let sawCreateSurface = false;
  let sawRoot = false;

  for (const [index, message] of messages.entries()) {
    if (!isRecord(message)) {
      violations.push({
        kind: 'invalidMessage',
        index,
        detail: `message is not an object: ${typeof message}`,
      });
      continue;
    }

    const version = message['version'];
    if (version !== A2UI_PROTOCOL_VERSION) {
      // A v0.9 envelope here would be accepted by neither the v1.0 renderer
      // (its `@path` bindings differ) nor this server's own schema.
      violations.push({
        kind: 'wrongVersion',
        index,
        detail: `version is ${describe(version)}, expected "${A2UI_PROTOCOL_VERSION}"`,
      });
    }

    const bodyKeys = A2UI_MESSAGE_KEYS.filter((key) => key in message);
    if (bodyKeys.length === 0) {
      violations.push({
        kind: 'noBodyKey',
        index,
        detail: `message has none of ${A2UI_MESSAGE_KEYS.join(' / ')}`,
      });
      continue;
    }
    if (bodyKeys.length > 1) {
      violations.push({
        kind: 'noBodyKey',
        index,
        detail: `message carries ${bodyKeys.join(' + ')}; exactly one is allowed`,
      });
    }

    if (bodyKeys.includes('createSurface')) sawCreateSurface = true;

    const update = message['updateComponents'];
    if (isRecord(update) && Array.isArray(update['components'])) {
      if (update['components'].some((component) => isRoot(component))) {
        sawRoot = true;
      }
    }
    // v1.0 allows the initial tree inside `createSurface` itself.
    const create = message['createSurface'];
    if (isRecord(create) && Array.isArray(create['components'])) {
      if (create['components'].some((component) => isRoot(component))) {
        sawRoot = true;
      }
    }
  }

  if (!sawCreateSurface) {
    violations.push({
      kind: 'missingCreateSurface',
      detail: 'no createSurface message',
    });
  }
  // A surface without a `root` component renders nothing, which looks to the
  // user like "generation produced an empty page".
  if (!sawRoot) {
    violations.push({
      kind: 'missingRoot',
      detail: 'no component has id "root"',
    });
  }

  return violations;
}

function isRoot(component: unknown): boolean {
  return isRecord(component) && component['id'] === 'root';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value != null && !Array.isArray(value);
}

function describe(value: unknown): string {
  return typeof value === 'string' ? `"${value}"` : String(value);
}
