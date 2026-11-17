/**
 * A2UI message admission policy (ADR-0024 domain layer).
 *
 * This is the **last gate** before a model-produced tree reaches the client.
 * It exists because the prompt is advice, not a guarantee: a model can ignore
 * every instruction and emit a `Button`, invent a `7600`, or rewrite a medical
 * finding. The prompt makes violations unlikely; this file makes them
 * impossible to ship.
 *
 * Three rules, each closing one risk from the plan:
 *
 * 1. **No numbers.** `metric_card` / `trend_chart` / `finding` accept reference
 *    keys only. A numeric property anywhere in a domain component is treated as
 *    a fabricated health value — the single most dangerous output class here.
 * 2. **Closed vocabulary.** Only the primitives and domain components the client
 *    registered may appear. `Button` / `TextField` / `Modal` etc. do not exist
 *    in the catalog, so they are rejected even before rendering.
 * 3. **Finding text is by id.** A `finding` component may carry `findingId`
 *    and nothing else; the text is rendered verbatim from the backend.
 *
 * Pure functions, no I/O, no framework — so every adversarial case is a unit
 * test rather than an e2e run against a real model.
 */

/** Display primitives the client renders (mirrors its generative catalog). */
export const A2UI_PRIMITIVES = [
  'Text',
  'Card',
  'Column',
  'Row',
  'List',
  'Divider',
  'Icon',
  'Image',
] as const;

/**
 * Domain components whose values are looked up client-side from reference keys.
 *
 * Mirrors `GenerativeItemNames` in `Luminous/lib/features/generative/domain/services/item_catalog.dart`.
 */
export const A2UI_DOMAIN_COMPONENTS = [
  'metric_card',
  'trend_chart',
  'finding',
] as const;

/** Every component type the client can render. */
export const A2UI_ALLOWED_COMPONENTS: ReadonlySet<string> = new Set([
  ...A2UI_PRIMITIVES,
  ...A2UI_DOMAIN_COMPONENTS,
]);

/** Reference-key properties a domain component may declare. */
const DOMAIN_COMPONENT_KEYS: Readonly<Record<string, readonly string[]>> = {
  metric_card: ['id', 'component', 'kind', 'range'],
  trend_chart: ['id', 'component', 'kind', 'kinds', 'range'],
  finding: ['id', 'component', 'findingId'],
};

/** Why a produced tree was rejected. */
export type SurfaceViolationKind =
  | 'unexpectedComponent'
  | 'fabricatedNumber'
  | 'unexpectedProperty'
  | 'missingProperty'
  | 'invalidMessage';

/** One reason the tree was rejected. */
export interface SurfaceViolation {
  readonly kind: SurfaceViolationKind;
  /** Component id (`root`, `c1`, …) when the violation is component-scoped. */
  readonly componentId?: string | undefined;
  /** Component type (`metric_card`, `Button`, …) when known. */
  readonly componentType?: string | undefined;
  /** Property the violation is about, when applicable. */
  readonly property?: string | undefined;
  /** Developer-facing detail; never user-facing copy. */
  readonly detail?: string | undefined;
}

/** A2UI message shapes we accept. */
const MESSAGE_KEYS = [
  'createSurface',
  'updateComponents',
  'updateDataModel',
  'deleteSurface',
] as const;

/**
 * Extracts the component definitions from a message sequence.
 *
 * Only `updateComponents` carries components; `createSurface` sets up the
 * surface and `updateDataModel` carries data, which a domain component never
 * needs — its values come from client state keyed by the reference properties.
 */
function collectComponents(
  messages: readonly unknown[],
): Record<string, unknown>[] {
  const components: Record<string, unknown>[] = [];
  for (const message of messages) {
    if (!isRecord(message)) continue;
    const update = message['updateComponents'];
    if (!isRecord(update)) continue;
    const list = update['components'];
    if (!Array.isArray(list)) continue;
    for (const entry of list) {
      if (isRecord(entry)) components.push(entry);
    }
  }
  return components;
}

/**
 * Checks a produced message sequence against the admission policy.
 *
 * Returns every violation found (empty means the tree may ship). Reporting all
 * of them rather than the first keeps the log useful: a model that invents a
 * number usually invents several.
 */
