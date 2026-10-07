import type { AssistantToolName } from '../../tools/shared/tool-types.js';

/**
 * 语义意图，决定走哪条子图 / 哪个 system prompt。
 *
 * - `simple_chat`    — 闲聊，不需要工具（不绑任何工具，也不调模型做路由）。
 * - `read_data`      — 读用户自己的记录、摘要、档案。
 * - `write_proposal` — 产出待确认的写入草稿（**从不直接写库**）。
 * - `knowledge`      — 药品 / 医学知识检索。
 * - `mixed`          — 跨类（读 + 知识，或写 + 知识），走通用 agent 节点。
 */
export type AssistantIntent =
  | 'simple_chat'
  | 'read_data'
  | 'write_proposal'
  | 'knowledge'
  | 'mixed';

/**
 * 一轮路由的结果。
 *
 * `degraded_all_tools` 是**降级语义**：模型不可用 / 输出非法 / 没接线时，本轮绑定
 * 全部可用工具，而不是回退到某个规则子集（关键词机制已整体退役）。调用方据此把
 * intent 定成 `mixed`，走通用 agent 节点。
 */
export type AssistantToolRoutingOutcome =
  | { source: 'llm'; tools: AssistantToolName[] }
  | { source: 'degraded_all_tools'; reason: string };

/** 知识检索类工具（不读用户个人数据）。 */
const KNOWLEDGE_TOOL_NAMES = new Set<AssistantToolName>([
  'search_cn_medicine_products',
  'get_cn_medicine_detail',
  'search_cn_medicine_knowledge',
  'resolve_drugbank_entity',
  'get_drugbank_detail',
  'search_drugbank_passages',
  // 本体推理也是知识检索：漏了它，命中该工具的消息会被判成"读个人数据"，
  // 于是路由到 read 子图、只绑个人记录工具（实测表现是模型自称"只能查用药记录"）。
  'reason_over_ontology',
  'reason_over_rules',
]);

/** 写入提案类工具（只产草稿，从不直接写库）。 */
const WRITE_TOOL_NAMES = new Set<AssistantToolName>([
  'propose_create_daily_record',
  'propose_update_daily_record',
  'propose_delete_daily_record',
  'propose_update_user_settings',
]);

/**
 * 从工具集**确定性**导出意图。
 *
 * 为什么不让模型直接给 intent：工具集才是这轮真正被绑定的东西，intent 只是它的
 * 一个投影。两处各算一份就会出现"工具绑了 A、intent 说是 B"的组合，而那种不一致
 * 在提示词与条件边上都看不出来（2026-10-07 生产事故里最难查的一类）。
 *
 * 空工具集 → `simple_chat`：没有工具可绑，走不调模型的快速通道。
 */
export function deriveIntent(
  relevantTools: readonly AssistantToolName[],
): AssistantIntent {
  if (relevantTools.length === 0) {
    return 'simple_chat';
  }

  let hasRead = false;
  let hasWrite = false;
  let hasKnowledge = false;
  for (const toolName of relevantTools) {
    if (WRITE_TOOL_NAMES.has(toolName)) {
      hasWrite = true;
    } else if (KNOWLEDGE_TOOL_NAMES.has(toolName)) {
      hasKnowledge = true;
    } else {
      hasRead = true;
    }
  }

  // 写入提案优先于它的辅助读：创建草稿会附带 `get_today_records` 作为上下文，
  // 那不是真正的"混合意图"。只有 读×知识 或 写×知识 才算 mixed。
  if (hasWrite) {
    return hasKnowledge ? 'mixed' : 'write_proposal';
  }
  if (hasRead && hasKnowledge) {
    return 'mixed';
  }
  if (hasKnowledge) {
    return 'knowledge';
  }
  return 'read_data';
}
