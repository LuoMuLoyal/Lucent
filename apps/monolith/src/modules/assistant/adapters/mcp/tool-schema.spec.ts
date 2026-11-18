import { describe, expect, it } from 'vitest';
import type { z } from 'zod';
import { CODE_TOOL_LIMIT_BUDGETS } from '../acl/tools/shared/tool-definitions.js';
import { MCP_TOOL_NAMES, mcpToolName } from '../../domain/mcp/exposure.js';
import { buildMcpToolDescriptors } from './tool-schema.js';

/**
 * The translation these tests guard is JSON Schema → zod.
 *
 * The risk is not that it is hard; it is that a *silently permissive* translation
 * accepts arguments the tool cannot handle, and the failure then surfaces as a
 * runtime error inside a tool instead of a validation error at the boundary.
 */
describe('buildMcpToolDescriptors', () => {
  const descriptors = buildMcpToolDescriptors({
    rawNames: MCP_TOOL_NAMES,
    budgets: CODE_TOOL_LIMIT_BUDGETS,
    exportedNameOf: mcpToolName,
  });

  it('produces one descriptor per exposed tool, in a stable order', () => {
    expect(descriptors.map((descriptor) => descriptor.rawName)).toEqual([
      ...MCP_TOOL_NAMES,
    ]);
  });

  it('carries the assistant’s own description', () => {
    // The description is what the calling model reads to decide whether to use
    // the tool; a second written-for-MCP copy would drift from the one the
    // in-process agent sees.
    const detail = descriptors.find(
      (descriptor) => descriptor.rawName === 'get_drugbank_detail',
    );
    expect(detail?.description.length).toBeGreaterThan(20);
  });

  it('enforces the declared range on a bounded parameter', () => {
    const search = descriptors.find(
      (descriptor) => descriptor.rawName === 'search_cn_medicine_knowledge',
    );
    const schema = search?.inputSchema as z.ZodObject<z.ZodRawShape>;

    // `limit` is advertised with a maximum from the live budget; the same value
    // the server clamps against. Asking above it must fail validation rather
    // than reach the tool.
    expect(
      schema.safeParse({
        query: 'ibuprofen',
        source: 'leaflet',
        limit: CODE_TOOL_LIMIT_BUDGETS.lightragMaxLimit + 1,
      }).success,
    ).toBe(false);

    expect(
      schema.safeParse({
        query: 'ibuprofen',
        source: 'leaflet',
        limit: CODE_TOOL_LIMIT_BUDGETS.lightragMaxLimit,
      }).success,
    ).toBe(true);
  });

  it('requires the parameters the tool actually needs', () => {
    const resolve = descriptors.find(
      (descriptor) => descriptor.rawName === 'resolve_drugbank_entity',
    );
    const schema = resolve?.inputSchema as z.ZodObject<z.ZodRawShape>;

    expect(schema.safeParse({}).success).toBe(false);
    expect(schema.safeParse({ query: 'ibuprofen' }).success).toBe(true);
  });

  it('rejects an enum value the tool does not accept', () => {
    const search = descriptors.find(
      (descriptor) => descriptor.rawName === 'search_cn_medicine_knowledge',
    );
    const schema = search?.inputSchema as z.ZodObject<z.ZodRawShape>;

    expect(
      schema.safeParse({ query: 'ibuprofen', source: 'invented-source' })
        .success,
    ).toBe(false);
  });

  it('accepts an empty object for a no-argument tool', () => {
    const detail = descriptors.find(
      (descriptor) => descriptor.rawName === 'get_drugbank_detail',
    );
    const schema = detail?.inputSchema as z.ZodObject<z.ZodRawShape>;
    expect(schema.safeParse({}).success).toBe(true);
  });
});
