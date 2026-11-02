/**
 * Pure unit tests for the `Memory` aggregate: what may be stored, what reaches the
 * prompt, and how the block renders.
 */
import {
  MAX_MEMORY_ITEM_LENGTH,
  MAX_MEMORY_ITEMS,
  buildMemoryBlock,
  isDurableMemory,
  normalizeExtractedMemories,
  selectInjectableMemories,
  type MemoryItem,
} from './memory.js';

const T0 = new Date('2026-10-25T08:00:00.000Z');

function item(index: number, content = `memory ${String(index)}`): MemoryItem {
  return {
    id: `m${String(index)}`,
    content,
    sourceConversationId: `conversation-${String(index)}-abcdef`,
    createdAt: new Date(T0.getTime() - index * 1_000),
  };
}

describe('Memory', () => {
  it('drops empty and over-long statements', () => {
    expect(isDurableMemory('   ')).toBe(false);
    expect(isDurableMemory('x'.repeat(MAX_MEMORY_ITEM_LENGTH + 1))).toBe(false);
    expect(isDurableMemory('用户每天早上服用二甲双胍')).toBe(true);
  });

  it('normalizes, deduplicates and stamps the source conversation', () => {
    expect(
      normalizeExtractedMemories(
        ['  喜欢  早上锻炼 ', '喜欢 早上锻炼', '  ', 'prefers tea'],
        'conv-1',
      ),
    ).toEqual([
      { content: '喜欢 早上锻炼', sourceConversationId: 'conv-1' },
      { content: 'prefers tea', sourceConversationId: 'conv-1' },
    ]);
  });

  it('injects at most MAX_MEMORY_ITEMS memories, newest first', () => {
    const items = Array.from({ length: MAX_MEMORY_ITEMS + 3 }, (_, index) =>
      item(index),
    );
    const selected = selectInjectableMemories(items);
    expect(selected).toHaveLength(MAX_MEMORY_ITEMS);
    expect(selected[0]?.id).toBe('m0');
  });

  it('renders an empty block as an empty string, never a header', () => {
    expect(buildMemoryBlock([])).toBe('');
  });

  it('renders each memory with a truncated source conversation id', () => {
    const block = buildMemoryBlock([item(0, '喜欢早上锻炼')]);
    expect(block).toContain('喜欢早上锻炼');
    expect(block).toContain('conversa');
    expect(block).not.toContain('conversation-0-abcdef');
    expect(block).toContain('prioritize the new conversation');
  });
});
