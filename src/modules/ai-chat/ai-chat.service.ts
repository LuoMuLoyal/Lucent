import { Injectable } from '@nestjs/common';
import type { AiChatFoundationCapabilities } from './ai-chat.types';
import { AiChatAgentService } from './agent/ai-chat-agent.service';

@Injectable()
export class AiChatService {
  constructor(private readonly aiChatAgentService: AiChatAgentService) {}

  getFoundationCapabilities(): AiChatFoundationCapabilities {
    return this.aiChatAgentService.describeFoundation();
  }
}
