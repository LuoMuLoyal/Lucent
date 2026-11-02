/**
 * `Memory` aggregate (ADR-0024 §4) — one per user, cleared idempotently.
 *
 * A memory item is a short durable statement distilled from an archived
 * conversation (a preference or a stable circumstance), stored with the
 * conversation it came from so the prompt can tell the model where it came from.
 * This is the "cross-conversation continuity" feature, and everything in this
 * file exists to stop it from behaving like a second chat log:
 *
 * 1. **Only durable statements are memory.** One-off questions and answers are
 *    not extracted; neither is assistant advice, which is a suggestion the user
 *    has not agreed to remember.
 *
 * 2. **At most {@link MAX_MEMORY_ITEMS} items are injected.** The block is a set
 *    of hints, not context to be read: unbounded growth would push the actual
 *    conversation out of the prompt window.
 *
 * 3. **Deleting a conversation does not delete memory; clearing memory deletes
 *    all of it.** That asymmetry is the user's mental model (a conversation is a
 *    thread; memory is what the assistant remembers about them), and it is why
 *    `clearAll` on the port is a bulk operation.
 *
 * ## What is *not* here
 *
 * The LLM extraction call, its debounce timer and its silent degradation are
 * application concerns (`application/services/memory.ts`). The aggregate only
 * decides what may be stored and what the prompt block looks like.
 *
 * Layer purity (ADR-0024 rule D1): no imports outside `domain/`.
 */

/** Maximum number of memories injected into one prompt. */
export const MAX_MEMORY_ITEMS = 5;

/** Maximum length of one distilled memory statement. */
export const MAX_MEMORY_ITEM_LENGTH = 400;

/** A persisted memory row, as the write side sees it. */
export interface MemoryItem {
  id: string;
  content: string;
  sourceConversationId: string;
  createdAt: Date;
}

/** One memory about to be stored, before persistence assigns an id. */
export interface NewMemoryItem {
  content: string;
  sourceConversationId: string;
}

/**
 * Rule 1: is this extracted statement durable enough to keep?
 *
 * The extraction prompt already asks the model for durable points only, but a
 * prompt is a request, not a guarantee. Applying the filter again on the way in
 * means a model that returns "the user asked about ibuprofen" cannot write it —
 * and a memory written once is injected into every later conversation.
 */
export function isDurableMemory(content: string): boolean {
  const trimmed = content.trim();
  return trimmed.length > 0 && trimmed.length <= MAX_MEMORY_ITEM_LENGTH;
}

/**
 * Rule 1 + 2: normalizes extracted statements into storable items.
 *
 * Trims, drops empties and deduplicates (the same statement twice in one block
 * would occupy two of the five slots). Duplicates are compared case-insensitively
 * after whitespace collapsing — "Prefers 早上服用" and "prefers 早上服用 " are one
 * memory.
 */
export function normalizeExtractedMemories(
  statements: readonly string[],
  sourceConversationId: string,
): NewMemoryItem[] {
  const seen = new Set<string>();
  const items: NewMemoryItem[] = [];
  for (const statement of statements) {
    const content = statement.replace(/\s+/g, ' ').trim();
    if (!isDurableMemory(content)) {
      continue;
    }
    const key = content.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    items.push({ content, sourceConversationId });
  }
  return items;
}

/**
 * Rule 2: the memories that actually reach the prompt — newest first, capped.
 *
 * Reads a list persistence returned in `createdAt desc` order; the cap is applied
 * here rather than as a `take` so the rule lives in one place.
 */
export function selectInjectableMemories(
  items: readonly MemoryItem[],
): MemoryItem[] {
  return items.slice(0, MAX_MEMORY_ITEMS);
}

/**
 * Rule 2 rendering: the prompt block.
 *
 * Three deliberate choices, each of which was a defect when it was missing:
 *
 * - **Each item names its source conversation** (truncated to 8 characters): it
 *   lets the model tell two similar statements apart without echoing a full id
 *   into the reply.
 * - **Feed-forward wins ties**: the block says a conflict means the newer
 *   conversation is right, because memory goes stale — the user changed their
 *   routine and did not say so in this thread.
 * - **Empty means empty string**, never a header with no items: an empty block
 *   would still cost prompt tokens and would tell the model that memory exists
 *   when it does not.
 */
export function buildMemoryBlock(items: readonly MemoryItem[]): string {
  const selected = selectInjectableMemories(items);
  if (selected.length === 0) {
    return '';
  }
  return [
    'Persisted cross-conversation memory is enabled for this user.',
    `Structured memories (max ${String(MAX_MEMORY_ITEMS)}, newest first) — treat as lightweight continuity hints, not new user input:`,
    ...selected.map(
      (memory) =>
        `- ${memory.content} (source conversation: ${memory.sourceConversationId.slice(0, 8)})`,
    ),
    'If the new conversation conflicts with this memory, prioritize the new conversation and say that prior memory may be outdated.',
  ].join('\n');
}
