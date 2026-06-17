import { Injectable } from '@nestjs/common';
import type { UserSettingsDataDto } from '../user-settings/dto';
import { selectAllowedToolsForContextSources } from './agent/ai-chat-agent.graph';
import type {
  AiChatFoundationCapabilities,
  AiChatPolicySnapshot,
  AiChatToolCapabilitySnapshot,
} from './ai-chat.types';
import {
  AI_CHAT_CONTEXT_SOURCES,
  AI_CHAT_TOOL_NAMES,
  AI_CHAT_TOOL_SOURCE_MAP,
  type AiChatContextSource,
  type AiChatToolDisabledReason,
  type AiChatToolName,
} from './tools/ai-chat-tool.types';

@Injectable()
export class AiChatPolicyService {
  evaluate(
    foundation: AiChatFoundationCapabilities,
    settings: UserSettingsDataDto,
  ): AiChatPolicySnapshot {
    const enabledContextSources = AI_CHAT_CONTEXT_SOURCES.filter((source) =>
      this.isContextSourceEnabled(source, settings),
    );
    const contextPermittedToolNames = settings.aiChatEnabled
      ? selectAllowedToolsForContextSources(enabledContextSources)
      : [];
    const executableToolNames = contextPermittedToolNames.filter((toolName) =>
      foundation.implementedToolNames.includes(toolName),
    );

    return {
      interactiveChatReady:
        settings.aiChatEnabled && foundation.interactiveChatReady,
      enabledContextSources,
      contextPermittedToolNames,
      executableToolNames,
      toolCapabilities: AI_CHAT_TOOL_NAMES.map((toolName) =>
        this.buildToolCapability(
          toolName,
          foundation,
          settings,
          contextPermittedToolNames,
        ),
      ),
    };
  }

  private buildToolCapability(
    toolName: AiChatToolName,
    foundation: AiChatFoundationCapabilities,
    settings: UserSettingsDataDto,
    contextPermittedToolNames: readonly AiChatToolName[],
  ): AiChatToolCapabilitySnapshot {
    const requiredContextSources = [
      ...AI_CHAT_TOOL_SOURCE_MAP[toolName],
    ] as AiChatContextSource[];
    const permittedByUser =
      settings.aiChatEnabled && contextPermittedToolNames.includes(toolName);
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
            settings.aiChatEnabled,
            permittedByUser,
            implemented,
            foundation.chatModelConfigured,
          ),
    };
  }

  private resolveDisabledReason(
    aiChatEnabled: boolean,
    permittedByUser: boolean,
    implemented: boolean,
    chatModelConfigured: boolean,
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
