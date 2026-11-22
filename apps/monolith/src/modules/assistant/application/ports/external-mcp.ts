/**
 * External MCP client port (ADR-0024 `application/ports`).
 *
 * `adapters/agent` needs the remote tool list and the ability to call one, but
 * it must not import `infrastructure/` (`ddd-adapters-no-infrastructure`). The
 * port names exactly what the runtime needs; the Amap client implements it.
 *
 * ## Discriminated results, never exceptions
 *
 * A map server that is down, misconfigured or slow is an *availability*
 * condition, not an error in the turn. Every method returns an outcome so the
 * caller renders "unavailable" to the model instead of aborting the reply.
 */

/** One tool the remote server advertises. */
export interface RemoteToolDescriptor {
  /** Name exactly as the remote server spells it (`maps_weather`, …). */
  readonly name: string;
  readonly description: string;
  /** JSON Schema of the arguments, as the server published it. */
  readonly inputSchema: Record<string, unknown>;
}

/** Discriminated outcome for a remote call. */
export type RemoteToolCallResult =
  | { readonly ok: true; readonly content: unknown }
  | { readonly ok: false; readonly reason: string };

/** DI token; a string so a Nest resolution error names the port readably. */
export const ASSISTANT_EXTERNAL_MCP = 'ASSISTANT_EXTERNAL_MCP';

/** What the assistant runtime needs from a remote MCP server. */
export abstract class ExternalMcpPort {
  /** Whether the server is enabled *and* reachable credentials exist. */
  abstract isEnabled(): boolean;

  /**
   * The server's tools, already discovered.
   *
   * Returns `[]` (not an error) when disabled or unreachable: the caller's job
   * is then simply to bind no extra tools.
   */
  abstract listTools(): Promise<readonly RemoteToolDescriptor[]>;

  /** Calls one remote tool by its *remote* name (no server prefix). */
  abstract callTool(
    name: string,
    args: Record<string, unknown>,
  ): Promise<RemoteToolCallResult>;
}
