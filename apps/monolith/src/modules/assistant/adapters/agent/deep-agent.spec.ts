import { describe, expect, it, vi } from 'vitest';
import { existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FakeListChatModel } from '@langchain/core/utils/testing';
import { CODE_TOOL_LIMIT_BUDGETS } from '../acl/tools/shared/tool-definitions.js';
import { buildAssistantDeepAgent } from './deep-agent.js';
import { ASSISTANT_SUBAGENTS, ASSISTANT_SUBAGENT_NAMES } from './subagents.js';

/**
 * Assembly-level checks for the deep agent.
 *
 * These do not exercise a live model: what they pin is that the pieces wire up —
 * the executor reaches the model's tool list, the sub-agents are declared, and
 * the run returns the shape the caller reads. Behaviour of the loop itself is
 * deepagents' to own, and `graph.spec.ts` keeps covering the hand-written path
 * that is still in production.
 */
describe('buildAssistantDeepAgent', () => {
  it('assembles an agent that runs and returns messages', async () => {
    const execute = vi.fn().mockResolvedValue([]);
    const conversationId = `conv-deep-${String(Date.now())}`;
    const workspace = join(tmpdir(), `lucent-agent-${conversationId}`);

    try {
      const agent = buildAssistantDeepAgent({
        model: new FakeListChatModel({ responses: ['ok'] }),
        toolNames: ['get_today_records'],
        budgets: CODE_TOOL_LIMIT_BUDGETS,
        execute,
        systemPrompt: 'system',
        conversationId,
      });

      const result = await agent.invoke({
        messages: [{ role: 'user', content: 'hi' }],
      });

      expect(Array.isArray(result.messages)).toBe(true);
      expect(result.messages.length).toBeGreaterThan(0);
      // The turn gets its own scratch directory rather than the repository root.
      expect(existsSync(workspace)).toBe(true);
    } finally {
      rmSync(workspace, { recursive: true, force: true });
    }
  });

  it('declares the domain sub-agents', () => {
    expect(ASSISTANT_SUBAGENT_NAMES).toEqual([
      'knowledge',
      'records',
      'analyst',
    ]);
    // Each needs a description: it is what the model reads to choose one, and a
    // missing one turns `task` delegation into a guess.
    for (const subagent of ASSISTANT_SUBAGENTS) {
      expect(subagent.description.length).toBeGreaterThan(20);
      expect(subagent.systemPrompt).toBeTruthy();
    }
  });

  it('keeps sub-agent capability equal to the parent’s tool set', () => {
    // Sub-agents deliberately declare no `tools`: they inherit the parent's set,
    // so isolation is the context window, not the capabilities. Asserting this
    // catches a future edit that quietly starts narrowing them.
    for (const subagent of ASSISTANT_SUBAGENTS) {
      expect(subagent.tools).toBeUndefined();
    }
  });
});
