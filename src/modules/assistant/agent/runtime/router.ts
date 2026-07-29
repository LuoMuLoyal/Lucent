import {
  ASSISTANT_TOOL_SOURCE_MAP,
  type AssistantContextSource,
  type AssistantToolName,
} from '../../tools/shared/tool-types';
import {
  TOOL_KEYWORD_RULES,
  BROAD_RECORD_QUERY_RULES,
  BROAD_PERSONALIZED_QUERY_RULES,
  WRITE_INTENT_RULES,
  EXPLICIT_CN_PRODUCT_RULES,
  CN_LEAFLET_STYLE_RULES,
} from './tool-keyword-rules';

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

  const sortRetrievalTools = (
    toolNames: readonly AssistantToolName[],
  ): AssistantToolName[] => {
    const priority: AssistantToolName[] = [
      'search_cn_medicine_products',
      'get_cn_medicine_detail',
      'search_medicine_leaflets',
      'resolve_drugbank_entity',
      'get_drugbank_detail',
      'search_drugbank_passages',
      'search_medical_qa_corpus',
    ];

    return [...toolNames].sort((left, right) => {
      const leftPriority = priority.indexOf(left);
      const rightPriority = priority.indexOf(right);
      const normalizedLeft =
        leftPriority === -1 ? Number.MAX_SAFE_INTEGER : leftPriority;
      const normalizedRight =
        rightPriority === -1 ? Number.MAX_SAFE_INTEGER : rightPriority;
      return normalizedLeft - normalizedRight;
    });
  };

  const filterAvailable = (
    toolNames: readonly AssistantToolName[],
  ): AssistantToolName[] =>
    toolNames.filter((toolName): toolName is AssistantToolName =>
      allowedTools.includes(toolName),
    );

  if (EXPLICIT_CN_PRODUCT_RULES.some((rule) => rule.test(userMessage))) {
    return filterAvailable([
      'search_cn_medicine_products',
      'get_cn_medicine_detail',
      ...(CN_LEAFLET_STYLE_RULES.some((rule) => rule.test(userMessage))
        ? ['search_medicine_leaflets' as const]
        : []),
    ]);
  }

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
    return sortRetrievalTools(withRangeFallback);
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
    return sortRetrievalTools(allowedTools);
  }

  return [];
}
