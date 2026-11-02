/**
 * Pure unit tests for the `Conversation` aggregate: no Nest container, no Prisma,
 * no mocks — the aggregate is the thing under test.
 */
import {
  MAX_CONVERSATION_TITLE_LENGTH,
  MAX_RENAME_TITLE_LENGTH,
  Conversation,
  buildInitialTitle,
  normalizeRefinedTitle,
  orderMessages,
  type ConversationState,
} from './conversation.js';
import type { StoredConversationMessage } from './message.js';

const T0 = new Date('2026-10-25T08:00:00.000Z');

function stored(
  id: string,
  role: 'user' | 'assistant',
  content: string,
  offsetMs: number,
): StoredConversationMessage {
  return {
    id,
    role,
    content,
    usedTools: [],
    createdAt: new Date(T0.getTime() + offsetMs),
  };
}

function state(overrides: Partial<ConversationState> = {}): ConversationState {
  return {
    id: 'conv-1',
    userId: 'user-1',
    title: null,
    status: 'active',
    messages: [],
    lastMessageAt: null,
    createdAt: T0,
    updatedAt: T0,
    ...overrides,
  };
}

describe('Conversation', () => {
  describe('rule 1 — messages are totally ordered', () => {
    it('spaces user messages strictly before the assistant reply in one turn', () => {
      const conversation = Conversation.fromState(state());
      const assistantAt = new Date(T0.getTime() + 5_000);
      const plan = conversation.planTurn({
        incoming: [
          { role: 'user', content: 'first' },
          { role: 'user', content: 'second' },
        ],
        assistantContent: 'answer',
        usedTools: [],
        assistantAt,
      });
      if (!('turn' in plan)) throw new Error('expected a turn');
      const times = plan.turn.messages.map((m) => m.createdAt.getTime());
      expect(new Set(times).size).toBe(times.length);
      expect([...times].sort((a, b) => a - b)).toEqual(times);
      expect(plan.turn.messages.at(-1)?.role).toBe('assistant');
    });

    it('re-spaces stored rows that share a millisecond (the archived-conversation defect)', () => {
      const shared = new Date(T0.getTime());
      const ordered = orderMessages([
        {
          id: 'a',
          role: 'user',
          content: 'q',
          usedTools: [],
          createdAt: shared,
        },
        {
          id: 'b',
          role: 'assistant',
          content: 'a',
          usedTools: [],
          createdAt: shared,
        },
      ]);
      expect(ordered[0]?.createdAt.getTime()).toBe(shared.getTime());
      expect(ordered[1]?.createdAt.getTime()).toBe(shared.getTime() + 1);
    });

    it('leaves an already-ordered history untouched', () => {
      const messages = [
        stored('a', 'user', 'q', 0),
        stored('b', 'assistant', 'a', 10),
      ];
      expect(orderMessages(messages)).toEqual(messages);
    });

    it('appends only the suffix the conversation does not already have', () => {
      const conversation = Conversation.fromState(
        state({ messages: [stored('a', 'user', 'hello', 0)] }),
      );
      const plan = conversation.planTurn({
        incoming: [
          { role: 'user', content: 'hello' },
          { role: 'user', content: 'next' },
        ],
        assistantContent: 'answer',
        usedTools: [],
        assistantAt: new Date(T0.getTime() + 1_000),
      });
      if (!('turn' in plan)) throw new Error('expected a turn');
      expect(plan.turn.messages.map((m) => m.content)).toEqual([
        'next',
        'answer',
      ]);
    });

    it('treats whitespace-only messages as absent', () => {
      const conversation = Conversation.fromState(state());
      const plan = conversation.planTurn({
        incoming: [
          { role: 'user', content: '  ' },
          { role: 'user', content: ' real ' },
        ],
        assistantContent: 'answer',
        usedTools: [],
        assistantAt: new Date(T0.getTime() + 1_000),
      });
      if (!('turn' in plan)) throw new Error('expected a turn');
      expect(plan.turn.messages[0]?.content).toBe('real');
    });
  });

  describe('rule 2 — only the active conversation is current', () => {
    it('activates an archived conversation', () => {
      const conversation = Conversation.fromState(
        state({ status: 'archived' }),
      );
      expect(conversation.activate()).toBeNull();
      expect(conversation.status).toBe('active');
    });

    it('archives an active conversation', () => {
      const conversation = Conversation.fromState(state());
      expect(conversation.archive()).toBeNull();
      expect(conversation.status).toBe('archived');
    });
  });

  describe('rule 3 — deleted is terminal', () => {
    it('soft deletes an active conversation', () => {
      const conversation = Conversation.fromState(state());
      expect(conversation.softDelete()).toBeNull();
      expect(conversation.status).toBe('deleted');
    });

    it('refuses a second delete instead of reviving the row', () => {
      const conversation = Conversation.fromState(state({ status: 'deleted' }));
      expect(conversation.softDelete()).toBe('conversation_deleted');
    });

    it('refuses every other operation on a deleted conversation', () => {
      const conversation = Conversation.fromState(state({ status: 'deleted' }));
      expect(conversation.activate()).toBe('conversation_deleted');
      expect(conversation.archive()).toBe('conversation_deleted');
      expect(conversation.rename('new')).toBe('conversation_deleted');
      expect(
        conversation.planTurn({
          incoming: [{ role: 'user', content: 'hi' }],
          assistantContent: 'answer',
          usedTools: [],
          assistantAt: T0,
        }),
      ).toEqual({ rule: 'conversation_deleted' });
    });
  });

  describe('rule 4 — titles are bounded', () => {
    it('derives the initial title from the first user message', () => {
      expect(
        buildInitialTitle([
          { role: 'assistant', content: 'ignore me' },
          { role: 'user', content: '  how   much water today  ' },
        ]),
      ).toBe('how much water today');
    });

    it('truncates the initial title', () => {
      const title = buildInitialTitle([
        {
          role: 'user',
          content: 'x'.repeat(MAX_CONVERSATION_TITLE_LENGTH + 20),
        },
      ]);
      expect(title).toHaveLength(MAX_CONVERSATION_TITLE_LENGTH);
    });

    it('keeps the existing title across turns', () => {
      const conversation = Conversation.fromState(state({ title: 'kept' }));
      const plan = conversation.planTurn({
        incoming: [{ role: 'user', content: 'anything' }],
        assistantContent: 'answer',
        usedTools: [],
        assistantAt: T0,
      });
      if (!('turn' in plan)) throw new Error('expected a turn');
      expect(plan.turn.title).toBe('kept');
    });

    it('refuses an empty rename and keeps the old title', () => {
      const conversation = Conversation.fromState(state({ title: 'old' }));
      expect(conversation.rename('   ')).toBe('title_empty');
      expect(conversation.canApplyRefinedTitle('old')).toBe(true);
    });

    it('refuses an over-long rename', () => {
      const conversation = Conversation.fromState(state());
      expect(conversation.rename('y'.repeat(MAX_RENAME_TITLE_LENGTH + 1))).toBe(
        'title_too_long',
      );
    });

    it('never lets a refined title overwrite a user rename', () => {
      const conversation = Conversation.fromState(
        state({ title: 'truncated' }),
      );
      expect(conversation.canApplyRefinedTitle('user renamed')).toBe(false);
      expect(
        conversation.applyRefinedTitle('user renamed', 'model title'),
      ).toBe(false);
      expect(conversation.canApplyRefinedTitle('truncated')).toBe(true);
    });

    it('clamps model output (quotes, whitespace, length)', () => {
      expect(normalizeRefinedTitle('  “喝水记录”  ')).toBe('喝水记录');
      expect(normalizeRefinedTitle('`a   b`')).toBe('a b');
      expect(normalizeRefinedTitle('   ')).toBeNull();
      expect(normalizeRefinedTitle(42)).toBeNull();
      expect(normalizeRefinedTitle('z'.repeat(50))).toHaveLength(20);
    });
  });

  describe('turn application', () => {
    it('records the appended messages in the in-memory aggregate', () => {
      const conversation = Conversation.fromState(state());
      const at = new Date(T0.getTime() + 1_000);
      const plan = conversation.planTurn({
        incoming: [{ role: 'user', content: 'hi' }],
        assistantContent: 'answer',
        usedTools: ['get_user_profile'],
        assistantAt: at,
      });
      if (!('turn' in plan)) throw new Error('expected a turn');
      conversation.applyTurn(plan.turn, ['m1', 'm2']);
      expect(conversation.history()).toEqual([
        { role: 'user', content: 'hi' },
        { role: 'assistant', content: 'answer' },
      ]);
      expect(conversation.lastMessageAt).toBe(at);
      expect(conversation.title).toBe('hi');
    });

    it('refuses an empty assistant reply', () => {
      const conversation = Conversation.fromState(state());
      expect(
        conversation.planTurn({
          incoming: [{ role: 'user', content: 'hi' }],
          assistantContent: '   ',
          usedTools: [],
          assistantAt: T0,
        }),
      ).toEqual({ rule: 'empty_assistant_reply' });
    });
  });

  describe('regeneration', () => {
    it('appends the new answer after the old one', () => {
      const conversation = Conversation.fromState(
        state({
          messages: [
            stored('a', 'user', 'q', 0),
            stored('b', 'assistant', 'old', 10),
          ],
        }),
      );
      const at = new Date(T0.getTime() + 100);
      const plan = conversation.planStandaloneAssistantMessage({
        content: 'new',
        at,
      });
      if (!('message' in plan)) throw new Error('expected a message');
      conversation.applyStandaloneAssistantMessage(plan.message, 'c');
      expect(conversation.history().map((m) => m.content)).toEqual([
        'q',
        'old',
        'new',
      ]);
      expect(conversation.lastMessageAt).toBe(at);
    });

    it('refuses an empty regenerated answer', () => {
      const conversation = Conversation.fromState(state());
      expect(
        conversation.planStandaloneAssistantMessage({ content: '', at: T0 }),
      ).toEqual({ rule: 'empty_assistant_reply' });
    });
  });
});
