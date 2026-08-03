import { END, START, StateGraph } from '@langchain/langgraph';
import { SystemMessage } from '@langchain/core/messages';
import type { AssistantToolName } from '../../../tools/shared/tool-types';
import { MAX_TOOL_LOOPS } from '../../../tools/shared/tool-constants';
import { AssistantRuntimeState } from '../state';
import { createAgentNode, createToolsNode } from '../nodes';
import { validateReadResults } from '../validate';
import type { AssistantGraphDeps } from '../graph';

/**
 * Dependency order for knowledge-retrieval tools: a medicine leaflet query
 * first resolves the product, then fetches detail, then the leaflet; DrugBank
 * resolves an entity before fetching detail/passages. Reordering the bound
 * tools in this order nudges the LLM to follow the dependency chain.
 */
const KNOWLEDGE_TOOL_ORDER: readonly AssistantToolName[] = [
  'search_cn_medicine_products',
  'get_cn_medicine_detail',
  'search_medicine_leaflets',
  'resolve_drugbank_entity',
  'get_drugbank_detail',
  'search_drugbank_passages',
  'search_medical_qa_corpus',
];

function orderKnowledgeTools(
  tools: readonly AssistantToolName[],
): AssistantToolName[] {
  return [...tools].sort((left, right) => {
    const leftIndex = KNOWLEDGE_TOOL_ORDER.indexOf(left);
    const rightIndex = KNOWLEDGE_TOOL_ORDER.indexOf(right);
    const normalizedLeft =
      leftIndex === -1 ? Number.MAX_SAFE_INTEGER : leftIndex;
    const normalizedRight =
      rightIndex === -1 ? Number.MAX_SAFE_INTEGER : rightIndex;
    return normalizedLeft - normalizedRight;
  });
}

/**
 * Builds the knowledge-retrieval sub-graph.
 *
 * ```
 * START → knowledge_route → knowledge_agent ↔ knowledge_tools → knowledge_validate → END
 * ```
 *
 * - `knowledge_route` reorders the narrowed tools along the dependency chain
 *   (product → detail → leaflet / entity → detail → passages).
 * - `knowledge_agent` binds the ordered tools and calls the LLM with the
 *   knowledge system prompt (evidence-source separation).
 * - `knowledge_validate` inspects envelope coverage; zero hits set
 *   `stopReason: 'no_evidence'` so the reply says evidence was not found.
 */
export function buildKnowledgeSubGraph(
  deps: Pick<AssistantGraphDeps, 'createModel' | 'executeTools' | 'onText'>,
) {
  return new StateGraph(AssistantRuntimeState)
    .addNode('knowledge_route', (state) => ({
      relevantTools: orderKnowledgeTools(state.relevantTools),
    }))
    .addNode('knowledge_agent', createAgentNode(deps))
    .addNode('knowledge_tools', createToolsNode(deps))
    .addNode('knowledge_validate', (state) => {
      const validationFlags = validateReadResults(state.toolResults);
      const messages = [...state.messages];

      if (validationFlags.hasEmptyResults) {
        messages.push(
          new SystemMessage(
            'All retrieval tools returned no evidence. Say the evidence was not found instead of guessing.',
          ),
        );
      }
      if (validationFlags.hasPartialCoverage) {
        messages.push(
          new SystemMessage(
            'Retrieval coverage is partial. Distinguish what the source explicitly says from your own inference.',
          ),
        );
      }

      return {
        validationFlags,
        messages,
        stopReason: validationFlags.hasEmptyResults
          ? ('no_evidence' as const)
          : state.stopReason,
      };
    })
    .addEdge(START, 'knowledge_route')
    .addEdge('knowledge_route', 'knowledge_agent')
    .addConditionalEdges('knowledge_agent', (state) => {
      if (
        state.pendingToolCalls.length > 0 &&
        state.loopCount < MAX_TOOL_LOOPS
      ) {
        return 'knowledge_tools';
      }
      return 'knowledge_validate';
    })
    .addEdge('knowledge_tools', 'knowledge_agent')
    .addEdge('knowledge_validate', END)
    .compile();
}
