import { Injectable } from '@nestjs/common';
import type { AiChatCapabilitiesDataDto } from './dto';
import type { AiChatFoundationCapabilities } from './ai-chat.types';
import { AiChatAgentService } from './agent/ai-chat-agent.service';
import { UserSettingsService } from '../user-settings/user-settings.service';
import type { UserSettingsDataDto } from '../user-settings/dto';
import {
  AI_CHAT_TOOL_SOURCE_MAP,
  AI_CHAT_TOOL_NAMES,
  type AiChatContextSource,
  type AiChatToolDisabledReason,
  type AiChatToolName,
} from './tools/ai-chat-tool.types';

@Injectable()
export class AiChatService {
  constructor(
    private readonly aiChatAgentService: AiChatAgentService,
    private readonly userSettingsService: UserSettingsService,
  ) {}

  getFoundationCapabilities(): AiChatFoundationCapabilities {
    return this.aiChatAgentService.describeFoundation();
  }

  async getCapabilities(userId: string): Promise<AiChatCapabilitiesDataDto> {
    const foundation = this.getFoundationCapabilities();
    const settings = await this.userSettingsService.getSettings(userId);

    return {
      phase: foundation.phase,
      aiChatEnabled: settings.aiChatEnabled,
      aiChatContext: settings.aiChatContext,
      chatModelConfigured: foundation.chatModelConfigured,
      interactiveChatReady: foundation.interactiveChatReady,
      langGraphReady: foundation.langGraphReady,
      streamingSupported: true,
      streamingTransport: 'sse',
      markdownRenderingRecommended: true,
      ragEnabled: foundation.ragEnabled,
      tools: AI_CHAT_TOOL_NAMES.map((toolName) =>
        this.buildToolCapability(toolName, foundation, settings),
      ),
      updatedAt: settings.updatedAt,
    };
  }

  private buildToolCapability(
    toolName: AiChatToolName,
    foundation: AiChatFoundationCapabilities,
    settings: UserSettingsDataDto,
  ) {
    const requiredContextSources = [
      ...AI_CHAT_TOOL_SOURCE_MAP[toolName],
    ] as AiChatContextSource[];
    const permittedByUser =
      settings.aiChatEnabled &&
      requiredContextSources.every((source) =>
        this.isContextSourceEnabled(source, settings),
      );
    const implemented = foundation.implementedToolNames.includes(toolName);
    const enabled =
      permittedByUser && implemented && foundation.chatModelConfigured;

    return {
      name: toolName,
      requiredContextSources,
      permittedByUser,
      implemented,
      enabled,
      disabledReason: enabled
        ? null
        : this.resolveDisabledReason(
            permittedByUser,
            implemented,
            foundation.chatModelConfigured,
            settings.aiChatEnabled,
          ),
    };
  }

  private resolveDisabledReason(
    permittedByUser: boolean,
    implemented: boolean,
    chatModelConfigured: boolean,
    aiChatEnabled: boolean,
  ): AiChatToolDisabledReason {
    if (!aiChatEnabled) {
      return 'chat_disabled';
    }
    if (!permittedByUser) {
      return 'context_disabled';
    }
    if (!chatModelConfigured) {
      return 'model_not_configured';
    }
    if (!implemented) {
      return 'not_implemented';
    }
    return 'not_implemented';
  }

  private isContextSourceEnabled(
    source: AiChatContextSource,
    settings: UserSettingsDataDto,
  ): boolean {
    switch (source) {
      case 'health_profile':
        return settings.aiChatContext.healthProfile;
      case 'daily_records':
        return settings.aiChatContext.dailyRecords;
      case 'sleep_records':
        return settings.aiChatContext.sleepRecords;
      case 'current_medicines':
        return settings.aiChatContext.currentMedicines;
    }
  }
}
