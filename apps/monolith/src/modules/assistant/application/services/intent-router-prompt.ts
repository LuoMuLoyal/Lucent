import type { ContextSource } from '../../domain/policies/tool-permission.js';
import type { ToolName } from '../../domain/policies/tool-permission.js';
import { TOOL_DESCRIPTIONS } from '../../domain/policies/tool-permission.js';

/**
 * 单轮工具选择的提示词。
 *
 * 这份提示词就是**原关键词路由表的语义版**：`agent/runtime/tool-keyword-rules.ts`
 * 已随"关键词机制整体退役"删除，里面那些踩过坑的领域裁决（国药准字键查、
 * 历史摘要专路由、写提案优先级、CN 散文 vs DrugBank 的归属）逐条搬到这里。
 * 搬的是**规则本身**，不是它的实现方式 —— 正则换成了模型判断。
 *
 * 与旧实现的另一个差别：只出工具，不出 intent（intent 由 `deriveIntent()` 从工具集
 * 确定性导出，见 `schemas/intent-routing.schema.ts` 的说明）。
 */

const ROUTING_RULES: readonly string[] = [
  // 硬约束
  'Choose only from the candidate tools listed below. Never invent a tool name.',
  'Return every tool this turn needs, most relevant first — a question can need both a personal-data read and a knowledge lookup.',
  'Return an empty list only for greetings, thanks, small talk, or a question about your own capabilities that needs no data.',
  'Do not add a tool "just in case". An unnecessary tool call costs the user time and can put unrelated evidence in front of them.',

  // 个人数据
  'The user\'s own data: today → get_today_records; one mentioned date → get_records_by_date; a range like "last 7 days" → get_records_by_range; sleep → get_sleep_summary_by_range; meals, diet, calories, nutrition → get_meal_analysis_digest (never re-derive nutrition from record text); allergies, conditions, blood type, height → get_user_profile; assistant settings, permissions, memory, privacy → get_user_settings; their own medicines and reminders → get_current_medicines.',

  // 写入提案
  "Write requests never write directly: pick propose_delete_daily_record for delete, propose_update_user_settings for assistant settings/permissions/memory, propose_update_daily_record for editing an existing record, propose_create_daily_record for recording something new. When recording, also include get_today_records so the draft has today's context. Exactly one write tool per turn.",
  'If the user only talks about wanting to change something without saying what, still pick the write tool — the draft stage asks for the missing target; answering in prose instead is the failure mode this rule exists to prevent.',

  // 中文结构化（键查）
  'Chinese product lookups keyed by approval number / manufacturer / package spec (国药准字, 批准文号, 厂家, 规格, 商品名) → search_cn_medicine_products, then get_cn_medicine_detail for one product.',

  // 中文散文（LightRAG）
  'Chinese package-insert prose and Chinese medical knowledge — 说明书, 成分, 用法用量, 适应症, 禁忌, 注意事项, 不良反应, 副作用, 相互作用, 疾病知识, 病因, 预防 — → search_cn_medicine_knowledge.',
  // ⚠️ 这条是 2026-10-07 事故的复现修复：中文的"相互作用"问句若只按下面的关系规则走，
  //    会选上英文图谱而漏掉中文说明书里的【药物相互作用】小节 —— 实测同一问法在真实模型下
  //    就是漏选 search_cn_medicine_knowledge。两个来源是**不同证据**，不是二选一。
  'A question asked in Chinese about a drug always includes search_cn_medicine_knowledge, even when it is also a relationship question (相互作用/禁忌/不良反应/联用). Never route a Chinese drug question to the English graph alone: the Chinese package insert has a 药物相互作用 section the graph does not carry, and the graph has typed assertions the insert does not. Select both.',
  'The same rule holds in the other direction for English questions: when a drug name is involved, pair the graph tool with the DrugBank prose tools (resolve_drugbank_entity / search_drugbank_passages) instead of stopping at the graph.',

  // 英文 DrugBank
  'English pharmacology — mechanism, pharmacokinetics, half-life, metabolism, protein binding, targets — → resolve_drugbank_entity (one drug name per call, in English as DrugBank writes it) followed by search_drugbank_passages or get_drugbank_detail.',
  'Relationship questions ("do A and B interact", "which drugs interact with X", shared target, same enzyme, co-administration, 相互作用, 同服, 联用) → reason_over_ontology. It reads the typed DrugBank graph and returns the executed query plus its provenance; prefer it over prose search for the relationship itself. It is one source among several, not a replacement for the prose sources above.',
  'Questions the graph cannot answer by reading an edge — "could A interact with B through a shared enzyme", "what does this drug potentially interact with", derivation or indirect chains — → reason_over_rules, which derives new facts under an explicit scope. When both reason_over_rules and reason_over_ontology fit, choose reason_over_rules: a derived answer with a named rule and citations carries more information than the direct read.',
  'ATC class membership and class-level questions ("what class is clopidogrel in", CYP/P450 substrate questions) → reason_over_ontology.',

  // 摘要
  "Persisted AI summaries are not chat history: a specific date's summary → get_today_summary_by_date (only when a date is actually given); a range summary or 周报/月报 → get_report_summary_by_range; looking back over past summaries (历史/之前 + 总结/report) → get_recent_today_summaries or get_recent_report_summaries.",

  // 边界
  'History or chit-chat that needs no evidence → empty list.',
  "Never use retrieval tools to answer a question about the user's own recorded data, and never use personal-data tools to answer a pharmacology question.",
];

