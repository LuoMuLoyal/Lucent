import type { IDailyRecordCandidateGenerator } from '../../types/ports.js';
import type { AssistantToolRecordQueryService } from '../records/query.service.js';
import type { AssistantToolExecutionContext } from '../../types/assistant.types.js';
import type { DailyRecordCandidateData } from '../../../daily-records/index.js';
import { AssistantToolProposalService } from './proposal.service.js';

const mockContext: AssistantToolExecutionContext = {
  userId: 'user-1',
  locale: 'zh-CN',
  userMessage: '帮我记录喝水 500ml',
  enabledContextSources: ['daily_records'],
  memoryEnabled: false,
};

const mockDateResolution = {
  date: '2026-07-10',
  matchedBy: ['fallback'],
  ambiguities: ['No explicit date detected.'],
};

const mockCandidateItem = {
  kind: 'water' as const,
  occurredAt: '2026-07-10T08:00:00.000Z',
  title: '喝水',
  value: '500',
  unit: 'ml',
  note: null,
  payload: null,
  rationale: 'Detected water intake from message',
};

const mockCandidates: DailyRecordCandidateData = {
  confirmationHint: 'Did you drink 500ml water?',
  items: [mockCandidateItem],
} as never;

describe('AssistantToolProposalService', () => {
  let service: AssistantToolProposalService;
  let candidateGenerator: vi.Mocked<IDailyRecordCandidateGenerator>;
  let recordQuery: vi.Mocked<AssistantToolRecordQueryService>;

  beforeEach(() => {
    candidateGenerator = {
      generate: vi.fn().mockResolvedValue(mockCandidates),
    };
    recordQuery = {
      resolveSingleDate: vi.fn().mockReturnValue(mockDateResolution),
      findTargetDailyRecordForMutation: vi.fn(),
      listToolRecords: vi.fn(),
    } as unknown as vi.Mocked<AssistantToolRecordQueryService>;

    service = new AssistantToolProposalService(candidateGenerator, recordQuery);
  });

  describe('buildCreateDailyRecordProposal', () => {
    it('generates proposal with candidates when available', async () => {
      const result = await service.buildCreateDailyRecordProposal(
        mockContext,
        'propose_create_daily_record',
      );

      expect(result.name).toBe('propose_create_daily_record');
      expect(result.proposedActions).toHaveLength(1);
      expect(result.proposedActions![0]!.type).toBe('create_daily_record');
      expect(result.proposedActions![0]!.payload).toMatchObject({
        type: 'create_daily_record',
        draft: { kind: 'water', value: '500', unit: 'ml' },
      });
    });

    it('returns empty candidates when generator returns none', async () => {
      candidateGenerator.generate.mockResolvedValue({
        confirmationHint: 'No candidates',
        items: [],
      } as never);

      const result = await service.buildCreateDailyRecordProposal(
        mockContext,
        'propose_create_daily_record',
      );

      expect(result.proposedActions).toBeUndefined();
      expect(result.data).toHaveProperty('candidates', []);
    });

    it('refuses generation for an unsupported candidate kind (F-16)', async () => {
      candidateGenerator.generate.mockResolvedValue({
        confirmationHint: 'Unsupported kind',
        items: [
          {
            ...mockCandidateItem,
            kind: 'mood',
          },
        ],
      } as never);

      const result = await service.buildCreateDailyRecordProposal(
        mockContext,
        'propose_create_daily_record',
      );

      expect(result.proposedActions).toBeUndefined();
      expect(result.data['unsupportedKind']).toBe('mood');
      expect(result.data['reason']).toEqual(expect.any(String));
      expect(result.data['candidates']).toHaveLength(1);
    });
  });

  describe('buildUpdateDailyRecordProposal', () => {
    it('returns no proposedActions when no target record matched', async () => {
      recordQuery.findTargetDailyRecordForMutation.mockResolvedValue({
        date: '2026-07-10',
        record: null,
        matchedBy: [],
        ambiguities: [],
        reason: 'No match',
        confidence: { level: 'low', reason: 'Nothing matched' },
        candidateCount: 0,
      });

      const result = await service.buildUpdateDailyRecordProposal(
        mockContext,
        'propose_update_daily_record',
      );

      expect(result.proposedActions).toBeUndefined();
    });

    it('returns no proposedActions when updateDraft is null', async () => {
      recordQuery.findTargetDailyRecordForMutation.mockResolvedValue({
        date: '2026-07-10',
        record: {
          id: 'rec-1',
          kind: 'water',
          occurredAt: '2026-07-10T08:00:00.000Z',
          title: 'Water',
          value: '300',
          unit: 'ml',
          note: null,
          tags: [],
          payload: null,
          createdAt: null,
          updatedAt: null,
        },
        matchedBy: ['kind'],
        ambiguities: [],
        reason: 'Matched by kind',
        confidence: { level: 'high', reason: 'Exact kind match' },
        candidateCount: 1,
      });

      const result = await service.buildUpdateDailyRecordProposal(
        { ...mockContext, userMessage: 'delete this record' },
        'propose_update_daily_record',
      );

      expect(result.proposedActions).toBeUndefined();
    });

    it('generates update proposal when target and draft are present', async () => {
      recordQuery.findTargetDailyRecordForMutation.mockResolvedValue({
        date: '2026-07-10',
        record: {
          id: 'rec-1',
          kind: 'water',
          occurredAt: '2026-07-10T08:00:00.000Z',
          title: 'Water',
          value: '300',
          unit: 'ml',
          note: null,
          tags: [],
          payload: null,
          createdAt: null,
          updatedAt: null,
        },
        matchedBy: ['kind'],
        ambiguities: [],
        reason: 'Matched by kind',
        confidence: { level: 'high', reason: 'Exact kind match' },
        candidateCount: 1,
      });

      const result = await service.buildUpdateDailyRecordProposal(
        { ...mockContext, userMessage: '把备注改成：运动后喝水' },
        'propose_update_daily_record',
      );

      expect(result.proposedActions).toHaveLength(1);
      expect(result.proposedActions![0]!.type).toBe('update_daily_record');
    });
  });

  describe('buildDeleteDailyRecordProposal', () => {
    it('returns no proposedActions when no target record matched', async () => {
      recordQuery.findTargetDailyRecordForMutation.mockResolvedValue({
        date: '2026-07-10',
        record: null,
        matchedBy: [],
        ambiguities: [],
        reason: 'No match',
        confidence: { level: 'low', reason: 'Nothing matched' },
        candidateCount: 0,
      });

      const result = await service.buildDeleteDailyRecordProposal(
        mockContext,
        'propose_delete_daily_record',
      );

      expect(result.proposedActions).toBeUndefined();
    });

    it('generates delete proposal when target is matched', async () => {
      recordQuery.findTargetDailyRecordForMutation.mockResolvedValue({
        date: '2026-07-10',
        record: {
          id: 'rec-1',
          kind: 'water',
          occurredAt: '2026-07-10T08:00:00.000Z',
          title: 'Water',
          value: '300',
          unit: 'ml',
          note: null,
          tags: [],
          payload: null,
          createdAt: null,
          updatedAt: null,
        },
        matchedBy: ['kind'],
        ambiguities: [],
        reason: 'Matched by kind',
        confidence: { level: 'high', reason: 'Exact match' },
        candidateCount: 1,
      });

      const result = await service.buildDeleteDailyRecordProposal(
        mockContext,
        'propose_delete_daily_record',
      );

      expect(result.proposedActions).toHaveLength(1);
      expect(result.proposedActions![0]!.type).toBe('delete_daily_record');
      expect(result.proposedActions![0]!.payload).toMatchObject({
        type: 'delete_daily_record',
        recordId: 'rec-1',
      });
    });
  });

  describe('buildUpdateUserSettingsProposal', () => {
    it('returns no proposedActions when no settings detected', () => {
      const result = service.buildUpdateUserSettingsProposal(
        { ...mockContext, userMessage: 'hello world' },
        'propose_update_user_settings',
      );

      expect(result.proposedActions).toBeUndefined();
      expect(result.data).toHaveProperty('matchedSettingKeys', []);
    });

    it('detects disable AI and generates proposal', () => {
      const result = service.buildUpdateUserSettingsProposal(
        { ...mockContext, userMessage: '关闭AI助手' },
        'propose_update_user_settings',
      );

      expect(result.proposedActions).toHaveLength(1);
      expect(result.proposedActions![0]!.type).toBe('update_user_settings');
      expect(result.proposedActions![0]!.payload).toMatchObject({
        type: 'update_user_settings',
        draft: { assistantEnabled: false },
      });
    });

    it('detects enable memory and generates proposal', () => {
      const result = service.buildUpdateUserSettingsProposal(
        { ...mockContext, locale: 'en', userMessage: 'enable memory please' },
        'propose_update_user_settings',
      );

      expect(result.proposedActions).toHaveLength(1);
      expect(result.proposedActions![0]!.payload).toMatchObject({
        draft: { assistantMemoryEnabled: true },
      });
    });

    it('detects context source toggles', () => {
      const result = service.buildUpdateUserSettingsProposal(
        { ...mockContext, userMessage: '关闭睡眠记录上下文' },
        'propose_update_user_settings',
      );

      expect(result.proposedActions).toHaveLength(1);
      const payload = result.proposedActions![0]!.payload as {
        draft: { assistantContext?: { sleepRecords?: boolean } };
      };
      expect(payload.draft.assistantContext?.sleepRecords).toBe(false);
    });
  });
});
