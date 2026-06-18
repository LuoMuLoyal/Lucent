import { Annotation, END, START, StateGraph } from '@langchain/langgraph';
import {
  AI_CHAT_TOOL_SOURCE_MAP,
  type AiChatContextSource,
  type AiChatToolName,
} from '../tools/ai-chat-tool.types';

const AI_CHAT_ROUTE = 'respond' as const;

export const AI_CHAT_FOUNDATION_NODE_NAMES = [
  'prepare_context',
  AI_CHAT_ROUTE,
] as const;

const AiChatFoundationState = Annotation.Root({
  userId: Annotation<string>,
  userMessage: Annotation<string>,
  locale: Annotation<string>,
  enabledContextSources: Annotation<AiChatContextSource[]>({
    reducer: (_left, right) => right,
    default: () => [],
  }),
  allowedTools: Annotation<AiChatToolName[]>({
    reducer: (_left, right) => right,
    default: () => [],
  }),
  selectedTools: Annotation<AiChatToolName[]>({
    reducer: (_left, right) => right,
    default: () => [],
  }),
  route: Annotation<'respond'>({
    reducer: (_left, right) => right,
    default: () => AI_CHAT_ROUTE,
  }),
});

export type AiChatFoundationState = typeof AiChatFoundationState.State;

export function selectAllowedToolsForContextSources(
  enabledContextSources: readonly AiChatContextSource[],
): AiChatToolName[] {
  const enabled = new Set(enabledContextSources);

  return Object.entries(AI_CHAT_TOOL_SOURCE_MAP)
    .filter(([, requiredSources]) =>
      requiredSources.every((source) => enabled.has(source)),
    )
    .map(([toolName]) => toolName as AiChatToolName);
}

const TOOL_KEYWORD_RULES: Record<AiChatToolName, RegExp[]> = {
  get_today_records: [
    /今天/,
    /today/i,
    /今日/,
    /刚刚/,
    /刚才/,
    /今天.*记录/,
    /today.*record/i,
  ],
  get_records_by_date: [
    /昨天/,
    /前天/,
    /\b\d{4}-\d{2}-\d{2}\b/,
    /\d{1,2}月\d{1,2}日/,
    /哪天/,
    /某天/,
    /on\s+\d{4}-\d{2}-\d{2}/i,
  ],
  get_records_by_range: [
    /最近/,
    /近\s*\d+\s*天/,
    /从.*到.*/,
    /between/i,
    /range/i,
    /这周/,
    /上周/,
    /近一周/,
  ],
  get_recent_today_summaries: [
    /今天总结/,
    /today summary/i,
    /历史总结/,
    /之前总结/,
    /today analysis/i,
  ],
  get_recent_report_summaries: [
    /报告总结/,
    /周报总结/,
    /月报总结/,
    /report summary/i,
    /weekly summary/i,
    /monthly summary/i,
  ],
  get_user_profile: [
    /过敏/,
    /allerg/i,
    /病史/,
    /既往/,
    /condition/i,
    /profile/i,
    /怀孕/,
    /pregnan/i,
    /哺乳/,
    /lactat/i,
    /血型/,
    /blood type/i,
    /身高/,
    /height/i,
    /年龄/,
    /age/i,
  ],
  get_user_settings: [
    /设置/,
    /权限/,
    /开关/,
    /setting/i,
    /permission/i,
    /toggle/i,
    /enabled/i,
  ],
  get_current_medicines: [
    /药/,
    /用药/,
    /吃药/,
    /服药/,
    /提醒/,
    /medicine/i,
    /medic/i,
    /drug/i,
    /dose/i,
    /dosage/i,
    /pill/i,
    /reminder/i,
  ],
  get_sleep_summary_by_range: [
    /睡眠/,
    /睡得/,
    /失眠/,
    /作息/,
    /sleep/i,
    /rest/i,
    /insomnia/i,
    /近几天睡眠/,
    /最近睡眠/,
  ],
};

const BROAD_RECORD_QUERY_RULES = [
  /记录/,
  /record/i,
  /日志/,
  /饮水/,
  /喝水/,
  /water/i,
  /meal/i,
  /吃饭/,
  /symptom/i,
  /症状/,
  /note/i,
] as const;

const BROAD_PERSONALIZED_QUERY_RULES = [
  /最近/,
  /这几天/,
  /lately/i,
  /recently/i,
  /overview/i,
  /summary/i,
  /情况/,
  /状态/,
  /怎么办/,
  /what should i do/i,
  /how am i/i,
] as const;

export function selectRelevantToolsForMessage(
  userMessage: string,
  allowedTools: readonly AiChatToolName[],
): AiChatToolName[] {
  const broadRecordTools = allowedTools.filter(
    (toolName) =>
      toolName === 'get_today_records' ||
      toolName === 'get_records_by_date' ||
      toolName === 'get_records_by_range',
  );
  const sleepTools = allowedTools.filter(
    (toolName) => toolName === 'get_sleep_summary_by_range',
  );

  const matched = allowedTools.filter((toolName) =>
    TOOL_KEYWORD_RULES[toolName].some((rule) => rule.test(userMessage)),
  );

  if (matched.length > 0) {
    const withRangeFallback: AiChatToolName[] =
      matched.includes('get_records_by_range') &&
      broadRecordTools.includes('get_records_by_range')
        ? [...new Set<AiChatToolName>([...matched, 'get_records_by_range'])]
        : matched;
    return withRangeFallback;
  }

  if (
    broadRecordTools.length > 0 &&
    BROAD_RECORD_QUERY_RULES.some((rule) => rule.test(userMessage))
  ) {
    if (broadRecordTools.includes('get_today_records')) {
      return ['get_today_records'];
    }
    const firstTool = broadRecordTools[0];
    return firstTool == null ? [] : [firstTool];
  }

  if (sleepTools.length > 0 && /睡|sleep|rest|insomnia/i.test(userMessage)) {
    return ['get_sleep_summary_by_range'];
  }

  if (
    allowedTools.length > 0 &&
    BROAD_PERSONALIZED_QUERY_RULES.some((rule) => rule.test(userMessage))
  ) {
    return [...allowedTools];
  }

  return [];
}

export function buildAiChatFoundationGraph() {
  return new StateGraph(AiChatFoundationState)
    .addNode('prepare_context', (state) => ({
      allowedTools: selectAllowedToolsForContextSources(
        state.enabledContextSources,
      ),
      selectedTools: selectRelevantToolsForMessage(
        state.userMessage,
        selectAllowedToolsForContextSources(state.enabledContextSources),
      ),
      route: AI_CHAT_ROUTE,
    }))
    .addNode('respond', () => ({}))
    .addEdge(START, 'prepare_context')
    .addEdge('prepare_context', 'respond')
    .addEdge('respond', END)
    .compile();
}
