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
  ASSISTANT_RETRIEVAL_TOOL_NAMES,
  ASSISTANT_TOOL_NAMES,
  ASSISTANT_TOOL_SOURCE_MAP,
  type AssistantContextSource,
  type AssistantToolDisabledReason,
  type AssistantToolName,
} from '../tools/shared/tool-types.js';

/** 依赖 LightRAG sidecar 的工具集合，用于检索可用性判定。 */
const RETRIEVAL_TOOL_NAMES: ReadonlySet<AssistantToolName> = new Set(
  ASSISTANT_RETRIEVAL_TOOL_NAMES,
);

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
      !RETRIEVAL_TOOL_NAMES.has(toolName) || foundation.retrievalAvailable;
    const enabled =
      permittedByUser &&
      implemented &&
      retrievalReady &&
      foundation.chatModelConfigured;

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
            retrievalReady,
            foundation.chatModelConfigured,
          ),
    };
  }

  private resolveDisabledReason(
    assistantEnabled: boolean,
    permittedByUser: boolean,
    implemented: boolean,
    retrievalReady: boolean,
    chatModelConfigured: boolean,
  ): AssistantToolDisabledReason {
    if (!assistantEnabled) {
      return 'chat_disabled';
    }
    if (!permittedByUser) {
      return 'context_disabled';
    }
    // 检索不可用排在 model_not_configured 之前：这两条同时成立时，
    // "sidecar 没配好"是更具体、更可操作的原因，而模型未配置是全局的。
    if (!retrievalReady) {
      return 'retrieval_unavailable';
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
