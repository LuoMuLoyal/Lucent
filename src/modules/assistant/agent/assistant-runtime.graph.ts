import { Annotation, END, START, StateGraph } from '@langchain/langgraph';
import {
  ASSISTANT_TOOL_SOURCE_MAP,
  type AssistantContextSource,
  type AssistantToolName,
} from '../tools/assistant-tool.types';

const ASSISTANT_ROUTE = 'respond' as const;

export const ASSISTANT_RUNTIME_NODE_NAMES = [
  'prepare_context',
  ASSISTANT_ROUTE,
] as const;

const AssistantRuntimeState = Annotation.Root({
  userId: Annotation<string>,
  userMessage: Annotation<string>,
  locale: Annotation<string>,
  enabledContextSources: Annotation<AssistantContextSource[]>({
    reducer: (_left, right) => right,
    default: () => [],
  }),
  allowedTools: Annotation<AssistantToolName[]>({
    reducer: (_left, right) => right,
    default: () => [],
  }),
  selectedTools: Annotation<AssistantToolName[]>({
    reducer: (_left, right) => right,
    default: () => [],
  }),
  route: Annotation<'respond'>({
    reducer: (_left, right) => right,
    default: () => ASSISTANT_ROUTE,
  }),
});

export type AssistantRuntimeState = typeof AssistantRuntimeState.State;

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

