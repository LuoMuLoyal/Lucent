import { describe, expect, it } from 'vitest';
import type { z } from 'zod';
import { CODE_TOOL_LIMIT_BUDGETS } from '../acl/tools/shared/tool-definitions.js';
import { MCP_TOOL_NAMES } from '../../domain/mcp/exposure.js';
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
    toolNames: MCP_TOOL_NAMES,
    budgets: CODE_TOOL_LIMIT_BUDGETS,
  });

  it('produces one descriptor per exposed tool, in a stable order', () => {
    expect(descriptors.map((descriptor) => descriptor.name)).toEqual([
      ...MCP_TOOL_NAMES,
    ]);
  });

  it('carries the assistant’s own description', () => {
    // The description is what the calling model reads to decide whether to use
    // the tool; a second written-for-MCP copy would drift from the one the
    // in-process agent sees.
    const detail = descriptors.find(
      (descriptor) => descriptor.name === 'get_drugbank_detail',
    );
    expect(detail?.description.length).toBeGreaterThan(20);
  });

  it('keeps every description short enough to be read as one line', () => {
    // Anthropic's tool-design guidance: the description is a one-line manpage
    // entry plus disambiguating hints. The two former giants (775 and 699 chars)
    // carried the output contract, which belongs on the returned data.
    for (const descriptor of descriptors) {
      expect(descriptor.description.length).toBeLessThanOrEqual(400);
    }
  });

  it('names a sibling tool, so a wrong-tool call is preventable by reading', () => {
    // The third clause of the template: a description that only says what the
    // tool does leaves near-neighbours indistinguishable. Every exposed tool
    // here has at least one sibling it can be confused with, so each description
    // names the one to reach for instead.
    for (const descriptor of descriptors) {
      const siblings = MCP_TOOL_NAMES.filter((name) => name !== descriptor.name);
      const named = siblings.some((sibling) =>
        descriptor.description.includes(sibling),
      );
      expect(named).toBe(true);
    }
  });

  it('marks every exposed tool read-only and non-destructive', () => {
    // These are the annotations a host uses to decide whether a call needs a
    // confirmation prompt. Every exposed tool is a lookup over a catalogue, an
    // index or a graph, so both hints are factual rather than optimistic.
    for (const descriptor of descriptors) {
      expect(descriptor.annotations.readOnlyHint).toBe(true);
      expect(descriptor.annotations.destructiveHint).toBe(false);
      expect(descriptor.annotations.idempotentHint).toBe(true);
      expect(descriptor.annotations.title.length).toBeGreaterThan(0);
    }
  });

  it('enforces the declared range on a bounded parameter', () => {
    const search = descriptors.find(
      (descriptor) => descriptor.name === 'search_cn_knowledge',
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
      (descriptor) => descriptor.name === 'resolve_drugbank',
    );
    const schema = resolve?.inputSchema as z.ZodObject<z.ZodRawShape>;

    expect(schema.safeParse({}).success).toBe(false);
    expect(schema.safeParse({ query: 'ibuprofen' }).success).toBe(true);
  });

  it('rejects an enum value the tool does not accept', () => {
    const search = descriptors.find(
      (descriptor) => descriptor.name === 'search_cn_knowledge',
    );
    const schema = search?.inputSchema as z.ZodObject<z.ZodRawShape>;

    expect(
      schema.safeParse({ query: 'ibuprofen', source: 'invented-source' }).success,
    ).toBe(false);
  });

  it('accepts an empty object for a no-argument tool', () => {
    const detail = descriptors.find(
      (descriptor) => descriptor.name === 'get_drugbank_detail',
    );
    const schema = detail?.inputSchema as z.ZodObject<z.ZodRawShape>;
    expect(schema.safeParse({}).success).toBe(true);
  });
});
