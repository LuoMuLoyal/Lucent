import type {
  AssistantToolExecutionContext,
  AssistantToolExecutionResult,
} from '../../types/assistant.types.js';
import type { AssistantDailyRecordProposalService } from './daily-record-proposal.service.js';
import type { AssistantSettingsProposalService } from './settings-proposal.service.js';
import { AssistantToolProposalService } from './proposal.service.js';

const mockContext: AssistantToolExecutionContext = {
  userId: 'user-1',
  locale: 'zh-CN',
  userMessage: '帮我记录喝水 500ml',
  enabledContextSources: ['daily_records'],
  memoryEnabled: false,
};

const defaultCreateResult: AssistantToolExecutionResult = {
  name: 'propose_create_daily_record',
  data: {
    candidates: [
      {
        kind: 'water',
        occurredAt: '2026-07-10T08:00:00.000Z',
        title: '喝水',
        value: '500',
        unit: 'ml',
        note: null,
        payload: null,
        rationale: 'Detected water intake',
      },
    ],
  },
  proposedActions: [
    {
      id: 'proposal-create-1',
      type: 'create_daily_record',
      status: 'proposed',
      confirmationRequired: true,
      title: '保存这条记录',
      summary: '喝水 500ml',
      reason: 'Detected water intake',
      previewFields: [],
      target: {
        kind: 'daily_record_draft',
        label: '喝水',
        matchedBy: [],
        snapshot: {},
      },
      constraints: [],
      expiresAt: '2099-01-01T00:00:00.000Z',
      payloadVersion: 1,
      payload: {
        type: 'create_daily_record',
        draft: {
          kind: 'water',
          occurredAt: '2026-07-10',
          title: '喝水',
          value: '500',
          unit: 'ml',
          note: null,
          payload: null,
        },
      },
    },
  ],
};

const defaultUpdateResult: AssistantToolExecutionResult = {
  name: 'propose_update_daily_record',
  data: {},
  proposedActions: [
    {
      id: 'proposal-update-1',
      type: 'update_daily_record',
      status: 'proposed',
      confirmationRequired: true,
      title: '修改这条记录',
      summary: '更新记录',
      reason: null,
      previewFields: [],
      target: {
        kind: 'daily_record',
        label: '喝水',
        recordId: 'rec-1',
        matchedBy: [],
        snapshot: {},
      },
      constraints: [],
      expiresAt: '2099-01-01T00:00:00.000Z',
      payloadVersion: 1,
      payload: {
        type: 'update_daily_record',
        recordId: 'rec-1',
        draft: {},
      },
    },
  ],
};

const defaultDeleteResult: AssistantToolExecutionResult = {
  name: 'propose_delete_daily_record',
  data: {},
  proposedActions: [
    {
      id: 'proposal-delete-1',
      type: 'delete_daily_record',
      status: 'proposed',
      confirmationRequired: true,
      title: '删除这条记录',
      summary: '删除记录',
      reason: null,
      previewFields: [],
      target: {
        kind: 'daily_record',
        label: '喝水',
        recordId: 'rec-1',
        matchedBy: [],
        snapshot: {},
      },
      constraints: [],
      expiresAt: '2099-01-01T00:00:00.000Z',
      payloadVersion: 1,
      payload: { type: 'delete_daily_record', recordId: 'rec-1' },
    },
  ],
};

const defaultSettingsResult: AssistantToolExecutionResult = {
  name: 'propose_update_user_settings',
  data: { matchedSettingKeys: ['assistantEnabled'] },
  proposedActions: [
    {
      id: 'proposal-settings-1',
      type: 'update_user_settings',
      status: 'proposed',
      confirmationRequired: true,
      title: '更新助手相关设置',
      summary: '设置变更',
      reason: null,
      previewFields: [],
      target: {
        kind: 'user_settings',
        label: '助手设置',
        settingKeys: ['assistantEnabled'],
        snapshot: {},
      },
      constraints: [],
      expiresAt: '2099-01-01T00:00:00.000Z',
      payloadVersion: 1,
      payload: {
        type: 'update_user_settings',
        draft: { assistantEnabled: false },
      },
    },
  ],
};

