/**
 * Response shapes the application layer produces (ADR-0024 `application/ports`).
 *
 * These used to live only as `z.infer` types inside `adapters/http/dto`, which
 * made the application layer import its own delivery adapters just to name its
 * output. The dependency now points the useful way: the DTO schemas are pinned to
 * these types with `satisfies`, so a wire change that drops a field fails to
 * compile here instead of silently narrowing what a use case returns.
 *
 * Types only — no zod, no Nest, no Prisma.
 */

import type { ToolDisabledReason, ToolName } from '../../domain/policies/tool-permission.js';
import type { ProposedAction } from '../../domain/proposal/proposed-action.js';

/** One tool's capability snapshot, as the capabilities endpoint reports it. */
export interface ToolCapabilityView {
  name: ToolName;
  requiredContextSources: string[];
  permittedByUser: boolean;
  implemented: boolean;
  enabled: boolean;
  disabledReason: ToolDisabledReason | null;
}

/** `GET capabilities` payload. */
export interface AssistantCapabilitiesView {
  phase: 'foundation';
  assistantEnabled: boolean;
  assistantMemoryEnabled: boolean;
  assistantContext: {
    healthProfile: boolean;
    dailyRecords: boolean;
    sleepRecords: boolean;
    currentMedicines: boolean;
  };
  chatModelConfigured: boolean;
  interactiveChatReady: boolean;
  langGraphReady: boolean;
  streamingSupported: true;
  streamingTransport: 'sse';
  markdownRenderingRecommended: true;
  ragEnabled: boolean;
  tools: ToolCapabilityView[];
  updatedAt: string | null | undefined;
}

/** One message of a stored conversation. */
export interface ConversationMessageView {
  role: 'user' | 'assistant';
  content: string;
  usedTools: string[];
  createdAt: string;
}

/** The full conversation resource. */
export interface AssistantConversationView {
  id: string;
  title: string | null;
  status: 'active' | 'archived' | 'deleted';
  messages: ConversationMessageView[];
  lastMessageAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/** An entry of the recent-conversation list. */
export interface AssistantConversationSummaryView {
  id: string;
  title: string | null;
  status: 'active' | 'archived' | 'deleted';
  lastMessageAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/** A message the client sends for this turn. */
export interface AssistantInputMessageView {
  role: 'user' | 'assistant';
  content: string;
}

/** `POST messages/stream` request body. */
export interface StreamAssistantMessagesView {
  messages: AssistantInputMessageView[];
  conversationId?: string | undefined;
}

/** Decision the user sends on `POST conversations/:id/confirm`. */
export interface ConfirmAssistantProposalView {
  decision: 'approved' | 'rejected';
  proposalIds: string[];
  note?: string | undefined;
}

/** Result of a confirm (also the response body). */
export interface AssistantConfirmResultView {
  conversationId: string;
  decision: 'approved' | 'rejected';
  status: 'approved' | 'rejected';
  finalContent: string | null;
}

/** One tool's execution detail attached to a streamed result. */
export interface AssistantToolDetailView {
  name: ToolName;
  label?: string;
  coverage?: Record<string, unknown>;
  confidence?: Record<string, unknown>;
  ambiguities?: string[];
  source?: Record<string, unknown>;
  disclaimer?: string | null;
  citations?: unknown[];
  executedQuery?: string;
}

/** `result` event of the SSE stream. */
export interface AssistantMessageDataView {
  conversationId: string;
  role: 'assistant';
  content: string;
  generatedAt: string;
  usedTools: ToolName[];
  proposedActions?: ProposedAction[];
  toolDetails?: AssistantToolDetailView[];
}

/** \`POST latest/clear\` payload. */
export interface AssistantClearResultDataView {
  cleared: boolean;
  archivedConversationId: string | null;
}

/** \`DELETE memory\` payload. */
export interface AssistantClearMemoryDataView {
  cleared: number;
}
