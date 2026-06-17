import { Injectable } from '@nestjs/common';
import type { AiChatToolExecutionResult } from '../ai-chat.types';

@Injectable()
export class AiChatToolContextService {
  buildToolContextBlock(results: readonly AiChatToolExecutionResult[]): string {
    if (results.length === 0) {
      return '';
    }

    const lines = ['Server-approved user context tool results:'];

    for (const result of results) {
      lines.push(`- ${result.name}: ${JSON.stringify(result.data)}`);
    }

    lines.push(
      'Use these facts only as provided. If they are incomplete, say so directly.',
    );

    return lines.join('\n');
  }
}
