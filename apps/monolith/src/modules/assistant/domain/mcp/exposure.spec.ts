import { describe, expect, it } from 'vitest';
import { MCP_TOOL_NAMES, isMcpToolName } from './exposure.js';
import { TOOL_NAMES, TOOL_REQUIRED_SOURCES } from '../policies/tool-permission.js';

describe('MCP exposure', () => {
  it('exposes only tools that read no user data', () => {
    // The load-bearing property: the MCP endpoint authenticates a *service*, not
    // a user with data sources, so any exported tool that declared a required
    // source would be asking for a permission nothing can grant. This check is
    // what makes that omission safe instead of a latent bug.
    for (const tool of MCP_TOOL_NAMES) {
      expect(TOOL_REQUIRED_SOURCES[tool]).toEqual([]);
    }
  });

  it('never exposes write proposals', () => {
    // A draft only means something inside a conversation with a confirm
    // endpoint. Over MCP it would have nowhere to be confirmed, so exporting one
    // splits a state machine in half.
    for (const tool of MCP_TOOL_NAMES) {
      expect(tool).not.toMatch(/_draft$/);
    }
  });

  it('exposes the whole knowledge-retrieval group', () => {
    expect([...MCP_TOOL_NAMES].sort()).toEqual(
      [
        'get_cn_product_detail',
        'get_drugbank_detail',
        'reason_ontology',
        'reason_rules',
        'resolve_drugbank',
        'search_cn_knowledge',
        'search_cn_products',
        'search_drugbank',
      ].sort(),
    );
  });

  it('uses the tool names verbatim, with no added namespace', () => {
    // Conflict resolution between servers belongs to the *client*: a proxy that
    // mounts several servers adds the namespace, precisely so that no server can
    // claim one. A server that prefixes its own names ends up double-prefixed on
    // any client that namespaces, and invents a scheme a reader could mistake
    // for a protocol requirement.
    for (const tool of MCP_TOOL_NAMES) {
      expect(tool).not.toContain('__');
      expect(TOOL_NAMES).toContain(tool);
    }
  });

  it('keeps every name within the character set and length the spec allows', () => {
    // `[A-Za-z0-9_-]`, and hosts commonly cap far below the protocol's own limit.
    for (const tool of MCP_TOOL_NAMES) {
      expect(tool).toMatch(/^[A-Za-z0-9_-]+$/);
      expect(tool.length).toBeLessThanOrEqual(32);
    }
  });

  it('narrows an arbitrary string to an exposed tool name', () => {
    expect(isMcpToolName('search_cn_knowledge')).toBe(true);

    // A tool that exists but is not exported must not be reachable.
    expect(isMcpToolName('get_today_records')).toBe(false);
    expect(isMcpToolName('create_record_draft')).toBe(false);

    // Nor may a caller smuggle one in by decorating the name.
    expect(isMcpToolName('lucent__search_cn_knowledge')).toBe(false);
    expect(isMcpToolName('search_cn_knowledge__lucent')).toBe(false);
  });
});
