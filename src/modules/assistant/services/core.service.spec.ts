import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { AssistantRuntimeService } from '../agent/runtime.service';
import type { UserSettingsService } from '../../user-settings';
import type { DailyRecordsService } from '../../daily-records';
import type { AssistantPolicyService } from './policy.service';
import type { AssistantToolService } from '../tools/tool.service';
import type { AssistantConversationService } from './conversation.service';
import type {
  AssistantRuntimeCapabilities,
  AssistantPolicySnapshot,
  AssistantConversationSnapshot,
  AssistantProposedAction,
} from '../types/assistant.types';
import { AssistantService } from './core.service';

const mockFoundation: AssistantRuntimeCapabilities = {
  phase: 'foundation',
  chatModelConfigured: true,
  interactiveChatReady: true,
  langGraphReady: true,
  ragEnabled: false,
  graphNodeNames: ['prepare_context', 'agent', 'tools', 'respond'],
  toolNames: ['get_today_records'],
  implementedToolNames: ['get_today_records'],
  contextSources: ['health_profile', 'daily_records'],
};

const mockPolicy: AssistantPolicySnapshot = {
  interactiveChatReady: true,
  enabledContextSources: ['health_profile', 'daily_records'],
  contextPermittedToolNames: ['get_today_records'],
  executableToolNames: ['get_today_records'],
  toolCapabilities: [],
};

const mockSettings = {
  assistantEnabled: true,
  assistantMemoryEnabled: false,
  assistantContext: {
    healthProfile: true,
    dailyRecords: true,
    sleepRecords: false,
    currentMedicines: false,
  },
  updatedAt: '2026-07-10T00:00:00.000Z',
};

const mockConversation: AssistantConversationSnapshot = {
  id: 'conv-1',
  title: 'Test',
  status: 'active',
  messages: [],
  lastMessageAt: null,
  createdAt: '2026-07-09T10:00:00.000Z',
  updatedAt: '2026-07-10T08:00:00.000Z',
};

