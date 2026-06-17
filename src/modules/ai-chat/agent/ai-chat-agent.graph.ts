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
  health_context_snapshot: [
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
  ],
  recent_daily_records: [
    /记录/,
    /record/i,
    /today/i,
    /今天/,
    /昨天/,
    /recent/i,
    /最近/,
    /饮水/,
    /喝水/,
    /water/i,
    /meal/i,
    /吃饭/,
    /symptom/i,
    /症状/,
    /note/i,
    /日志/,
  ],
  recent_sleep_summary: [
    /睡眠/,
    /睡得/,
    /失眠/,
    /作息/,
    /sleep/i,
    /rest/i,
    /insomnia/i,
  ],
  current_medicines: [
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
};

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
  const matched = allowedTools.filter((toolName) =>
    TOOL_KEYWORD_RULES[toolName].some((rule) => rule.test(userMessage)),
  );

  if (matched.length > 0) {
    return matched;
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
