import type { AssistantToolName } from '../../tools/shared/tool-types.js';

/**
 * 意图路由评测集。
 *
 * 关键词路由已整体退役（ADR-0024），"哪条消息该选哪些工具"不再是单测能确定的东西 ——
 * 它取决于模型。这份数据因此承担两件事：
 *
 * 1. **回归底线**：`mustInclude` 是"必须召回"的工具，`mustExclude` 是"明确不该出现"的
 *    工具。前三条来自 2026-10-07 的生产事故（见
 *    `plans/2026-10-07-assistant-intent-routing-and-retrieval-fixes.md`），它们钉的是
 *    当时真实出错的那几个问法；
 * 2. **对比口径**：`legacyKeywordTools` 是旧关键词路由在事故当天**实测**的选择
 *    （只对这三条有据可查，其余留空，不编造）。
 *
 * 怎么跑：
 * - CI 只能校验**形状**（见 `intent-eval.fixture.spec.ts`）—— 调模型要凭据，不进 CI；
 * - 人工评测：对每条 case 用生产同款路由（`AssistantIntentClassifierService`）跑一遍，
 *   统计 `mustInclude` 召回率、`mustExclude` 违反率与 `expectExactlyEmpty` 正确率，
 *   与下面的 `legacyKeywordTools` 基线并列成表。
 */
export interface AssistantIntentEvalCase {
  /** 稳定 id，便于在报告里引用单条失败。 */
  id: string;
  locale: 'zh-CN' | 'en';
  message: string;
  /** 必须被选中的工具（召回底线）。 */
  mustInclude?: AssistantToolName[];
  /** 明确不该被选中的工具（误调用/跨源污染）。 */
  mustExclude?: AssistantToolName[];
  /** 该轮不应绑定任何工具（闲聊、致谢、纯边界输入）。 */
  expectExactlyEmpty?: boolean;
  /**
   * 旧关键词路由在 2026-10-07 的选择（生产实测，仅前三条有据可查）。
   * 只作对比基线，不参与断言。
   */
  legacyKeywordTools?: AssistantToolName[];
  note?: string;
}

/** 评测时使用的候选集：全量工具（用户已开启全部个人数据来源、两个 sidecar 都可用）。 */
export const ASSISTANT_INTENT_EVAL_CANDIDATES: readonly AssistantToolName[] = [
  'get_today_records',
  'get_records_by_date',
  'get_records_by_range',
  'get_today_summary_by_date',
  'get_report_summary_by_range',
  'get_recent_today_summaries',
  'get_recent_report_summaries',
  'get_user_profile',
  'get_user_settings',
  'get_current_medicines',
  'get_sleep_summary_by_range',
  'get_meal_analysis_digest',
  'search_cn_medicine_products',
  'get_cn_medicine_detail',
  'search_cn_medicine_knowledge',
  'resolve_drugbank_entity',
  'get_drugbank_detail',
  'search_drugbank_passages',
  'reason_over_ontology',
  'reason_over_rules',
  'propose_create_daily_record',
  'propose_update_daily_record',
  'propose_delete_daily_record',
  'propose_update_user_settings',
];

