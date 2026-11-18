/**
 * Adapter from the MCP port to the assistant's own tool executor.
 *
 * ## Why this exists
 *
 * The MCP layer needs a way to run a tool; the assistant already has exactly one
 * such way (`AssistantToolService.executeMany`), and everything a tool call must
 * honour lives behind it: the per-tool timeout, the result cache, the empty /
 * timeout metrics, and — most importantly — the proposal envelopes. A second
 * executor written for MCP would drift from that contract, and the drift would
 * show up as a draft being described as an applied write.
 *
 * So this file is a **shape adapter and nothing else**: it turns one MCP call
 * into the one-element call the executor takes, and unwraps the single result.
 * Any behaviour beyond that belongs in the executor, not here.
 *
 * ## What identity means here
 *
 * `AssistantToolExecutionContext` wants a `userId`. The exposed tools are the
 * knowledge group, whose `requiredSources` are all empty — they read no
 * per-user rows. The MCP caller's `subject` is therefore passed through as the
 * `userId` so that tool-level caches and logs stay attributable, but nothing in
 * these tools filters on it.
 *
 * That is a load-bearing property, not a coincidence: it is asserted in
 * `domain/mcp/exposure.ts` by construction (only empty-source tools are listed),
 * and `mcp-exposure.spec.ts` pins it so a future addition cannot quietly start
 * reading user data over an unauthenticated-for-users channel.
 */
import { Injectable, Logger } from '@nestjs/common';
import type { AssistantToolExecutionContext } from '../../application/ports/assistant.js';
import type {
  McpToolCallRequest,
  McpToolExecutionPort,
} from '../../application/ports/mcp.js';
import type { AssistantToolExecutionResult } from '../../application/ports/assistant.js';
import { AssistantToolService } from '../acl/tool-executor.js';

/** Locale for MCP-originated calls. */
const MCP_LOCALE = 'zh-CN';

@Injectable()
export class McpToolExecutionAdapter implements McpToolExecutionPort {
  private readonly logger = new Logger(McpToolExecutionAdapter.name);

  constructor(private readonly toolService: AssistantToolService) {}

  async execute(
    request: McpToolCallRequest,
  ): Promise<AssistantToolExecutionResult | undefined> {
    const context: AssistantToolExecutionContext = {
      // Attribution only — see the header note about empty required sources.
      userId: request.caller.subject,
      locale: MCP_LOCALE,
      // The exposed tools take their input from `toolArgs`, never from prose.
      // An empty string is therefore correct rather than a placeholder: any tool
      // that started reading `userMessage` would fail loudly here instead of
      // quietly parsing something it was never given.
      userMessage: '',
      enabledContextSources: [],
      memoryEnabled: false,
      toolArgs: request.args,
    };

    const results = await this.toolService.executeMany(context, [
      { name: request.toolName, args: request.args },
    ]);

    const [result] = results;
    if (result == null) {
      this.optionsLogMissing(request);
      return undefined;
    }
    return result;
  }

  private optionsLogMissing(request: McpToolCallRequest): void {
    this.logger.error(
      `MCP tool "${request.toolName}" produced no result (requestId=${request.caller.requestId}).`,
    );
  }
}
