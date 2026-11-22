/**
 * External (remote MCP) tools — a separate noun from built-in tools.
 *
 * ## Why not in `TOOL_NAMES`
 *
 * `TOOL_NAMES` is paired with `TOOL_REQUIRED_SOURCES` under
 * `satisfies Record<ToolName, …>`: every built-in tool must *declare which of
 * the user's data sources it reads*. A remote map tool reads none of them.
 * Folding it into that table would mean writing a fake answer for every
 * external tool, and the table's meaning would silently drift from
 * "user-data permissions" to "every tool that exists" — which is exactly the
 * gate that stops a future tool from quietly reading health data.
 *
 * So the type systems stay apart:
 *
 * - {@link ExternalToolName} is a plain string, and the compiler cannot
 *   mistake it for a `ToolName`.
 * - Every external tool is, by type, permitted: there is no field to declare
 *   sources on, so "an external tool that reads user data" is unrepresentable.
 *   Promoting one to a built-in is a code change that must pass the exhaustive
 *   check — not a configuration flag.
 *
 * ## Naming
 *
 * External tools travel under a prefix derived from their server name
 * (`amap__maps_weather`). The prefix is a **pure function** of the server name:
 * it is what the model sees on every turn, what the prompt lists, and what the
 * executor dispatches on. A runtime-variable name would break every one of
 * those at once.
 */

/** Server that provides the map/weather tools. */
export const AMAP_MCP_SERVER_NAME = 'amap';

/** Separator between the server prefix and the remote tool name. */
const EXTERNAL_TOOL_SEPARATOR = '__';

/**
 * An external tool name: `<server>__<remote name>`.
 *
 * Deliberately *not* branded: branding it would make every call site cast, and
 * the only place that matters — `TOOL_REQUIRED_SOURCES` — is keyed by
 * `ToolName`, so a plain string already cannot enter it.
 */
export type ExternalToolName = string;

/** Builds the wire name for one remote tool. Pure. */
export function externalToolName(
  serverName: string,
  remoteName: string,
): ExternalToolName {
  return `${serverName}${EXTERNAL_TOOL_SEPARATOR}${remoteName}`;
}

/**
 * Whether `name` belongs to an external server.
 *
 * Checks the separator and a non-empty prefix; it does not validate that the
 * server is one we configured. Callers that need dispatch pair this with the
 * descriptor list they already have.
 */
export function isExternalToolName(name: string): boolean {
  const index = name.indexOf(EXTERNAL_TOOL_SEPARATOR);
  return index > 0 && index < name.length - EXTERNAL_TOOL_SEPARATOR.length;
}

/**
 * Strips the server prefix, yielding the name the remote server knows.
 *
 * The inverse of {@link externalToolName}. Passing a name that has no prefix
 * returns it unchanged rather than throwing: the executor only calls this after
 * {@link isExternalToolName} has already decided the dispatch, so a malformed
 * value here means the two disagreed, and returning the input keeps the failure
 * visible in the remote call rather than as a crash.
 */
export function externalRemoteName(name: string): string {
  const index = name.indexOf(EXTERNAL_TOOL_SEPARATOR);
  return index > 0 ? name.slice(index + EXTERNAL_TOOL_SEPARATOR.length) : name;
}

/** One external tool as the assistant binds it. */
export interface ExternalToolDefinition {
  /** Prefixed name, as the model sees it. */
  readonly name: ExternalToolName;
  /** The server it came from; needed to route the call. */
  readonly serverName: string;
  /** The name on that server. */
  readonly remoteName: string;
  /** Model-facing description, already carrying the server's own text. */
  readonly description: string;
  /** JSON Schema of the arguments, as the server published it. */
  readonly inputSchema: Record<string, unknown>;
}

/**
 * Prefixes a server's advertised tools into assistant-facing definitions.
 *
 * A tool whose prefixed name would collide with an existing definition is
 * **dropped**, not suffixed: silently renaming would make the prompt advertise
 * a name the model cannot call back, and silently overwriting would drop a real
 * tool with no trace. Dropping is visible — the caller sees the shortened list.
 */
export function describeExternalTools(
  serverName: string,
  tools: readonly {
    name: string;
    description: string;
    inputSchema: Record<string, unknown>;
  }[],
  taken: ReadonlySet<string>,
): ExternalToolDefinition[] {
  const definitions: ExternalToolDefinition[] = [];
  const seen = new Set<string>(taken);
  for (const tool of tools) {
    const name = externalToolName(serverName, tool.name);
    if (seen.has(name)) continue;
    seen.add(name);
    definitions.push({
      name,
      serverName,
      remoteName: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema,
    });
  }
  return definitions;
}
