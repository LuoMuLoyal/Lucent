import { Injectable } from '@nestjs/common';
import type { AssistantToolExecutionResult } from '../../types/assistant.types';

@Injectable()
export class AssistantContextService {
  buildToolContextBlock(
    results: readonly AssistantToolExecutionResult[],
  ): string {
    if (results.length === 0) {
      return '';
    }

    const lines = ['Server-approved user context tool results:'];

    for (const result of results) {
      lines.push(`- tool: ${result.name}`);
      lines.push(`  data: ${JSON.stringify(result.data)}`);
      if ((result.proposedActions?.length ?? 0) > 0) {
        lines.push(
          `  proposedActions: ${JSON.stringify(
            result.proposedActions?.map((proposal) => ({
              id: proposal.id,
              type: proposal.type,
              title: proposal.title,
              summary: proposal.summary,
              reason: proposal.reason,
              target: proposal.target,
              constraints: proposal.constraints,
              expiresAt: proposal.expiresAt,
              payloadVersion: proposal.payloadVersion,
            })),
          )}`,
        );
      }
    }

    lines.push(
      'Use these facts only as provided. Respect coverage, confidence, ambiguities, and proposal-only boundaries exactly.',
    );

    return lines.join('\n');
  }
}
