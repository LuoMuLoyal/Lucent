import {
  ASSISTANT_TOOL_SOURCE_MAP,
  type AssistantContextSource,
  type AssistantToolName,
} from '../../tools/shared/tool-types.js';

/**
 * 权限映射：用户开启的个人数据来源 → 该来源允许暴露的工具。
 *
 * 这是**门禁**，不是路由规则：它只回答"用户允许这个助手读哪些数据"，
 * 不回答"这条消息想要什么"。后者自 2026-10-07 起由大模型完成
 * （`AssistantIntentClassifierService`），旧的关键词路由表已整体退役。
 *
 * 判定：工具声明的 `requiredSources` 必须**全部**已开启。声明为空数组的工具
 * （全部知识检索与写入提案类）不受个人数据开关约束，只受助手总开关与
 * 工具自身可用性（sidecar 在不在）约束 —— 后者由 `policy.service.ts` 的
 * `toolCapabilities[].enabled` 判定。
 */
export function selectAllowedToolsForContextSources(
  enabledContextSources: readonly AssistantContextSource[],
): AssistantToolName[] {
  const enabled = new Set(enabledContextSources);

  return Object.entries(ASSISTANT_TOOL_SOURCE_MAP)
    .filter(([, requiredSources]) =>
      requiredSources.every((source) => enabled.has(source)),
    )
    .map(([toolName]) => toolName as AssistantToolName);
}
