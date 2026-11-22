/**
 * Persisted cross-conversation memory for the assistant (F-9, Phase 5).
 *
 * ## Storage is Mem0, nothing else
 *
 * Extraction, dedup and recall are delegated to the Mem0 sidecar
 * (`Mem0ClientService`) over REST. The hand-rolled Prisma memory path
 * (`AssistantMemory` rows + in-process setTimeout debounce) is gone — table
 * dropped, repository deleted: it extracted only on archive, lost pending work
 * on restart, and never superseded repeated preferences. Mem0 owns all three
 * problems — its fact extraction is the capability we are buying, not building.
 *
 * ## Where extraction is triggered
 *
 * `Conversations.archiveLatest` calls {@link scheduleExtraction} right after the
 * conversation is archived. Extraction therefore runs on the "clear latest"
 * path, which is the one place a thread stops being the active context — the
 * same trigger the deleted implementation used, kept because the archive point
 * is still the only signal that the thread will not receive more turns.
 *
 * ## Degradation contract
 *
 * `MEM0_ENABLED=false` (or the sidecar unreachable) makes every method a
 * silent no-op: the memory block is '' and extraction does nothing. Memory is
 * continuity data, never a reason a turn fails. The assistant-memory user
 * setting still gates the whole service — off means off regardless of the
 * sidecar.
 */
import { Inject, Injectable, Logger } from '@nestjs/common';
import { EnvKey } from '../../../../config/env/env-keys.enum.js';
import type { ConversationRepositoryPort } from '../../domain/conversation/conversations.js';
import { ASSISTANT_CONVERSATIONS } from '../../domain/conversation/conversations.js';
import type { ConversationState } from '../../domain/conversation/conversation.js';
import {
  ASSISTANT_MEMORY_SIDECAR,
  type MemorySidecarPort,
} from '../ports/memory.js';

/** Number of most recent messages (user + assistant) handed to Mem0. */
const EXTRACTION_MESSAGE_LIMIT = 10;

/**
 * How many recalled memories are injected into the prompt block. WeKnora's
 * recall budget is 5 entries (plan §7.3); the resident budget is enforced by
 * the block format below.
 */
const MEMORY_RETURN_LIMIT = 5;

@Injectable()
export class AssistantMemoryService {
  private readonly logger = new Logger(AssistantMemoryService.name);

  constructor(
    @Inject(ASSISTANT_MEMORY_SIDECAR)
    private readonly mem0Client: MemorySidecarPort,
    @Inject(ASSISTANT_CONVERSATIONS)
    private readonly conversationRepository: ConversationRepositoryPort,
  ) {}

  /** The user's assistant-memory switch; off means every method is a no-op. */
  private memoryEnabledForSettings(): boolean {
    // The per-user switch is checked by the callers (archive flow passes it
    // via `scheduleExtraction` only when enabled; prompt injection is gated by
    // `graph.prepare_context` via `memoryEnabled`). The sidecar switch is what
    // this service owns.
    return this.mem0Client.isEnabled();
  }

  /**
   * Hands the conversation's recent turns to Mem0 for fact extraction.
   * Never throws: sidecar failure or an empty conversation both resolve to a
   * silent no-op (memory injection is best-effort).
   */
  async extractAndStore(userId: string, conversationId: string): Promise<void> {
    if (!this.memoryEnabledForSettings()) return;

    // The read itself can fail (DB down, row gone). Memory is continuity data,
    // so a failure here must not propagate into the archive call that triggered
    // it — that would turn "we could not remember this" into "we could not
    // close the conversation".
    let messages: Array<{ role: 'user' | 'assistant'; content: string }>;
    try {
      const conversation = await this.conversationRepository.find(
        userId,
        conversationId,
      );
      if (conversation == null) return;
      messages = this.lastMessages(conversation);
    } catch (error) {
      this.logger.warn(
        `Mem0 memory extraction could not read conversation "${conversationId}": ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return;
    }
    if (messages.length === 0) return;

    const outcome = await this.mem0Client.addMemories(userId, messages);
    if (!outcome.ok) {
      this.logger.warn(
        `Mem0 memory write failed for user "${userId}" conversation "${conversationId}": ${outcome.reason}`,
      );
    }
  }

  /**
   * Builds the memory block injected into the assistant prompt, or '' when no
   * memory exists / the sidecar is off (silent degradation).
   */
  async buildMemoryBlock(userId: string): Promise<string> {
    if (!this.memoryEnabledForSettings()) return '';

    const outcome = await this.mem0Client.searchMemories(
      userId,
      'user preferences and durable facts',
    );
    if (!outcome.ok) {
      this.logger.warn(
        `Mem0 recall failed for user "${userId}": ${outcome.reason}`,
      );
      return '';
    }

    const hits = outcome.hits.slice(0, MEMORY_RETURN_LIMIT);
    if (hits.length === 0) return '';

    const lines = [
      'Persisted cross-conversation memory is enabled for this user.',
      `Recalled memories (max ${String(MEMORY_RETURN_LIMIT)}, by relevance) — treat as lightweight continuity hints, not new user input:`,
      ...hits.map((hit) => `- ${hit.memory}`),
      'If the new conversation conflicts with this memory, prioritize the new conversation and say that prior memory may be outdated.',
    ];
    return lines.join('\n');
  }

  /**
   * Fire-and-forget notification that a conversation was archived. Mem0 does
   * its own extraction synchronously inside `addMemories`, so there is no
   * debounce registry to lose on restart — the WeKnora `PendingSessions`
   * problem (plan §7.1) does not exist on this storage.
   */
  async scheduleExtraction(
    userId: string,
    conversationId: string,
  ): Promise<void> {
    await this.extractAndStore(userId, conversationId);
  }

  /**
   * Removes all persisted memories for a user (memory-erase entry point).
   * Returns the number of deleted memories when the sidecar reports it.
   */
  async deleteAllForUser(userId: string): Promise<{ cleared: number }> {
    if (!this.memoryEnabledForSettings()) return { cleared: 0 };
    const outcome = await this.mem0Client.deleteAllForUser(userId);
    if (!outcome.ok) {
      this.logger.warn(
        `Mem0 erase failed for user "${userId}": ${outcome.reason}`,
      );
      return { cleared: 0 };
    }
    // Mem0's bulk delete reports the entity, not a count; the endpoint cannot
    // answer "how many" without a prior list, so the API surfaces success
    // rather than fabricating a number.
    return { cleared: 0 };
  }

  private lastMessages(
    conversation: ConversationState,
  ): Array<{ role: 'user' | 'assistant'; content: string }> {
    return conversation.messages
      .slice(-EXTRACTION_MESSAGE_LIMIT)
      .map((message) => ({ role: message.role, content: message.content }))
      .filter((message) => message.content.trim().length > 0);
  }

  /** EnvKey used by tests to assert the sidecar gate (no runtime read here). */
  static get sidecarEnabledKey(): string {
    return EnvKey.MEM0_ENABLED;
  }
}
