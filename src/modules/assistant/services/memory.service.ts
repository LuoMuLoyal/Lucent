/**
 * Persisted cross-conversation memory for the assistant (F-9).
 *
 * Replaces the previous raw-text memory block: instead of dumping the last
 * conversations' raw messages into the prompt, archived conversations are
 * distilled (in a debounced background task) into short structured memory
 * points/preferences, persisted via AssistantMemoryRepository. The prompt
 * memory block then returns at most MEMORY_RETURN_LIMIT persisted memories.
 *
 * All LLM/parsing failures degrade silently: extraction never throws into
 * the archive flow, and buildMemoryBlock returns '' when no memory exists.
 */
import { Injectable, Logger } from '@nestjs/common';
import { trace } from '@opentelemetry/api';
import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import { AI_MODEL_TIMEOUT_MS } from '../../../config/app-defaults.constants.js';
import { LlmRuntimeService } from '../../../llm-runtime/index.js';
import type {
  DomainFailure,
  ResultAsync,
} from '../../../common/result/index.js';
import {
  AssistantConversationRepositoryPort,
  type ConversationWithMessages,
} from '../repositories/conversation.repository.js';
import { AssistantMemoryRepositoryPort } from '../repositories/memory.repository.js';

/** Independent guard for providers that ignore the model client's timeout. */
export const MEMORY_EXTRACTION_TIMEOUT_MS = AI_MODEL_TIMEOUT_MS + 1_000;

const MEMORY_EXTRACTION_TIMEOUT = Symbol('memory-extraction-timeout');

/** Debounce window: extraction starts 30s after the last archive event. */
const EXTRACTION_DEBOUNCE_MS = 30_000;

/** Number of most recent messages (user + assistant) fed to extraction. */
const EXTRACTION_MESSAGE_LIMIT = 10;

/** Maximum number of persisted memories injected into the prompt block. */
const MEMORY_RETURN_LIMIT = 5;

const CHAT_MODEL_OPTIONS = {
  timeout: AI_MODEL_TIMEOUT_MS,
  temperature: 0,
  maxRetries: 0,
} as const;

const EXTRACTION_SYSTEM_PROMPT = [
  'You are a memory summarizer for a personal health assistant.',
  'Read the conversation transcript and extract durable, cross-conversation useful memory points only:',
  '- Stable preferences or choices the user explicitly expressed.',
  '- Recurring facts or stable personal circumstances the user stated.',
  'Discard one-off questions and answers, and discard any medical advice (assistant suggestions are not memory).',
  'Output ONLY a JSON array of strings. Each string is one short sentence (at most ~30 words).',
  'Output [] when nothing durable was said.',
  "Write in the same language as the user's messages (use Chinese when the user writes Chinese).",
].join(' ');

type PendingExtraction = {
  timer: NodeJS.Timeout;
  conversationIds: Set<string>;
};

@Injectable()
export class AssistantMemoryService {
  private readonly logger = new Logger(AssistantMemoryService.name);

  /**
   * In-process debounce registry keyed by userId. Pending extractions for the
   * same user are merged (conversation ids accumulate, timer resets) so a
   * burst of archive events triggers one extraction run. Entries are dropped
   * after the run; on process restart pending tasks are lost, which is
   * acceptable — extraction is best-effort continuity data.
   */
  private readonly pendingExtractions = new Map<string, PendingExtraction>();

  constructor(
    private readonly memoryRepository: AssistantMemoryRepositoryPort,
    private readonly llmRuntimeService: LlmRuntimeService,
    private readonly conversationRepository: AssistantConversationRepositoryPort,
  ) {}

  /**
   * Extracts durable memory points from a conversation and persists them.
   * Never throws: LLM failure, parse failure or an empty conversation all
   * resolve to a silent no-op (memory injection is best-effort).
   */
  async extractAndStore(userId: string, conversationId: string): Promise<void> {
    const conversation = await this.conversationRepository.findWithMessages(
      userId,
      conversationId,
    );
    if (conversation == null) {
      return;
    }

    const messages = this.lastMessages(conversation);
    if (messages.length === 0) {
      return;
    }

    const items = await this.extractMemoryItems(messages);
    if (items.length === 0) {
      return;
    }

    // Best-effort persistence: a failure is logged and the extraction is
    // dropped (memory injection must never break the archive flow).
    await this.memoryRepository
      .createMany(
        userId,
        items.map((content) => ({
          sourceConversationId: conversationId,
          content,
        })),
      )
      .match(
        () => undefined,
        (failure) => {
          this.logger.warn(
            `Memory persistence failed for user "${userId}" conversation "${conversationId}": ${failure.code}`,
          );
        },
      );
  }

  /**
   * Builds the persisted memory block injected into the assistant prompt, or
   * '' when no memory exists (silent degradation).
   */
  async buildMemoryBlock(userId: string): Promise<string> {
    const memories = await this.memoryRepository.findRecent(
      userId,
      MEMORY_RETURN_LIMIT,
    );
    if (memories.length === 0) {
      return '';
    }

    const lines = [
      'Persisted cross-conversation memory is enabled for this user.',
      'Structured memories (max 5, newest first) — treat as lightweight continuity hints, not new user input:',
      ...memories.map(
        (memory) =>
          `- ${memory.content} (source conversation: ${memory.sourceConversationId.slice(0, 8)})`,
      ),
      'If the new conversation conflicts with this memory, prioritize the new conversation and say that prior memory may be outdated.',
    ];

    return lines.join('\n');
  }

