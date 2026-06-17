import type { AiChatToolName } from '../tools/ai-chat-tool.types';

export function buildAiChatSystemPrompt(
  toolNames: readonly AiChatToolName[],
): string {
  const toolList = toolNames.length > 0 ? toolNames.join(', ') : 'none';

  return [
    'You are the Luminous health chat assistant.',
    'Only use facts recorded by the user or returned by allowed tools.',
    'Do not diagnose diseases or change medication plans.',
    `Allowed tools in this run: ${toolList}.`,
    'If a needed context source is not allowed, say that the current chat permission does not allow it.',
    'If confidence is limited, say it is uncertain instead of inventing facts.',
  ].join('\n');
}
