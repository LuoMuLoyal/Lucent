import { describe, expect, it } from 'vitest';
import {
  MCP_SERVER_NAME,
  MCP_TOOL_NAMES,
  mcpToolName,
  parseMcpToolName,
} from './exposure.js';
import { TOOL_REQUIRED_SOURCES } from '../policies/tool-permission.js';

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
    // A proposal only means something inside a conversation with a confirm
    // endpoint. Over MCP the draft would have nowhere to be confirmed, so
    // exporting one splits a state machine in half.
    for (const tool of MCP_TOOL_NAMES) {
      expect(tool.startsWith('propose_')).toBe(false);
    }
  });

  it('exposes the whole knowledge-retrieval group', () => {
    expect([...MCP_TOOL_NAMES].sort()).toEqual(
      [
        'get_cn_medicine_detail',
        'get_drugbank_detail',
        'reason_over_ontology',
        'reason_over_rules',
        'resolve_drugbank_entity',
        'search_cn_medicine_knowledge',
        'search_cn_medicine_products',
        'search_drugbank_passages',
      ].sort(),
    );
  });

  it('mints a name that only depends on the server and raw name', () => {
    // Session history, client caches and permission rules key on this string, so
    // it must be a pure function — no version, no counter, no remote-advertised
    // name involved.
    expect(mcpToolName('get_drugbank_detail')).toBe(
      `${MCP_SERVER_NAME}__get_drugbank_detail`,
    );
    expect(mcpToolName('get_drugbank_detail')).toBe(
      mcpToolName('get_drugbank_detail'),
    );
  });

  it('uses only characters the spec allows in a tool name', () => {
    for (const tool of MCP_TOOL_NAMES) {
      expect(mcpToolName(tool)).toMatch(/^[A-Za-z0-9_-]+$/);
    }
  });

  it('round-trips every exposed name', () => {
    for (const tool of MCP_TOOL_NAMES) {
      expect(parseMcpToolName(mcpToolName(tool))).toBe(tool);
    }
  });

  it('rejects names it did not mint', () => {
    expect(parseMcpToolName('other__search_cn_medicine_knowledge')).toBeNull();
    expect(
      parseMcpToolName('mcp__lucent__search_cn_medicine_knowledge'),
    ).toBeNull();
    expect(parseMcpToolName('get_today_records')).toBeNull();
  });

  it('rejects a prefixed name for a tool that is not exported', () => {
    // The prefix alone must not grant access: `get_today_records` exists as a
    // tool but is deliberately not exported, and a caller could try to smuggle
    // it in by prefixing it themselves.
    expect(
      parseMcpToolName(`${MCP_SERVER_NAME}__get_today_records`),
    ).toBeNull();
    expect(
      parseMcpToolName(`${MCP_SERVER_NAME}__propose_create_daily_record`),
    ).toBeNull();
  });
});