  /**
   * Schedules extraction for a conversation after it was archived. Same-user
   * schedules are merged into one debounced run (see EXTRACTION_DEBOUNCE_MS).
   *
   * The method is async so callers (archive flow) can await it uniformly;
   * it never throws — it only registers/merges a timer.
   */
  // eslint-disable-next-line @typescript-eslint/require-await
  async scheduleExtraction(
    userId: string,
    conversationId: string,
  ): Promise<void> {
    const existing = this.pendingExtractions.get(userId);
    if (existing != null) {
      existing.conversationIds.add(conversationId);
      clearTimeout(existing.timer);
      existing.timer = setTimeout(() => {
        void this.flushPending(userId);
      }, EXTRACTION_DEBOUNCE_MS);
      return;
    }

    const entry: PendingExtraction = {
      conversationIds: new Set([conversationId]),
      timer: setTimeout(() => {
        void this.flushPending(userId);
      }, EXTRACTION_DEBOUNCE_MS),
    };
    this.pendingExtractions.set(userId, entry);
  }

  /**
   * Removes all persisted memories for a user (memory-erase entry point).
   * Returns the number of deleted memory rows so the API can surface it.
   */
  deleteAllForUser(userId: string): ResultAsync<number, DomainFailure> {
    return this.memoryRepository.deleteAllForUser(userId);
  }

  private lastMessages(
    conversation: ConversationWithMessages,
  ): Array<{ role: 'user' | 'assistant'; content: string }> {
    return conversation.messages
      .slice(-EXTRACTION_MESSAGE_LIMIT)
      .map((message) => ({ role: message.role, content: message.content }))
      .filter((message) => message.content.trim().length > 0);
  }

  /**
   * Calls the chat model to extract durable memory points. Any failure
   * (unconfigured model, LLM error, non-JSON output) resolves to [] silently.
   */
  private async extractMemoryItems(
    messages: Array<{ role: 'user' | 'assistant'; content: string }>,
  ): Promise<string[]> {
    const transcript = messages
      .map(
        (message) =>
          `${message.role === 'user' ? 'User' : 'Assistant'}: ${message.content.replace(/\s+/g, ' ').trim()}`,
      )
      .join('\n');

    const model = this.llmRuntimeService.createChatModel(
      'chat',
      CHAT_MODEL_OPTIONS,
    );

    let rawContent: unknown;
    try {
      const response = await Promise.race([
        model.invoke([
          new SystemMessage(EXTRACTION_SYSTEM_PROMPT),
          new HumanMessage(transcript),
        ]),
        new Promise<typeof MEMORY_EXTRACTION_TIMEOUT>((resolve) => {
          const timer = setTimeout(() => {
            resolve(MEMORY_EXTRACTION_TIMEOUT);
          }, MEMORY_EXTRACTION_TIMEOUT_MS);
          timer.unref();
        }),
      ]);
      if (response === MEMORY_EXTRACTION_TIMEOUT) {
        this.logger.warn(
          `Memory extraction timed out after ${String(MEMORY_EXTRACTION_TIMEOUT_MS)}ms.`,
        );
        trace.getActiveSpan()?.addEvent('assistant.memory_extraction.timeout', {
          timeout_ms: MEMORY_EXTRACTION_TIMEOUT_MS,
        });
        return [];
      }
      rawContent = response.content;
    } catch (error) {
      this.logger.debug(
        `Memory extraction skipped (LLM failure): ${(error as Error).message}`,
      );
      return [];
    }

    const items = this.parseExtractionResponse(rawContent);
    if (items.length === 0) {
      this.logger.debug('Memory extraction produced no durable items.');
    }
    return items;
  }

  /**
   * Parses the model's JSON-array output. Returns [] on any parse failure so
   * extraction degrades silently.
   */
  private parseExtractionResponse(content: unknown): string[] {
    if (typeof content !== 'string' || content.trim().length === 0) {
      return [];
    }

    let text = content.trim();
    const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (fenced?.[1] != null) {
      text = fenced[1].trim();
    }

    try {
      const parsed: unknown = JSON.parse(text);
      if (!Array.isArray(parsed)) {
        return [];
      }
      return parsed
        .filter(
          (item): item is string =>
            typeof item === 'string' && item.trim().length > 0,
        )
        .map((item) => item.trim());
    } catch (error) {
      this.logger.warn(
        `Failed to parse JSON array, returning empty: ${error instanceof Error ? error.message : String(error)}`,
      );
      return [];
    }
  }

  private async flushPending(userId: string): Promise<void> {
    const entry = this.pendingExtractions.get(userId);
    if (entry == null) {
      return;
    }
    this.pendingExtractions.delete(userId);

    for (const conversationId of entry.conversationIds) {
      try {
        await this.extractAndStore(userId, conversationId);
      } catch (error) {
        // Extraction must never break the archive flow or crash the process.
        this.logger.warn(
          `Memory extraction failed for user "${userId}" conversation "${conversationId}": ${(error as Error).message}`,
        );
      }
    }
  }
}