export const ASSISTANT_INTENT_EVAL_CASES: readonly AssistantIntentEvalCase[] = [
  // ── 2026-10-07 生产事故的三条（回归底线）──────────────────────────────
  {
    id: 'incident-capability-question',
    locale: 'zh-CN',
    message: '你好，你有什么能力可以帮我查药品吗?',
    mustExclude: [
      'search_cn_medicine_knowledge',
      'search_drugbank_passages',
      'reason_over_ontology',
    ],
    legacyKeywordTools: ['get_current_medicines'],
    note: '事故里模型只被绑了一个数据工具，却把"本轮工具集"说成产品能力边界；本轮的正确答案是关于能力的自述，不需要检索工具。',
  },
  {
    id: 'incident-interaction-zh',
    locale: 'zh-CN',
    message: '查询地塞米松和布洛芬的相互作用，以及哪种药物不能和他们同时服用',
    mustInclude: ['search_cn_medicine_knowledge', 'reason_over_ontology'],
    legacyKeywordTools: [
      'search_cn_medicine_knowledge',
      'resolve_drugbank_entity',
      'reason_over_ontology',
      'search_drugbank_passages',
      'get_current_medicines',
    ],
    note: '中文散文证据（LightRAG）与英文图谱都必须进来：事故里 LightRAG 工具被绑定却一次没调，而图谱因覆盖不足返回零行。',
  },
  {
    id: 'incident-interaction-en',
    locale: 'en',
    message:
      'Search for the interaction between dexamethasone and ibuprofen, as well as which drugs cannot be taken together with them',
    mustInclude: ['reason_over_ontology'],
    mustExclude: ['search_cn_medicine_knowledge'],
    legacyKeywordTools: [
      'resolve_drugbank_entity',
      'reason_over_ontology',
      'search_drugbank_passages',
      'get_records_by_range',
      'get_current_medicines',
    ],
    note: '英文问法命中不了中文散文检索的关键词规则（事故的直接原因之一）；药物名称须按 DrugBank 写法传递。',
  },

  // ── 中文说明书 / 产品键查 ────────────────────────────────────────────
  {
    id: 'zh-leaflet-contraindication',
    locale: 'zh-CN',
    message: '阿司匹林肠溶片的禁忌和不良反应是什么？',
    mustInclude: ['search_cn_medicine_knowledge'],
  },
  {
    id: 'zh-leaflet-interaction',
    locale: 'zh-CN',
    message: '布洛芬的说明书里写了哪些药物相互作用？',
    mustInclude: ['search_cn_medicine_knowledge'],
  },
  {
    id: 'zh-product-approval-number',
    locale: 'zh-CN',
    message: '查一下国药准字H10900089的厂家和规格',
    mustInclude: ['search_cn_medicine_products'],
  },

  // ── 个人数据 ────────────────────────────────────────────────────────
  {
    id: 'zh-today-records',
    locale: 'zh-CN',
    message: '今天的饮水记录是多少？',
    mustInclude: ['get_today_records'],
  },
  {
    id: 'zh-sleep-range',
    locale: 'zh-CN',
    message: '最近一周睡眠怎么样？',
    mustInclude: ['get_sleep_summary_by_range'],
  },
  {
    id: 'zh-diet-digest',
    locale: 'zh-CN',
    message: '我这周吃了多少热量？',
    mustInclude: ['get_meal_analysis_digest'],
  },
  {
    id: 'zh-allergy-profile',
    locale: 'zh-CN',
    message: '我的过敏史有哪些？',
    mustInclude: ['get_user_profile'],
  },
  {
    id: 'zh-current-medicines',
    locale: 'zh-CN',
    message: '我现在在吃哪些药？',
    mustInclude: ['get_current_medicines'],
  },
  {
    id: 'zh-report-summary',
    locale: 'zh-CN',
    message: '帮我看上周的周报总结',
    mustInclude: ['get_report_summary_by_range'],
  },
  {
    id: 'zh-history-summary',
    locale: 'zh-CN',
    message: '给我看看历史 Today 总结',
    mustInclude: ['get_recent_today_summaries'],
  },

  // ── 写入提案（保守性最关键的一类）───────────────────────────────────
  {
    id: 'zh-write-create',
    locale: 'zh-CN',
    message: '帮我记一下今天喝了 300ml 水',
    mustInclude: ['propose_create_daily_record'],
  },
  {
    id: 'zh-write-delete',
    locale: 'zh-CN',
    message: '把昨天那条饮水记录删掉',
    mustInclude: ['propose_delete_daily_record'],
  },
  {
    id: 'zh-write-settings',
    locale: 'zh-CN',
    message: '把 AI 记忆关掉',
    mustInclude: ['propose_update_user_settings'],
  },
  {
    id: 'zh-write-edit',
    locale: 'zh-CN',
    message: '把今天那条 300ml 饮水记录的备注改成课后补水',
    mustInclude: ['propose_update_daily_record'],
  },

  // ── 英文侧（DrugBank / 图谱）────────────────────────────────────────
  {
    id: 'en-mechanism',
    locale: 'en',
    message: 'What is the mechanism of action of ibuprofen?',
    mustInclude: ['resolve_drugbank_entity'],
  },
  {
    id: 'en-shared-target',
    locale: 'en',
    message: 'Which drugs share a target with clopidogrel?',
    mustInclude: ['reason_over_ontology'],
  },
  {
    id: 'en-derived-rule',
    locale: 'en',
    message:
      'Could warfarin interact with another drug indirectly through a shared enzyme?',
    mustInclude: ['reason_over_rules'],
  },
  {
    id: 'zh-cyp-enzyme',
    locale: 'zh-CN',
    message: '华法林是不是通过 CYP2C9 代谢的？',
    mustInclude: ['reason_over_ontology'],
  },

  // ── 多意图 ──────────────────────────────────────────────────────────
  {
    id: 'zh-mixed-read-knowledge',
    locale: 'zh-CN',
    message: '我最近的血压记录怎么样，顺便查查缬沙坦的说明书',
    mustInclude: ['get_records_by_range', 'search_cn_medicine_knowledge'],
  },

  // ── 边界：不该选任何工具 ────────────────────────────────────────────
  {
    id: 'zh-greeting',
    locale: 'zh-CN',
    message: '你好呀',
    expectExactlyEmpty: true,
  },
  {
    id: 'zh-thanks',
    locale: 'zh-CN',
    message: '谢谢你！',
    expectExactlyEmpty: true,
  },
  {
    id: 'en-boundary-input',
    locale: 'en',
    message: 'test',
    expectExactlyEmpty: true,
  },
];