export function checkSurfaceProduction(
  messages: readonly unknown[],
): SurfaceViolation[] {
  const violations: SurfaceViolation[] = [];

  if (messages.length === 0) {
    return [
      {
        kind: 'invalidMessage',
        detail: 'the model produced no messages',
      },
    ];
  }

  for (const message of messages) {
    if (!isRecord(message)) {
      violations.push({
        kind: 'invalidMessage',
        detail: `message is not an object: ${typeof message}`,
      });
      continue;
    }
    if (!MESSAGE_KEYS.some((key) => key in message)) {
      violations.push({
        kind: 'invalidMessage',
        detail: `message has none of ${MESSAGE_KEYS.join(' / ')}`,
      });
    }
  }

  // A surface without a `root` component renders nothing, which would look to
  // the user like "generation produced an empty page".
  const components = collectComponents(messages);
  if (!components.some((component) => component['id'] === 'root')) {
    violations.push({
      kind: 'invalidMessage',
      detail: 'no component has id "root"',
    });
  }

  for (const component of components) {
    violations.push(...checkComponent(component));
  }

  return violations;
}

/** Checks one component definition. */
function checkComponent(
  component: Record<string, unknown>,
): SurfaceViolation[] {
  const id = typeof component['id'] === 'string' ? component['id'] : undefined;
  const type = component['component'];
  const componentType = typeof type === 'string' ? type : undefined;

  if (componentType == null) {
    return [
      {
        kind: 'invalidMessage',
        componentId: id,
        detail: 'component has no "component" discriminator',
      },
    ];
  }

  if (!A2UI_ALLOWED_COMPONENTS.has(componentType)) {
    return [
      {
        kind: 'unexpectedComponent',
        componentId: id,
        componentType,
        detail: `"${componentType}" is not in the catalog`,
      },
    ];
  }

  // Primitives are the client's own widgets; their property shapes are governed
  // by the catalog schema it already enforces at render time. Only domain
  // components carry health-data semantics, so only they need the strict rules.
  const allowed = DOMAIN_COMPONENT_KEYS[componentType];
  if (allowed == null) return [];

  return checkDomainComponent(component, componentType, allowed, id);
}

/** Applies the reference-key-only rules to a domain component. */
function checkDomainComponent(
  component: Record<string, unknown>,
  componentType: string,
  allowedKeys: readonly string[],
  id: string | undefined,
): SurfaceViolation[] {
  const violations: SurfaceViolation[] = [];
  const allowed = new Set(allowedKeys);

  for (const [key, value] of Object.entries(component)) {
    if (!allowed.has(key)) {
      violations.push({
        kind: 'unexpectedProperty',
        componentId: id,
        componentType,
        property: key,
        detail: `"${key}" is not allowed on ${componentType}`,
      });
      continue;
    }

    // Any number anywhere is treated as a fabricated health value. There is no
    // legitimate numeric property on a domain component: the real values live
    // in the client's own state and are looked up by reference key.
    if (containsNumber(value)) {
      violations.push({
        kind: 'fabricatedNumber',
        componentId: id,
        componentType,
        property: key,
        detail: `"${key}" contains a number; domain components accept reference keys only`,
      });
    }
  }

  // `metric_card` and `finding` need their reference key; `trend_chart`
  // accepts either `kind` or `kinds`.
  if (componentType === 'trend_chart') {
    if (!('kind' in component) && !('kinds' in component)) {
      violations.push({
        kind: 'missingProperty',
        componentId: id,
        componentType,
        property: 'kind|kinds',
      });
    }
  } else {
    const required = componentType === 'metric_card' ? 'kind' : 'findingId';
    if (!(required in component)) {
      violations.push({
        kind: 'missingProperty',
        componentId: id,
        componentType,
        property: required,
      });
    }
  }

  return violations;
}

/** True when `value` is or contains a number at any depth. */
function containsNumber(value: unknown): boolean {
  if (typeof value === 'number') return true;
  if (Array.isArray(value)) return value.some(containsNumber);
  if (isRecord(value)) return Object.values(value).some(containsNumber);
  return false;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value != null && !Array.isArray(value);
}
