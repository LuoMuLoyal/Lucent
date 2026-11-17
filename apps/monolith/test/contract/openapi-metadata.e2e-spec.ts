import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';

/**
 * OpenAPI response-metadata gate.
 *
 * The request-side migration to zod 4 dropped the `example` / `nullable`
 * semantics the former `@ApiProperty` DTOs carried. A DTO field can restore
 * them today by chaining zod 4's native `.meta({ example })` (or `.examples`)
 * onto the schema, and `.nullable()` already emits `nullable: true`.
 *
 * This suite guards against a new response DTO bypassing that convention: for
 * every success (2xx) JSON response in the committed OpenAPI document, the
 * referenced component schema must contain at least one `example` / `examples`
 * or an explicit `nullable: true` anywhere in its subtree (following `$ref`s).
 *
 * It reads only `docs/reference/generated/openapi.json` — no app bootstrap, no
 * infrastructure — so it runs as part of the contract suite without a database.
 */

interface OpenApiDocument {
  paths?: Record<string, Record<string, unknown>>;
  components?: { schemas?: Record<string, JsonSchema> };
}

interface JsonSchema {
  type?: string;
  $ref?: string;
  nullable?: boolean;
  example?: unknown;
  examples?: unknown;
  items?: JsonSchema | JsonSchema[];
  properties?: Record<string, JsonSchema>;
  additionalProperties?: boolean | JsonSchema;
  oneOf?: JsonSchema[];
  anyOf?: JsonSchema[];
  allOf?: JsonSchema[];
  [key: string]: unknown;
}

const SUCCESS_CODES = ['200', '201', '202', '203', '204', '205', '206'];
const HTTP_METHODS = [
  'get',
  'post',
  'patch',
  'put',
  'delete',
  'head',
  'options',
];

function loadOpenApiDocument(): OpenApiDocument {
  const specPath = resolve(
    dirname(fileURLToPath(import.meta.url)),
    '../../docs/reference/generated/openapi.json',
  );
  return JSON.parse(readFileSync(specPath, 'utf-8')) as OpenApiDocument;
}

function componentName(ref: string): string | undefined {
  return /#\/components\/schemas\/(.+)$/.exec(ref)?.[1];
}

/**
 * True when the schema (or any schema reachable through `$ref` / nested
 * schemas) declares an `example`/`examples` or an explicit `nullable: true`.
 */
function hasMetadata(
  schema: JsonSchema | undefined,
  schemas: Record<string, JsonSchema>,
  seen = new Set<string>(),
): boolean {
  if (!schema || typeof schema !== 'object') return false;
  if (schema.example !== undefined || schema.examples !== undefined)
    return true;
  if (schema.nullable === true) return true;

  if (typeof schema.$ref === 'string') {
    const name = componentName(schema.$ref);
    if (!name || seen.has(name)) return false;
    seen.add(name);
    return hasMetadata(schemas[name], schemas, seen);
  }

  if (Array.isArray(schema.items)) {
    if (schema.items.some((item) => hasMetadata(item, schemas, seen))) {
      return true;
    }
  } else if (hasMetadata(schema.items, schemas, seen)) {
    return true;
  }

  const maps: Array<Record<string, JsonSchema> | undefined> = [
    schema.properties,
  ];
  for (const map of maps) {
    if (!map) continue;
    if (Object.values(map).some((child) => hasMetadata(child, schemas, seen))) {
      return true;
    }
  }

  if (typeof schema.additionalProperties === 'object') {
    if (hasMetadata(schema.additionalProperties, schemas, seen)) return true;
  }

  for (const key of ['oneOf', 'anyOf', 'allOf'] as const) {
    const branches = schema[key];
    if (Array.isArray(branches)) {
      if (branches.some((branch) => hasMetadata(branch, schemas, seen))) {
        return true;
      }
    }
  }

  return false;
}

describe('OpenAPI response metadata (contract)', () => {
  const document = loadOpenApiDocument();
  const schemas = document.components?.schemas ?? {};

  it('has a populated components.schemas map', () => {
    expect(Object.keys(schemas).length).toBeGreaterThan(20);
  });

  it('every 2xx JSON response schema carries an example or explicit nullable', () => {
    const violations: string[] = [];

    for (const [route, pathItem] of Object.entries(document.paths ?? {})) {
      for (const method of HTTP_METHODS) {
        const operation = pathItem[method] as
          | { responses?: Record<string, unknown> }
          | undefined;
        if (!operation?.responses) continue;

        for (const code of SUCCESS_CODES) {
          const response = operation.responses[code] as
            | { content?: Record<string, { schema?: JsonSchema }> }
            | undefined;
          const schema = response?.content?.['application/json']?.schema;
          if (!schema) continue;

          if (!hasMetadata(schema, schemas)) {
            const label =
              typeof schema.$ref === 'string'
                ? schema.$ref
                : `${method.toUpperCase()} ${route} (inline)`;
            violations.push(
              `${method.toUpperCase()} ${route} [${code}] → ${label}`,
            );
          }
        }
      }
    }

    expect(violations).toEqual([]);
  });
});