const emptyCandidatesResult: AssistantToolExecutionResult = {
  name: 'propose_create_daily_record',
  data: { candidates: [] },
};

describe('AssistantToolProposalService', () => {
  let service: AssistantToolProposalService;
  let dailyRecordProposalService: vi.Mocked<AssistantDailyRecordProposalService>;
  let settingsProposalService: vi.Mocked<AssistantSettingsProposalService>;

  beforeEach(() => {
    dailyRecordProposalService = {
      buildCreateDailyRecordProposal: vi.fn(),
      buildUpdateDailyRecordProposal: vi.fn(),
      buildDeleteDailyRecordProposal: vi.fn(),
    } as unknown as vi.Mocked<AssistantDailyRecordProposalService>;

    settingsProposalService = {
      buildUpdateUserSettingsProposal: vi.fn(),
    } as unknown as vi.Mocked<AssistantSettingsProposalService>;

    service = new AssistantToolProposalService(
      dailyRecordProposalService,
      settingsProposalService,
    );
  });

  describe('buildCreateDailyRecordProposal', () => {
    it('delegates to dailyRecordProposalService.buildCreateDailyRecordProposal', async () => {
      dailyRecordProposalService.buildCreateDailyRecordProposal.mockResolvedValue(
        defaultCreateResult,
      );

      const result = await service.buildCreateDailyRecordProposal(
        mockContext,
        'propose_create_daily_record',
      );

      expect(
        dailyRecordProposalService.buildCreateDailyRecordProposal,
      ).toHaveBeenCalledWith(mockContext, 'propose_create_daily_record');
      expect(result).toBe(defaultCreateResult);
      expect(result.proposedActions).toHaveLength(1);
      expect(result.proposedActions![0]!.type).toBe('create_daily_record');
    });

    it('returns empty candidates when sub-service returns none', async () => {
      dailyRecordProposalService.buildCreateDailyRecordProposal.mockResolvedValue(
        emptyCandidatesResult,
      );

      const result = await service.buildCreateDailyRecordProposal(
        mockContext,
        'propose_create_daily_record',
      );

      expect(result).toBe(emptyCandidatesResult);
      expect(result.proposedActions).toBeUndefined();
      expect(result.data).toHaveProperty('candidates', []);
    });

    it('returns unsupported kind result when sub-service provides one', async () => {
      const unsupportedResult: AssistantToolExecutionResult = {
        name: 'propose_create_daily_record',
        data: {
          unsupportedKind: 'mood',
          reason: 'Unsupported kind',
          candidates: [],
        },
      };
      dailyRecordProposalService.buildCreateDailyRecordProposal.mockResolvedValue(
        unsupportedResult,
      );

      const result = await service.buildCreateDailyRecordProposal(
        mockContext,
        'propose_create_daily_record',
      );

      expect(result).toBe(unsupportedResult);
      expect(result.proposedActions).toBeUndefined();
      expect(result.data['unsupportedKind']).toBe('mood');
    });
  });

  describe('buildUpdateDailyRecordProposal', () => {
    it('delegates to dailyRecordProposalService.buildUpdateDailyRecordProposal', async () => {
      dailyRecordProposalService.buildUpdateDailyRecordProposal.mockResolvedValue(
        defaultUpdateResult,
      );

      const result = await service.buildUpdateDailyRecordProposal(
        mockContext,
        'propose_update_daily_record',
      );

      expect(
        dailyRecordProposalService.buildUpdateDailyRecordProposal,
      ).toHaveBeenCalledWith(mockContext, 'propose_update_daily_record');
      expect(result).toBe(defaultUpdateResult);
      expect(result.proposedActions).toHaveLength(1);
      expect(result.proposedActions![0]!.type).toBe('update_daily_record');
    });

    it('returns no proposedActions when sub-service returns no match', async () => {
      const noMatchResult: AssistantToolExecutionResult = {
        name: 'propose_update_daily_record',
        data: {},
      };
      dailyRecordProposalService.buildUpdateDailyRecordProposal.mockResolvedValue(
        noMatchResult,
      );

      const result = await service.buildUpdateDailyRecordProposal(
        mockContext,
        'propose_update_daily_record',
      );

      expect(result).toBe(noMatchResult);
      expect(result.proposedActions).toBeUndefined();
    });
  });

  describe('buildDeleteDailyRecordProposal', () => {
    it('delegates to dailyRecordProposalService.buildDeleteDailyRecordProposal', async () => {
      dailyRecordProposalService.buildDeleteDailyRecordProposal.mockResolvedValue(
        defaultDeleteResult,
      );

      const result = await service.buildDeleteDailyRecordProposal(
        mockContext,
        'propose_delete_daily_record',
      );

      expect(
        dailyRecordProposalService.buildDeleteDailyRecordProposal,
      ).toHaveBeenCalledWith(mockContext, 'propose_delete_daily_record');
      expect(result).toBe(defaultDeleteResult);
      expect(result.proposedActions).toHaveLength(1);
      expect(result.proposedActions![0]!.type).toBe('delete_daily_record');
    });

    it('returns no proposedActions when sub-service returns no match', async () => {
      const noMatchResult: AssistantToolExecutionResult = {
        name: 'propose_delete_daily_record',
        data: {},
      };
      dailyRecordProposalService.buildDeleteDailyRecordProposal.mockResolvedValue(
        noMatchResult,
      );

      const result = await service.buildDeleteDailyRecordProposal(
        mockContext,
        'propose_delete_daily_record',
      );

      expect(result).toBe(noMatchResult);
      expect(result.proposedActions).toBeUndefined();
    });
  });

  describe('buildUpdateUserSettingsProposal', () => {
    it('delegates to settingsProposalService.buildUpdateUserSettingsProposal', () => {
      settingsProposalService.buildUpdateUserSettingsProposal.mockReturnValue(
        defaultSettingsResult,
      );

      const result = service.buildUpdateUserSettingsProposal(
        mockContext,
        'propose_update_user_settings',
      );

      expect(
        settingsProposalService.buildUpdateUserSettingsProposal,
      ).toHaveBeenCalledWith(mockContext, 'propose_update_user_settings');
      expect(result).toBe(defaultSettingsResult);
      expect(result.proposedActions).toHaveLength(1);
      expect(result.proposedActions![0]!.type).toBe('update_user_settings');
    });

    it('returns no proposedActions when sub-service detects no setting changes', () => {
      const noChangeResult: AssistantToolExecutionResult = {
        name: 'propose_update_user_settings',
        data: { matchedSettingKeys: [] },
      };
      settingsProposalService.buildUpdateUserSettingsProposal.mockReturnValue(
        noChangeResult,
      );

      const result = service.buildUpdateUserSettingsProposal(
        { ...mockContext, userMessage: 'hello world' },
        'propose_update_user_settings',
      );

      expect(result).toBe(noChangeResult);
      expect(result.proposedActions).toBeUndefined();
    });

    it('passes context source toggles through to sub-service', () => {
      settingsProposalService.buildUpdateUserSettingsProposal.mockReturnValue(
        defaultSettingsResult,
      );

      const contextWithToggle = {
        ...mockContext,
        userMessage: '关闭睡眠记录上下文',
      };
      service.buildUpdateUserSettingsProposal(
        contextWithToggle,
        'propose_update_user_settings',
      );

      expect(
        settingsProposalService.buildUpdateUserSettingsProposal,
      ).toHaveBeenCalledWith(contextWithToggle, 'propose_update_user_settings');
    });
  });
});