/** 候选工具目录：名称 + 现有工具描述（与绑定给模型的描述同一份事实源）。 */
function toolCatalog(candidateTools: readonly ToolName[]): string {
  return candidateTools
    .map((name) => `- ${name}: ${TOOL_DESCRIPTIONS[name]}`)
    .join('\n');
}

/**
 * Per-turn character cap when rendering conversation history into the routing
 * prompt. A follow-up question is short; the turns before it may not be.
 */
export const ROUTER_HISTORY_MESSAGE_MAX_CHARS = 400;

export function buildIntentRouterSystemPrompt(): string {
  return [
    'You route one turn of a health assistant: you decide which tools that turn may use.',
    'You do not answer the user. You do not write prose for the user. You only select tools.',
    'The candidate tools for this turn are listed in the user message. Choose only from that list; never invent a tool name.',
    '',
    'Rules:',
    ...ROUTING_RULES.map((rule) => `- ${rule}`),
  ].join('\n');
}

export function buildIntentRouterUserPrompt(input: {
  userMessage: string;
  locale: string;
  enabledContextSources: readonly ContextSource[];
  candidateTools: readonly ToolName[];
  /**
   * Prior turns of this conversation, oldest first, excluding the current message.
   *
   * Without it, a follow-up like "那你查一下" is routed on four characters with no
   * antecedent: the model cannot tell which tool the previous turn needed, returns
   * an empty set, and `deriveIntent([])` collapses the turn into `simple_chat` —
   * the answer then has no tools bound at all. The router decides *which tools this
   * turn needs*, and "this turn" is not interpretable without what came before.
   *
   * Rendered **before** the tool catalog on purpose: the catalog is a hard
   * constraint and the user message should stay the last thing read.
   */
  history?: readonly { role: 'user' | 'assistant'; content: string }[];
}): string {
  const sources =
    input.enabledContextSources.length > 0
      ? input.enabledContextSources.join(', ')
      : 'none';
  const sections = [
    'Candidate tools for this turn:',
    toolCatalog(input.candidateTools),
    '',
    `Personal-data sources the user has enabled: ${sources}.`,
    'Tools whose data the user has not enabled are already absent from the candidate list.',
  ];

  if (input.history != null && input.history.length > 0) {
    sections.push(
      '',
      // Say what the history is for, not how it was obtained: the router must
      // resolve references ("that one", "那你查一下") against it instead of
      // treating the final message as a standalone question.
      'Earlier turns of this conversation, oldest first (use them to resolve references in the final message):',
      renderHistory(input.history),
    );
  }

  sections.push(
    '',
    `User message (language: ${input.locale}):`,
    input.userMessage,
  );
  return sections.join('\n');
}

/**
 * Renders prior turns as a bounded transcript.
 *
 * Per-message clipping is deliberate: a past answer can be thousands of
 * characters, and the router only needs to know *what was asked and which
 * ground was covered* to pick tools for the follow-up. Full text here would
 * spend the routing call's budget on content the answer model reads anyway.
 */
function renderHistory(
  history: readonly { role: 'user' | 'assistant'; content: string }[],
): string {
  return history
    .map((turn) => {
      const text = turn.content.replace(/\s+/g, ' ').trim();
      const clipped =
        text.length > ROUTER_HISTORY_MESSAGE_MAX_CHARS
          ? `${text.slice(0, ROUTER_HISTORY_MESSAGE_MAX_CHARS)}…`
          : text;
      return `${turn.role === 'user' ? 'User' : 'Assistant'}: ${clipped}`;
    })
    .join('\n');
}
