/**
 * Ports for the MCP delivery layer (ADR-0024 `application/ports`).
 *
 * The MCP adapter needs exactly two things from the rest of the system, and both
 * already exist — so these are narrow interfaces declared here rather than a new
 * mechanism:
 *
 * 1. **An executor.** The same `executeMany` the in-process agent uses. Proposal
 *    envelopes, per-tool timeouts, result caching and metrics live behind it; a
 *    second executor built for MCP would drift, and the drift shows up as a draft
 *    being described as an applied write.
 * 2. **A caller identity.** Every exposed tool answers a question about a
 *    *source*, not about a person, so identity is not used for row filtering —
 *    it is used for auditing who read what, and for rejecting calls that carry no
 *    identity at all.
 */
import type {
  AssistantToolCall,
  AssistantToolExecutionResult,
} from './assistant.js';

/** What the MCP layer may ask the assistant to do. */
export interface McpToolExecutionPort {
  /**
   * Runs one tool.
   *
   * Returns the single result for that call. The executor contracts one result
   * per call, so an empty array is a broken contract rather than "no results" —
   * callers must surface it as an error, never as an empty success.
   */
  execute(
    tool: McpToolCallRequest,
  ): Promise<AssistantToolExecutionResult | undefined>;
}

/** One inbound call, already validated and mapped to an internal tool name. */
export interface McpToolCallRequest {
  /** The internal tool name (not the exported MCP name). */
  toolName: AssistantToolCall['name'];
  /** Model-supplied arguments, forwarded verbatim. */
  args: Record<string, unknown>;
  /** Who is asking. */
  caller: McpCallerIdentity;
}

/**
 * The authenticated caller.
 *
 * Deliberately minimal: an MCP client is a service, not a user with data
 * sources, so there is no `enabledContextSources` here. The exposed tools
 * require no personal data (asserted in `domain/mcp/exposure.ts`), which is what
 * makes that omission safe rather than an oversight.
 */
export interface McpCallerIdentity {
  /** Stable id for auditing. Empty when the deployment runs without auth. */
  subject: string;
  /** Request correlation id, echoed into logs and error envelopes. */
  requestId: string;
}
