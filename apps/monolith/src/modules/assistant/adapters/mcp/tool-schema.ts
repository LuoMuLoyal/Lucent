/**
 * Maps the assistant's JSON Schema tool definitions onto MCP's zod input schemas.
 *
 * ## Why this is a translation and not a second registry
 *
 * `tool-definitions.ts` already declares the JSON Schema the model sees, and the
 * budgets it reads are the same runtime values the server clamps against. Writing
 * a second, hand-maintained zod copy would mean two places to update for one
 * parameter change — and the failure mode is silent: the model would be told a
 * range the server then cuts.
 *
 * The translation is deliberately mechanical. The tool names, descriptions and
 * parameter shapes all come from `buildToolDefinitions`; this module only
 * restates the JSON Schema in zod so the SDK can validate inbound calls.
 *
 * ## What is *not* translated
 *
 * `additionalProperties: false` is preserved on the tools that declare it,
 * because letting an unknown argument through would defeat the validation the
 * JSON Schema already promised.
 */
import { z } from 'zod';
import type { ToolName } from '../../domain/policies/tool-permission.js';
import type { ToolLimitBudgets } from '../acl/tools/shared/tool-definitions.js';
import { buildToolDefinitions } from '../acl/tools/shared/tool-definitions.js';

/** The subset of JSON Schema the assistant's tools actually use. */
interface JsonSchemaNode {
  type?: string;
  description?: string;
  properties?: Record<string, JsonSchemaNode>;
  required?: readonly string[];
  items?: JsonSchemaNode;
  enum?: readonly string[];
  minimum?: number;
  maximum?: number;
  additionalProperties?: boolean;
  default?: unknown;
}

/**
 * Converts one JSON Schema node to zod.
 *
 * Supports exactly the constructs the tool definitions use — string, integer,
 * number, boolean, array, enum, object. Anything else throws: a silently
 * degraded schema would accept arguments the tool cannot handle, and the miss
 * would surface as a runtime error inside a tool instead of a validation error
 * at the boundary.
 */
function toZod(schema: JsonSchemaNode): z.ZodType {
  if (schema.enum != null) {
    const values = schema.enum;
    return z.enum(values as [string, ...string[]]);
  }

  switch (schema.type) {
    case 'string':
      return z.string();

    case 'integer': {
      let number = z.number().int();
      if (schema.minimum != null) number = number.min(schema.minimum);
      if (schema.maximum != null) number = number.max(schema.maximum);
      return number;
    }

    case 'number': {
      let number = z.number();
      if (schema.minimum != null) number = number.min(schema.minimum);
      if (schema.maximum != null) number = number.max(schema.maximum);
      return number;
    }

    case 'boolean':
      return z.boolean();

    case 'array':
      // `items` is always present in the assistant's definitions when a
      // parameter is an array; a missing one is a definition bug worth surfacing.
      if (schema.items == null) {
        // Not a domain failure and not a client error: it means the tool
        // definition itself is malformed, which is a programming error. The lint
        // rule exists so such cases are not routed through the HTTP error
        // contract that clients can act on.
        // eslint-disable-next-line error-handling/no-bare-throw-error -- malformed tool definition is a programming error, not an API failure
        throw new Error('Array parameter declared without `items`.');
      }
      return z.array(toZod(schema.items));

    case 'object': {
      const shape: Record<string, z.ZodType> = {};
      const required = new Set(schema.required ?? []);
      for (const [key, value] of Object.entries(schema.properties ?? {})) {
        let field = toZod(value);
        if (value.description != null) {
          field = field.describe(value.description);
        }
        shape[key] = required.has(key) ? field : field.optional();
      }
      return z.object(shape);
    }

    default:
      // eslint-disable-next-line error-handling/no-bare-throw-error -- unsupported JSON Schema construct is a programming error in the tool definition
      throw new Error(
        `Unsupported JSON Schema node in an MCP tool definition: ${JSON.stringify(schema)}`,
      );
  }
}

/** An MCP-ready tool: exported name, internal name, description, zod schema. */
export interface McpToolDescriptor {
  /** The name exposed over the wire (`lucent__<raw>`). */
  exportedName: string;
  /** The internal name used with the executor. */
  rawName: ToolName;
  description: string;
  inputSchema: z.ZodType;
}

/**
 * Builds the descriptors for the given internal tool names.
 *
 * Callers pass `domain/mcp/exposure.ts`'s `MCP_TOOL_NAMES`, so the *set* of
 * exposed tools stays a domain decision while the *shapes* come from the single
 * existing definition source.
 */
export function buildMcpToolDescriptors(options: {
  rawNames: readonly ToolName[];
  budgets: ToolLimitBudgets;
  exportedNameOf: (rawName: string) => string;
}): McpToolDescriptor[] {
  const definitions = buildToolDefinitions(options.rawNames, options.budgets);

  return definitions.map((definition) => {
    const rawName = definition.function.name as ToolName;
    const parameters = definition.function.parameters as JsonSchemaNode;
    // Every tool declares an object schema, including the no-argument ones
    // (`{ type: 'object', properties: {} }`), so this cast is total.
    return {
      exportedName: options.exportedNameOf(rawName),
      rawName,
      description: definition.function.description,
      inputSchema: toZod(parameters),
    };
  });
}
