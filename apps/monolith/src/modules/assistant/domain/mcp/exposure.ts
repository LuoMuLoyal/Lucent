/**
 * MCP exposure contract (ADR-0024 `domain/`).
 *
 * This module decides **which** tools leave the process. It imports nothing from
 * the MCP SDK, from Nest, or from `adapters/`: the decision is a business rule
 * ("this tool is meaningful to a caller outside Lucent"), and the protocol
 * library is a delivery detail.
 *
 * Layer purity (ADR-0024 rule D1): no imports outside `domain/`.
 */

/**
 * Tools exposed over MCP.
 *
 * The rule is **"does this tool still mean something to a caller outside
 * Lucent?"**, not "is it read-only":
 *
 * - **Included** — the knowledge-retrieval group. It reads no user data, and it
 *   is the capability a knowledge base is for. A caller that has a drug question
 *   and no Lucent session can use it.
 * - **Excluded, user data** — `get_records_*`, `get_medicines`, `get_meal_digest`.
 *   Scoped by `userId`; exporting them widens the authorization surface for no
 *   gain.
 * - **Excluded, proposals** — the `*_draft` tools. They only mean something
 *   inside a conversation with a confirm endpoint; over MCP the draft would have
 *   nowhere to be confirmed, so exporting one splits a state machine in half.
 *
 * Every member must therefore have empty `requiredSources` (asserted in the
 * spec), and that is why this list is maintained by hand rather than derived
 * from `TOOL_NAMES`: a filter over all tools would silently start exporting a
 * future user-data tool the day it is added.
 */
export const MCP_TOOL_NAMES = [
  'search_cn_products',
  'get_cn_product_detail',
  'search_cn_knowledge',
  'resolve_drugbank',
  'get_drugbank_detail',
  'search_drugbank',
  'search_adverse_reactions',
  'reason_ontology',
  'reason_rules',
] as const;

export type McpToolName = (typeof MCP_TOOL_NAMES)[number];

/**
 * Whether a name may be served over MCP.
 *
 * There is **no prefix and no decoration**: the tool name goes on the wire
 * exactly as `TOOL_NAMES` spells it.
 *
 * The MCP specification leaves conflict resolution between servers to the
 * **client**: a proxy or aggregator that mounts several servers is what adds a
 * namespace, precisely so that no server can claim one (`mcp__`, `<server>__`,
 * or otherwise) and spoof another's tools. A server that prefixes its own names
 * therefore ends up double-prefixed on any client that namespaces — the model
 * sees `lucent__search_cn_knowledge_lucent` — and, worse, it has invented a
 * naming scheme that a reader could mistake for a protocol requirement.
 *
 * What the server does owe the client is stability: this set changes only when a
 * tool is genuinely added or removed, never by configuration.
 */
export function isMcpToolName(value: string): value is McpToolName {
  return (MCP_TOOL_NAMES as readonly string[]).includes(value);
}
