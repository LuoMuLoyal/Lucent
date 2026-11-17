import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  A2UI_DOMAIN_COMPONENTS,
  A2UI_PRIMITIVES,
} from '../../src/modules/layouts/domain/generative/surface-policy.js';

/**
 * Vocabulary parity with the client.
 *
 * The server prompt tells the model which components exist. The client only
 * renders the ones in its own catalog. If the two drift, one of two things
 * happens silently:
 *
 * - the server offers a component the client cannot render → the user sees a
 *   fallback box where a card should be;
 * - the client has one the server never offers → it is dead weight.
 *
 * Neither fails to compile, which is exactly why this test exists. The client
 * declares its vocabulary in `item_catalog.dart` (domain components) and
 * `catalog.dart` (primitives); both are read here rather than duplicated.
 *
 * Skipped when the sibling checkout is absent (server-only CI), because the
 * dependency is a workspace arrangement, not a build requirement.
 */

const WORKSPACE_ROOT = join(process.cwd(), '..');
const CLIENT_ITEM_CATALOG = join(
  WORKSPACE_ROOT,
  'Luminous',
  'lib',
  'features',
  'generative',
  'domain',
  'services',
  'item_catalog.dart',
);
const CLIENT_RENDER_CATALOG = join(
  WORKSPACE_ROOT,
  'Luminous',
  'lib',
  'core',
  'composition',
  'genui',
  'catalog.dart',
);

function readIfPresent(path: string): string | null {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return null;
  }
}

/** Extracts `static const <name> = '<value>';` string constants. */
function dartStringConstants(source: string): string[] {
  return [...source.matchAll(/static const \w+ = '([^']+)';/g)].map(
    (match) => match[1] ?? '',
  );
}

/** Extracts `BasicCatalogItems.<name>` references from the primitive list. */
function dartPrimitiveNames(source: string): string[] {
  return [...source.matchAll(/BasicCatalogItems\.(\w+),/g)].map(
    (match) => match[1] ?? '',
  );
}

const clientItemCatalog = readIfPresent(CLIENT_ITEM_CATALOG);
const clientRenderCatalog = readIfPresent(CLIENT_RENDER_CATALOG);
const hasClient = clientItemCatalog != null && clientRenderCatalog != null;

describe.skipIf(!hasClient)('generative vocabulary parity', () => {
  it('domain components match the client item catalog', () => {
    const clientNames = dartStringConstants(clientItemCatalog!).sort();
    expect([...A2UI_DOMAIN_COMPONENTS].sort()).toEqual(clientNames);
  });

  it('primitives match the client render catalog', () => {
    // The client lists primitives by their `BasicCatalogItems` field name,
    // which is the camelCase form of the A2UI type (`text` -> `Text`).
    const clientPrimitives = dartPrimitiveNames(clientRenderCatalog!)
      .map((name) => name.charAt(0).toUpperCase() + name.slice(1))
      .sort();
    expect([...A2UI_PRIMITIVES].sort()).toEqual(clientPrimitives);
  });

  it('every domain component is also an allowed component', () => {
    // Guards the union in `A2UI_ALLOWED_COMPONENTS`: adding a name to one list
    // and forgetting the union would reject it at admission time.
    for (const name of A2UI_DOMAIN_COMPONENTS) {
      expect(A2UI_PRIMITIVES).not.toContain(name);
    }
  });
});
