import { Injectable } from '@nestjs/common';
import type { IAssistantUserSettings } from '../types/ports.js';
import { selectAllowedToolsForContextSources } from '../agent/runtime/router.js';
import type {
  AssistantRuntimeCapabilities,
  AssistantPolicySnapshot,
  AssistantToolCapabilitySnapshot,
} from '../types/assistant.types.js';
import {
  ASSISTANT_CONTEXT_SOURCES,
  ASSISTANT_OAG_TOOL_NAME_SET,
  ASSISTANT_RETRIEVAL_TOOL_NAME_SET,
  ASSISTANT_TOOL_NAMES,
  ASSISTANT_TOOL_SOURCE_MAP,
  type AssistantContextSource,
  type AssistantToolDisabledReason,
  type AssistantToolName,
} from '../tools/shared/tool-types.js';

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
    const retrievalReady =
      !ASSISTANT_RETRIEVAL_TOOL_NAME_SET.has(toolName) ||
      foundation.retrievalAvailable;
    const oagReady =
      !ASSISTANT_OAG_TOOL_NAME_SET.has(toolName) || foundation.oagAvailable;
    const enabled =
      permittedByUser &&
      implemented &&
      retrievalReady &&
      oagReady &&
      foundation.chatModelConfigured;

    return {
      name: toolName,
      requiredContextSources,
      permittedByUser,
      implemented,
      enabled,
      disabledReason: enabled
        ? null
        : this.resolveDisabledReason({
            assistantEnabled: settings.assistantEnabled,
            permittedByUser,
            implemented,
            retrievalReady,
            oagReady,
            chatModelConfigured: foundation.chatModelConfigured,
          }),
    };
  }

  private resolveDisabledReason(input: {
    assistantEnabled: boolean;
    permittedByUser: boolean;
    implemented: boolean;
    retrievalReady: boolean;
    oagReady: boolean;
    chatModelConfigured: boolean;
  }): AssistantToolDisabledReason {
    if (!input.assistantEnabled) {
      return 'chat_disabled';
    }
    if (!input.permittedByUser) {
      return 'context_disabled';
    }
    // sidecar 不可用排在 model_not_configured 之前：这两条同时成立时，
    // "sidecar 没配好"是更具体、更可操作的原因，而模型未配置是全局的。
    // 两个 sidecar 共用同一个原因值：客户端渲染的都是"该来源暂不可用"，
    // 而具体是哪一个由工具的 envelope 说清楚。
    if (!input.retrievalReady || !input.oagReady) {
      return 'retrieval_unavailable';
    }
    if (!input.chatModelConfigured) {
      return 'model_not_configured';
    }
    if (!input.implemented) {
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