describe('AssistantService', () => {
  let service: AssistantService;
  let runtime: vi.Mocked<AssistantRuntimeService>;
  let userSettings: vi.Mocked<UserSettingsService>;
  let dailyRecords: vi.Mocked<DailyRecordsService>;
  let policy: vi.Mocked<AssistantPolicyService>;
  let toolExecutor: vi.Mocked<AssistantToolService>;
  let conversation: vi.Mocked<AssistantConversationService>;

  beforeEach(() => {
    runtime = {
      describeFoundation: vi.fn().mockResolvedValue(mockFoundation),
      runConversation: vi.fn(),
      resumeConversation: vi.fn(),
      readPendingProposals: vi.fn(),
      streamPreGeneratedContent: vi.fn(),
      generateStream: vi.fn(),
      regenerateLastMessage: vi.fn(),
      replayFromCheckpoint: vi.fn(),
    } as unknown as vi.Mocked<AssistantRuntimeService>;

    userSettings = {
      getSettings: vi.fn().mockResolvedValue(mockSettings),
      updateSettings: vi.fn(),
    } as unknown as vi.Mocked<UserSettingsService>;

    dailyRecords = {
      create: vi.fn().mockResolvedValue({ id: 'record-1' }),
      update: vi.fn().mockResolvedValue({ id: 'record-1' }),
      delete: vi.fn().mockResolvedValue(undefined),
    } as unknown as vi.Mocked<DailyRecordsService>;

    policy = {
      evaluate: vi.fn().mockReturnValue(mockPolicy),
    } as unknown as vi.Mocked<AssistantPolicyService>;

    toolExecutor = {
      executeMany: vi.fn().mockResolvedValue([]),
    } as unknown as vi.Mocked<AssistantToolService>;

    conversation = {
      getLatestConversation: vi.fn(),
      listRecentConversations: vi.fn(),
      openConversation: vi.fn(),
      clearLatestConversation: vi.fn(),
      getConversation: vi.fn(),
      persistAssistantTurn: vi.fn(),
      buildMemoryBlock: vi.fn().mockResolvedValue(''),
      appendAssistantMessage: vi.fn(),
    } as unknown as vi.Mocked<AssistantConversationService>;

    service = new AssistantService(
      runtime,
      userSettings,
      policy,
      toolExecutor,
      conversation,
      dailyRecords,
    );
  });

  describe('getFoundationCapabilities', () => {
    it('delegates to runtime.describeFoundation', async () => {
      const result = await service.getFoundationCapabilities();

      expect(result).toBe(mockFoundation);
    });
  });

  describe('getCapabilities', () => {
    it('returns merged capabilities from foundation, settings, and policy', async () => {
      const result = await service.getCapabilities('user-1');

      expect(userSettings.getSettings).toHaveBeenCalledWith('user-1');
      expect(policy.evaluate).toHaveBeenCalledWith(
        mockFoundation,
        mockSettings,
      );
      expect(result).toMatchObject({
        phase: 'foundation',
        assistantEnabled: true,
        chatModelConfigured: true,
        interactiveChatReady: true,
        streamingSupported: true,
        streamingTransport: 'sse',
        markdownRenderingRecommended: true,
      });
    });
  });

  describe('getLatestConversation', () => {
    it('returns snapshot when conversation exists', async () => {
      conversation.getLatestConversation.mockResolvedValue(mockConversation);

      const result = await service.getLatestConversation('user-1');

      expect(result).toEqual(mockConversation);
    });

    it('returns null when no conversation', async () => {
      conversation.getLatestConversation.mockResolvedValue(null);

      const result = await service.getLatestConversation('user-1');

      expect(result).toBeNull();
    });
  });

  describe('listRecentConversations', () => {
    it('delegates to conversation service', async () => {
      conversation.listRecentConversations.mockResolvedValue([
        mockConversation,
      ]);

      const result = await service.listRecentConversations('user-1');

      expect(result).toEqual([mockConversation]);
    });
  });

  describe('openConversation', () => {
    it('delegates to conversation service', async () => {
      conversation.openConversation.mockResolvedValue(mockConversation);

      const result = await service.openConversation('user-1', 'conv-1');

      expect(conversation.openConversation).toHaveBeenCalledWith(
        'user-1',
        'conv-1',
      );
      expect(result).toEqual(mockConversation);
    });
  });

  describe('clearLatestConversation', () => {
    it('returns cleared=true with archivedConversationId', async () => {
      conversation.clearLatestConversation.mockResolvedValue(mockConversation);

      const result = await service.clearLatestConversation('user-1');

      expect(result).toEqual({
        cleared: true,
        archivedConversationId: 'conv-1',
      });
    });

    it('returns cleared=false when no conversation to clear', async () => {
      conversation.clearLatestConversation.mockResolvedValue(null);

      const result = await service.clearLatestConversation('user-1');

      expect(result).toEqual({
        cleared: false,
        archivedConversationId: null,
      });
    });
  });

  describe('confirmProposal', () => {
    const dto = { proposalIds: ['proposal-1'], decision: 'approved' as const };

    const pendingReview = {
      proposalIds: ['proposal-1'],
      status: 'pending' as const,
    };

    const createProposal: AssistantProposedAction = {
      id: 'proposal-1',
      type: 'create_daily_record' as const,
      status: 'proposed' as const,
      confirmationRequired: true,
      title: '记录喝水',
      summary: '喝水 500ml',
      reason: null,
      previewFields: [],
      target: { kind: 'daily_record' as const, label: '喝水' },
      constraints: [],
      expiresAt: '2099-01-01T00:00:00.000Z',
      payloadVersion: 1,
      payload: {
        type: 'create_daily_record' as const,
        draft: {
          kind: 'water' as const,
          occurredAt: '2026-08-17',
          title: '喝水',
          value: '500',
          unit: 'ml',
          note: null,
          payload: null,
        },
      },
    };

    beforeEach(() => {
      conversation.getConversation.mockResolvedValue(mockConversation);
      runtime.readPendingProposals.mockResolvedValue({
        pendingReview,
        proposals: [createProposal],
      });
      runtime.resumeConversation.mockResolvedValue({
        finalContent: '已确认。',
      });
    });

    it('throws NotFoundException when the conversation is missing', async () => {
      conversation.getConversation.mockResolvedValue(null);

      await expect(
        service.confirmProposal('user-1', 'conv-1', dto),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(runtime.resumeConversation).not.toHaveBeenCalled();
      expect(runtime.readPendingProposals).not.toHaveBeenCalled();
    });

    it('applies approved create_daily_record writes server-side then resumes', async () => {
      runtime.resumeConversation.mockResolvedValue({
        finalContent: '已确认。',
      });

      const result = await service.confirmProposal('user-1', 'conv-1', {
        ...dto,
        note: 'ok',
      });

      expect(runtime.readPendingProposals).toHaveBeenCalledWith('conv-1');
      expect(dailyRecords.create).toHaveBeenCalledWith('user-1', {
        kind: 'water',
        occurredAt: '2026-08-17',
        title: '喝水',
        value: '500',
        unit: 'ml',
      });
      expect(runtime.resumeConversation).toHaveBeenCalledWith({
        userId: 'user-1',
        conversationId: 'conv-1',
        decision: 'approved',
        note: 'ok',
      });
      expect(result).toEqual({
        conversationId: 'conv-1',
        decision: 'approved',
        status: 'approved',
        finalContent: '已确认。',
      });
    });

    it('applies update_daily_record with null-clear semantics preserved', async () => {
      runtime.readPendingProposals.mockResolvedValue({
        pendingReview,
        proposals: [
          {
            ...createProposal,
            id: 'proposal-2',
            type: 'update_daily_record' as const,
            payload: {
              type: 'update_daily_record' as const,
              recordId: 'record-9',
              draft: { title: '新标题', value: null },
            },
          },
        ],
      });

      await service.confirmProposal('user-1', 'conv-1', {
        proposalIds: ['proposal-2'],
        decision: 'approved',
      });

      expect(dailyRecords.update).toHaveBeenCalledWith('user-1', 'record-9', {
        title: '新标题',
        value: null,
      });
    });

    it('applies delete_daily_record with the record id', async () => {
      runtime.readPendingProposals.mockResolvedValue({
        pendingReview,
        proposals: [
          {
            ...createProposal,
            id: 'proposal-3',
            type: 'delete_daily_record' as const,
            payload: {
              type: 'delete_daily_record' as const,
              recordId: 'record-7',
            },
          },
        ],
      });

      await service.confirmProposal('user-1', 'conv-1', {
        proposalIds: ['proposal-3'],
        decision: 'approved',
      });

      expect(dailyRecords.delete).toHaveBeenCalledWith('user-1', 'record-7');
    });

    it('applies update_user_settings with the draft fields', async () => {
      runtime.readPendingProposals.mockResolvedValue({
        pendingReview,
        proposals: [
          {
            ...createProposal,
            id: 'proposal-4',
            type: 'update_user_settings' as const,
            payload: {
              type: 'update_user_settings' as const,
              draft: {
                assistantEnabled: true,
                assistantMemoryEnabled: false,
                assistantContext: { dailyRecords: true },
              },
            },
          },
        ],
      });

      await service.confirmProposal('user-1', 'conv-1', {
        proposalIds: ['proposal-4'],
        decision: 'approved',
      });

      expect(userSettings.updateSettings).toHaveBeenCalledWith('user-1', {
        assistantEnabled: true,
        assistantMemoryEnabled: false,
        assistantContext: { dailyRecords: true },
      });
    });

    it('does not write and only resumes when rejected', async () => {
      runtime.resumeConversation.mockResolvedValue({
        finalContent: '已拒绝。',
      });

      const result = await service.confirmProposal('user-1', 'conv-1', {
        proposalIds: ['proposal-1'],
        decision: 'rejected',
      });

      expect(runtime.readPendingProposals).not.toHaveBeenCalled();
      expect(dailyRecords.create).not.toHaveBeenCalled();
      expect(dailyRecords.update).not.toHaveBeenCalled();
      expect(dailyRecords.delete).not.toHaveBeenCalled();
      expect(userSettings.updateSettings).not.toHaveBeenCalled();
      expect(runtime.resumeConversation).toHaveBeenCalledWith({
        userId: 'user-1',
        conversationId: 'conv-1',
        decision: 'rejected',
      });
      expect(result.status).toBe('rejected');
    });

    it('rejects when the pending review is missing', async () => {
      runtime.readPendingProposals.mockResolvedValue({
        pendingReview: null,
        proposals: [],
      });

      await expect(
        service.confirmProposal('user-1', 'conv-1', dto),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(dailyRecords.create).not.toHaveBeenCalled();
      expect(runtime.resumeConversation).not.toHaveBeenCalled();
    });

    it('rejects when the pending review is not pending', async () => {
      runtime.readPendingProposals.mockResolvedValue({
        pendingReview: { ...pendingReview, status: 'approved' },
        proposals: [createProposal],
      });

      await expect(
        service.confirmProposal('user-1', 'conv-1', dto),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(dailyRecords.create).not.toHaveBeenCalled();
      expect(runtime.resumeConversation).not.toHaveBeenCalled();
    });

    it('rejects when any approved proposal is individually expired (F-11)', async () => {
      const freshProposal: AssistantProposedAction = {
        ...createProposal,
        id: 'proposal-fresh',
        expiresAt: '2099-01-01T00:00:00.000Z',
      };
      const staleProposal: AssistantProposedAction = {
        ...createProposal,
        id: 'proposal-stale',
        expiresAt: '2020-01-01T00:00:00.000Z',
      };
      runtime.readPendingProposals.mockResolvedValue({
        pendingReview: {
          ...pendingReview,
          proposalIds: ['proposal-fresh', 'proposal-stale'],
        },
        proposals: [freshProposal, staleProposal],
      });

      await expect(
        service.confirmProposal('user-1', 'conv-1', {
          proposalIds: ['proposal-fresh', 'proposal-stale'],
          decision: 'approved',
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(dailyRecords.create).not.toHaveBeenCalled();
      expect(runtime.resumeConversation).not.toHaveBeenCalled();
    });

    it('accepts when all approved proposals are individually unexpired (F-11)', async () => {
      const first: AssistantProposedAction = {
        ...createProposal,
        id: 'proposal-a',
      };
      const second: AssistantProposedAction = {
        ...createProposal,
        id: 'proposal-b',
      };
      runtime.readPendingProposals.mockResolvedValue({
        pendingReview: {
          ...pendingReview,
          proposalIds: ['proposal-a', 'proposal-b'],
        },
        proposals: [first, second],
      });

      await service.confirmProposal('user-1', 'conv-1', {
        proposalIds: ['proposal-a', 'proposal-b'],
        decision: 'approved',
      });

      expect(dailyRecords.create).toHaveBeenCalledTimes(2);
      expect(runtime.resumeConversation).toHaveBeenCalledWith({
        userId: 'user-1',
        conversationId: 'conv-1',
        decision: 'approved',
      });
    });

    it('propagates write failures and does not resume the thread', async () => {
      dailyRecords.create.mockRejectedValue(new Error('db down'));

      await expect(
        service.confirmProposal('user-1', 'conv-1', dto),
      ).rejects.toThrow('db down');
      expect(runtime.resumeConversation).not.toHaveBeenCalled();
    });

    it('rejects when the proposal id is not in the pending review', async () => {
      runtime.readPendingProposals.mockResolvedValue({
        pendingReview,
        proposals: [],
      });

      await expect(
        service.confirmProposal('user-1', 'conv-1', dto),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(dailyRecords.create).not.toHaveBeenCalled();
      expect(runtime.resumeConversation).not.toHaveBeenCalled();
    });
  });

  describe('streamMessages', () => {
    const dto = {
      messages: [{ role: 'user' as const, content: 'Hello' }],
    };

    const mockRunConversationResult = {
      finalContent: 'AI response',
      streamedContent: false,
      toolResults: [],
      selectedTools: [],
      validationFlags: {
        hasEmptyResults: false,
        hasPartialCoverage: false,
        hasAmbiguities: false,
        missingProposedActions: false,
      },
      stopReason: 'answered' as const,
    };

    const mockStreamResult = {
      content: 'AI response',
      usedToolNames: [],
    };

    const onChunk = vi.fn();

    it('throws ForbiddenException when assistant is disabled', async () => {
      userSettings.getSettings.mockResolvedValue({
        ...mockSettings,
        assistantEnabled: false,
      } as never);

      await expect(
        service.streamMessages('user-1', dto, 'zh-CN', onChunk),
      ).rejects.toThrow(ForbiddenException);
    });

    it('throws ServiceUnavailableException when chat model is not configured', async () => {
      runtime.describeFoundation.mockResolvedValue({
        ...mockFoundation,
        chatModelConfigured: false,
      });

      await expect(
        service.streamMessages('user-1', dto, 'zh-CN', onChunk),
      ).rejects.toThrow(ServiceUnavailableException);
    });

    it('streams pre-generated content when finalContent is present', async () => {
      runtime.runConversation.mockResolvedValue(mockRunConversationResult);
      runtime.streamPreGeneratedContent.mockResolvedValue(mockStreamResult);
      conversation.persistAssistantTurn.mockResolvedValue(mockConversation);

      const result = await service.streamMessages(
        'user-1',
        dto,
        'zh-CN',
        onChunk,
      );

      expect(runtime.streamPreGeneratedContent).toHaveBeenCalledWith(
        'AI response',
        [],
        onChunk,
      );
      expect(result.role).toBe('assistant');
      expect(result.content).toBe('AI response');
    });

    it('does not replay content that the graph already streamed', async () => {
      runtime.runConversation.mockImplementation(async (...args: unknown[]) => {
        const onGraphChunk = args[2] as
          | ((event: { content: string }) => void | Promise<void>)
          | undefined;
        await onGraphChunk?.({ content: 'AI response' });
        return {
          ...mockRunConversationResult,
          streamedContent: true,
        } as never;
      });
      conversation.persistAssistantTurn.mockResolvedValue(mockConversation);

      const result = await service.streamMessages(
        'user-1',
        dto,
        'zh-CN',
        onChunk,
      );

      expect(onChunk).toHaveBeenCalledWith({ content: 'AI response' });
      expect(runtime.streamPreGeneratedContent).not.toHaveBeenCalled();
      expect(result.content).toBe('AI response');
    });

    it('generates stream when finalContent is null', async () => {
      runtime.runConversation.mockResolvedValue({
        ...(mockRunConversationResult as object),
        finalContent: null,
      } as never);
      runtime.generateStream.mockResolvedValue(mockStreamResult);
      conversation.persistAssistantTurn.mockResolvedValue(mockConversation);

      const result = await service.streamMessages('user-1', dto, 'en', onChunk);

      expect(runtime.generateStream).toHaveBeenCalled();
      expect(result.content).toBe('AI response');
    });

    it('persists assistant turn and returns conversation id', async () => {
      runtime.runConversation.mockResolvedValue(mockRunConversationResult);
      runtime.streamPreGeneratedContent.mockResolvedValue(mockStreamResult);
      conversation.persistAssistantTurn.mockResolvedValue(mockConversation);

      const result = await service.streamMessages(
        'user-1',
        dto,
        'zh-CN',
        onChunk,
      );

      expect(conversation.persistAssistantTurn).toHaveBeenCalledWith({
        userId: 'user-1',
        messages: [{ role: 'user', content: 'Hello' }],
        assistantContent: 'AI response',
        usedTools: [],
      });
      expect(result.conversationId).toBe('conv-1');
    });

    it('maps knowledge tool envelopes into toolDetails', async () => {
      runtime.runConversation.mockResolvedValue({
        ...mockRunConversationResult,
        toolResults: [
          {
            name: 'search_medicine_leaflets',
            data: {
              query: { medicineQuery: '布洛芬' },
              result: {
                medicine: { source: 'cn', name: '布洛芬缓释胶囊' },
                resolvedProduct: {
                  source: 'cn',
                  productId: 'p-1',
                  name: '布洛芬缓释胶囊',
                },
                leaflets: [],
                chunks: [],
                candidates: [],
                page: { limit: 4, offset: 0, hasMore: false, queryHash: 'h' },
              },
              coverage: { status: 'complete', reason: null },
              timeRange: {
                timezone: 'UTC',
                startDate: null,
                endDate: null,
              },
              source: {
                tool: 'search_medicine_leaflets',
                generatedAt: '2026-08-17T00:00:00.000Z',
                tables: ['cn_medicine_leaflets', 'medicine_leaflet_chunks'],
              },
              confidence: {
                level: 'high',
                reason:
                  'Resolved a Chinese leaflet product through vector aggregation before retrieving chunks.',
              },
              ambiguities: ['布洛芬颗粒'],
            },
          },
          {
            name: 'search_medical_qa_corpus',
            data: {
              query: { medicineQuery: '布洛芬' },
              result: {
                knowledge: [],
                disclaimer: 'AI 回答仅供参考,不构成诊疗建议。',
                page: { limit: 4, offset: 0, hasMore: false, queryHash: 'h' },
              },
              coverage: {
                status: 'empty',
                reason: 'No relevant medical knowledge found for this query.',
              },
              timeRange: {
                timezone: 'UTC',
                startDate: null,
                endDate: null,
              },
              source: {
                tool: 'search_medical_qa_corpus',
                generatedAt: '2026-08-17T00:00:00.000Z',
                tables: ['medical_qa_embeddings'],
              },
              confidence: { level: 'low', reason: 'No matching chunks.' },
              ambiguities: [],
            },
          },
        ],
      } as never);
      runtime.streamPreGeneratedContent.mockResolvedValue({
        ...mockStreamResult,
        usedToolNames: ['search_medicine_leaflets', 'search_medical_qa_corpus'],
      } as never);
      conversation.persistAssistantTurn.mockResolvedValue(mockConversation);

      const result = await service.streamMessages(
        'user-1',
        dto,
        'zh-CN',
        onChunk,
      );

      expect(result.toolDetails).toEqual([
        {
          name: 'search_medicine_leaflets',
          label: '布洛芬缓释胶囊',
          coverage: { status: 'complete', reason: null },
          confidence: {
            level: 'high',
            reason:
              'Resolved a Chinese leaflet product through vector aggregation before retrieving chunks.',
          },
          ambiguities: ['布洛芬颗粒'],
          source: {
            tool: 'search_medicine_leaflets',
            generatedAt: '2026-08-17T00:00:00.000Z',
            tables: ['cn_medicine_leaflets', 'medicine_leaflet_chunks'],
          },
        },
        {
          name: 'search_medical_qa_corpus',
          coverage: {
            status: 'empty',
            reason: 'No relevant medical knowledge found for this query.',
          },
          confidence: { level: 'low', reason: 'No matching chunks.' },
          source: {
            tool: 'search_medical_qa_corpus',
            generatedAt: '2026-08-17T00:00:00.000Z',
            tables: ['medical_qa_embeddings'],
          },
          disclaimer: 'AI 回答仅供参考,不构成诊疗建议。',
        },
      ]);
    });

    it('emits name-only toolDetails for proposal tools', async () => {
      runtime.runConversation.mockResolvedValue({
        ...mockRunConversationResult,
        toolResults: [
          {
            name: 'propose_create_daily_record',
            data: { type: 'create_daily_record', draft: {} },
          },
        ],
      } as never);
      runtime.streamPreGeneratedContent.mockResolvedValue({
        ...mockStreamResult,
        usedToolNames: ['propose_create_daily_record'],
      } as never);
      conversation.persistAssistantTurn.mockResolvedValue(mockConversation);

      const result = await service.streamMessages(
        'user-1',
        dto,
        'zh-CN',
        onChunk,
      );

      expect(result.toolDetails).toEqual([
        { name: 'propose_create_daily_record' },
      ]);
    });

    it('returns empty toolDetails when no tools ran', async () => {
      runtime.runConversation.mockResolvedValue(mockRunConversationResult);
      runtime.streamPreGeneratedContent.mockResolvedValue(mockStreamResult);
      conversation.persistAssistantTurn.mockResolvedValue(mockConversation);

      const result = await service.streamMessages(
        'user-1',
        dto,
        'zh-CN',
        onChunk,
      );

      expect(result.toolDetails).toEqual([]);
    });
  });

  describe('regenerateConversation', () => {
    it('replays the recorded checkpoint, streams, and persists the new answer', async () => {
      conversation.getConversation.mockResolvedValue(mockConversation);
      runtime.regenerateLastMessage.mockResolvedValue({
        checkpointId: 'checkpoint-1',
        sourceMessageId: 'msg-last',
      });
      runtime.replayFromCheckpoint.mockImplementation(
        async (_id, _cp, onText) => {
          await onText('重新生成');
          await onText('的回答');
          return { finalContent: '重新生成的回答' };
        },
      );
      conversation.appendAssistantMessage.mockResolvedValue(mockConversation);

      const chunks: string[] = [];
      const result = await service.regenerateConversation(
        'user-1',
        'conv-1',
        ({ content }) => {
          chunks.push(content);
        },
      );

      expect(runtime.regenerateLastMessage).toHaveBeenCalledWith(
        'user-1',
        'conv-1',
      );
      expect(runtime.replayFromCheckpoint).toHaveBeenCalledWith(
        'conv-1',
        'checkpoint-1',
        expect.any(Function),
      );
      expect(conversation.appendAssistantMessage).toHaveBeenCalledWith(
        'user-1',
        'conv-1',
        '重新生成的回答',
      );
      expect(chunks).toEqual(['重新生成', '的回答']);
      expect(result).toMatchObject({
        conversationId: 'conv-1',
        role: 'assistant',
        content: '重新生成的回答',
        usedTools: [],
        proposedActions: [],
        toolDetails: [],
      });
      expect(result.generatedAt).toEqual(expect.any(String));
    });

    it('rejects when the conversation does not exist', async () => {
      conversation.getConversation.mockResolvedValue(null);

      await expect(
        service.regenerateConversation('user-1', 'conv-1', vi.fn()),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('does not persist when the replay fails', async () => {
      conversation.getConversation.mockResolvedValue(mockConversation);
      runtime.regenerateLastMessage.mockResolvedValue({
        checkpointId: 'checkpoint-1',
        sourceMessageId: 'msg-last',
      });
      runtime.replayFromCheckpoint.mockRejectedValue(
        new Error('LLM unavailable'),
      );

      await expect(
        service.regenerateConversation('user-1', 'conv-1', vi.fn()),
      ).rejects.toThrow('LLM unavailable');
      expect(conversation.appendAssistantMessage).not.toHaveBeenCalled();
    });
  });
});