const TOOL_KEYWORD_RULES: Record<AssistantToolName, RegExp[]> = {
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
  get_today_summary_by_date: [
    /今天总结/,
    /当日总结/,
    /那天总结/,
    /某天总结/,
    /today summary/i,
    /today analysis/i,
  ],
  get_report_summary_by_range: [
    /周报/,
    /月报/,
    /报告总结/,
    /报告分析/,
    /7天报告/,
    /30天报告/,
    /last 7 days report/i,
    /last 30 days report/i,
    /report summary/i,
  ],
  get_recent_today_summaries: [
    /今天总结/,
    /today summary/i,
    /历史总结/,
    /之前总结/,
    /历史.*today/i,
    /之前.*today/i,
    /history.*today/i,
    /today ai summary/i,
    /today analysis/i,
  ],
  get_recent_report_summaries: [
    /报告总结/,
    /周报总结/,
    /月报总结/,
    /历史.*报告/,
    /之前.*报告/,
    /历史.*report/i,
    /之前.*report/i,
    /history.*report/i,
    /report ai summary/i,
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
  propose_create_daily_record: [
    /帮我记/,
    /记一下/,
    /记录一下/,
    /添加记录/,
    /新增记录/,
    /save this/i,
    /log this/i,
    /record this/i,
    /add a record/i,
  ],
  propose_update_daily_record: [
    /修改记录/,
    /更新记录/,
    /改一下记录/,
    /记录.*改一下/,
    /记录.*修改/,
    /备注.*改一下/,
    /备注.*修改/,
    /title.*update/i,
    /note.*update/i,
    /edit record/i,
    /update record/i,
    /change record/i,
  ],
  propose_delete_daily_record: [
    /删除记录/,
    /删掉记录/,
    /去掉记录/,
    /记录.*删除/,
    /记录.*删掉/,
    /delete record/i,
    /remove record/i,
  ],
  propose_update_user_settings: [
    /打开.*ai/,
    /关闭.*ai/,
    /关掉.*ai/,
    /打开.*记忆/,
    /关闭.*记忆/,
    /关掉.*记忆/,
    /打开.*权限/,
    /关闭.*权限/,
    /关掉.*权限/,
    /assistant memory/i,
    /turn on/i,
    /turn off/i,
    /enable/i,
    /disable/i,
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

const WRITE_INTENT_RULES = [
  /帮我记/,
  /记一下/,
  /记录一下/,
  /添加/,
  /新增/,
  /修改/,
  /更新/,
  /删除/,
  /删掉/,
  /关掉/,
  /save/i,
  /log/i,
  /record/i,
  /update/i,
  /delete/i,
  /remove/i,
  /turn on/i,
  /turn off/i,
  /enable/i,
  /disable/i,
] as const;

export function selectRelevantToolsForMessage(
  userMessage: string,
  allowedTools: readonly AssistantToolName[],
): AssistantToolName[] {
  const normalized = userMessage.toLowerCase();
  const broadRecordTools = allowedTools.filter(
    (toolName) =>
      toolName === 'get_today_records' ||
      toolName === 'get_records_by_date' ||
      toolName === 'get_records_by_range',
  );
  const summaryPointTools = allowedTools.filter(
    (toolName) =>
      toolName === 'get_today_summary_by_date' ||
      toolName === 'get_report_summary_by_range',
  );
  const sleepTools = allowedTools.filter(
    (toolName) => toolName === 'get_sleep_summary_by_range',
  );

  const matched = allowedTools.filter((toolName) =>
    TOOL_KEYWORD_RULES[toolName].some((rule) => rule.test(userMessage)),
  );

  if (matched.length > 0) {
    const matchedReadTools = matched.filter(
      (toolName) => !toolName.startsWith('propose_'),
    );
    const matchedWriteTools = matched.filter((toolName) =>
      toolName.startsWith('propose_'),
    );

    if (
      /历史.*today|历史.*总结|之前.*today|以前.*today|past today|recent today/i.test(
        userMessage,
      ) &&
      matchedReadTools.includes('get_recent_today_summaries')
    ) {
      return ['get_recent_today_summaries'];
    }

    if (
      /历史.*报告|之前.*报告|以前.*报告|past report|recent report|weekly summary|monthly summary/i.test(
        userMessage,
      ) &&
      matchedReadTools.includes('get_recent_report_summaries')
    ) {
      return ['get_recent_report_summaries'];
    }

    if (
      summaryPointTools.includes('get_today_summary_by_date') &&
      /今天总结|当日总结|today summary|today analysis/i.test(userMessage) &&
      /(昨天|前天|\b\d{4}-\d{2}-\d{2}\b|\d{1,2}月\d{1,2}日)/.test(userMessage)
    ) {
      return ['get_today_summary_by_date'];
    }
    if (
      summaryPointTools.includes('get_report_summary_by_range') &&
      /周报|月报|报告总结|报告分析|report summary/i.test(userMessage)
    ) {
      return ['get_report_summary_by_range'];
    }

    if (matchedWriteTools.length > 0) {
      if (
        /删|删除|remove|delete/.test(normalized) &&
        matchedWriteTools.includes('propose_delete_daily_record')
      ) {
        return ['propose_delete_daily_record'];
      }
      if (/改|修改|更新|edit|update|change/.test(normalized)) {
        if (matchedWriteTools.includes('propose_update_user_settings')) {
          return ['propose_update_user_settings'];
        }
        if (matchedWriteTools.includes('propose_update_daily_record')) {
          return ['propose_update_daily_record'];
        }
      }
      if (
        matchedWriteTools.includes('propose_create_daily_record') &&
        /记|记录|添加|新增|save|log|record|add/.test(normalized)
      ) {
        const selected: AssistantToolName[] = [];
        if (broadRecordTools.includes('get_today_records')) {
          selected.push('get_today_records');
        }
        selected.push('propose_create_daily_record');
        return selected;
      }
      const firstMatchedWriteTool = matchedWriteTools[0];
      return firstMatchedWriteTool == null ? [] : [firstMatchedWriteTool];
    }

    const withRangeFallback: AssistantToolName[] =
      matchedReadTools.includes('get_records_by_range') &&
      broadRecordTools.includes('get_records_by_range')
        ? [
            ...new Set<AssistantToolName>([
              ...matchedReadTools,
              'get_records_by_range',
            ]),
          ]
        : matchedReadTools;
    return withRangeFallback;
  }

  const writeTools = allowedTools.filter((toolName) =>
    toolName.startsWith('propose_'),
  );
  if (
    writeTools.length > 0 &&
    WRITE_INTENT_RULES.some((rule) => rule.test(userMessage))
  ) {
    if (/删|删除|remove|delete/.test(normalized)) {
      return writeTools.includes('propose_delete_daily_record')
        ? ['propose_delete_daily_record']
        : [];
    }
    if (
      /设置|权限|开关|记忆|ai|setting|permission|toggle|memory/.test(normalized)
    ) {
      return writeTools.includes('propose_update_user_settings')
        ? ['propose_update_user_settings']
        : [];
    }
    if (/改|修改|更新|edit|update|change/.test(normalized)) {
      return writeTools.includes('propose_update_daily_record')
        ? ['propose_update_daily_record']
        : [];
    }
    if (
      writeTools.includes('propose_create_daily_record') &&
      /记|记录|添加|新增|save|log|record|add/.test(normalized)
    ) {
      const selected: AssistantToolName[] = [];
      if (broadRecordTools.includes('get_today_records')) {
        selected.push('get_today_records');
      }
      selected.push('propose_create_daily_record');
      return selected;
    }
    return [];
  }

  if (
    broadRecordTools.length > 0 &&
    /改|修改|更新|edit|update|change|删|删除|remove|delete/.test(normalized)
  ) {
    return [];
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

export function buildAssistantRuntimeGraph() {
  return new StateGraph(AssistantRuntimeState)
    .addNode('prepare_context', (state) => ({
      allowedTools: selectAllowedToolsForContextSources(
        state.enabledContextSources,
      ),
      selectedTools: selectRelevantToolsForMessage(
        state.userMessage,
        selectAllowedToolsForContextSources(state.enabledContextSources),
      ),
      route: ASSISTANT_ROUTE,
    }))
    .addNode('respond', () => ({}))
    .addEdge(START, 'prepare_context')
    .addEdge('prepare_context', 'respond')
    .addEdge('respond', END)
    .compile();
}
