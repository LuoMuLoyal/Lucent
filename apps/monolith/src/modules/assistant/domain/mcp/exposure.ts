/**
 * MCP exposure contract (ADR-0024 `domain/`).
 *
 * This module decides **which** tools leave the process and **what their
 * exported names are**. It imports nothing from the MCP SDK, from Nest, or from
 * `adapters/`: the decision is a business rule ("this tool is meaningful to a
 * caller outside Lucent"), and the protocol library is a delivery detail.
 *
 * Layer purity (ADR-0024 rule D1): no imports outside `domain/`.
 */

/** Countersign for MCP tool names. Fixed: the name is part of the wire contract. */
export const MCP_SERVER_NAME = 'lucent';

/**
 * Tools exposed over MCP.
 *
 * The rule is **"does this tool still mean something to a caller outside
 * Lucent?"**, not "is it read-only":
 *
 * - **Included** — the knowledge-retrieval group. It reads no user data, and it
 *   is the capability a knowledge base is for. A caller that has a drug question
 *   and no Lucent session can use it.
 * - **Excluded, user data** — `get_records_*`, `get_current_medicines`,
 *   `get_meal_analysis_digest`. Scoped by `userId`; exporting them widens the
 *   authorization surface for no gain.
 * - **Excluded, proposals** — `propose_*`. They only mean something inside a
 *   conversation with a confirm endpoint; over MCP the draft would have nowhere
 *   to be confirmed, so exporting one splits a state machine in half.
 *
 * Every member must therefore have empty `requiredSources` (asserted below), and
 * that is why this list is maintained by hand rather than derived from
 * `TOOL_NAMES`: a filter over all tools would silently start exporting a future
 * user-data tool the day it is added.
 */
export const MCP_TOOL_NAMES = [
  'search_cn_medicine_products',
  'get_cn_medicine_detail',
  'search_cn_medicine_knowledge',
  'resolve_drugbank_entity',
  'get_drugbank_detail',
  'search_drugbank_passages',
  'reason_over_ontology',
  'reason_over_rules',
] as const;

export type McpToolName = (typeof MCP_TOOL_NAMES)[number];

/**
 * Builds the exported name for a tool.
 *
 * A **pure function of its two arguments**, which is the whole point: session
 * history, permission rules and client caches key on this string, so any
 * runtime-varying component (a version, a counter, the remote's own advertised
 * name) would silently invalidate them. The MCP spec restricts tool names to
 * `[A-Za-z0-9_-]`, so the `__` separator is valid.
 */
export function mcpToolName(rawName: string): string {
  return `${MCP_SERVER_NAME}__${rawName}`;
}

/**
 * Reverses {@link mcpToolName}, or `null` when the name was not minted here.
 *
 * Needed because an inbound `tools/call` arrives as a string. Returning `null`
 * rather than throwing keeps the caller in charge of the protocol-level error.
 */
export function parseMcpToolName(exported: string): McpToolName | null {
  const prefix = `${MCP_SERVER_NAME}__`;
  if (!exported.startsWith(prefix)) {
    return null;
  }
  const raw = exported.slice(prefix.length);
  return (MCP_TOOL_NAMES as readonly string[]).includes(raw)
    ? (raw as McpToolName)
    : null;
}
