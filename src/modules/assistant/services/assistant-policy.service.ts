import { Injectable } from '@nestjs/common';
import type { IAssistantUserSettings } from '../types/assistant-ports';
import { selectAllowedToolsForContextSources } from '../agent/assistant-runtime.graph';
import type {
  AssistantRuntimeCapabilities,
  AssistantPolicySnapshot,
  AssistantToolCapabilitySnapshot,
} from '../types/assistant.types';
import {
  ASSISTANT_CONTEXT_SOURCES,
  ASSISTANT_TOOL_NAMES,
  ASSISTANT_TOOL_SOURCE_MAP,
  type AssistantContextSource,
  type AssistantToolDisabledReason,
  type AssistantToolName,
} from '../tools/assistant-tool.types';

@Injectable()
export class AssistantPolicyService {
  evaluate(
    foundation: AssistantRuntimeCapabilities,
    settings: IAssistantUserSettings,
  ): AssistantPolicySnapshot {
    const enabledContextSources = ASSISTANT_CONTEXT_SOURCES.filter((source) =>
      this.isContextSourceEnabled(source, settings),
    );
    const contextPermittedToolNames = settings.assistantEnabled
      ? selectAllowedToolsForContextSources(enabledContextSources)
      : [];
    const executableToolNames = contextPermittedToolNames.filter((toolName) =>
      foundation.implementedToolNames.includes(toolName),
    );

    return {
      interactiveChatReady:
        settings.assistantEnabled && foundation.interactiveChatReady,
      enabledContextSources,
      contextPermittedToolNames,
      executableToolNames,
      toolCapabilities: ASSISTANT_TOOL_NAMES.map((toolName) =>
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
    toolName: AssistantToolName,
    foundation: AssistantRuntimeCapabilities,
    settings: IAssistantUserSettings,
    contextPermittedToolNames: readonly AssistantToolName[],
  ): AssistantToolCapabilitySnapshot {
    const requiredContextSources: AssistantContextSource[] = [
      ...ASSISTANT_TOOL_SOURCE_MAP[toolName],
    ];
    const permittedByUser =
      settings.assistantEnabled && contextPermittedToolNames.includes(toolName);
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
            settings.assistantEnabled,
            permittedByUser,
            implemented,
            foundation.chatModelConfigured,
          ),
    };
  }

  private resolveDisabledReason(
    assistantEnabled: boolean,
    permittedByUser: boolean,
    implemented: boolean,
    chatModelConfigured: boolean,
  ): AssistantToolDisabledReason {
    if (!assistantEnabled) {
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
    source: AssistantContextSource,
    settings: IAssistantUserSettings,
  ): boolean {
    switch (source) {
      case 'health_profile':
        return settings.assistantContext.healthProfile;
      case 'daily_records':
        return settings.assistantContext.dailyRecords;
      case 'sleep_records':
        return settings.assistantContext.sleepRecords;
      case 'current_medicines':
        return settings.assistantContext.currentMedicines;
    }
  }
}
