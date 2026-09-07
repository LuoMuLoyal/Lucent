import { generatePrefixedId } from '../../../../common/index.js';
import { Injectable } from '@nestjs/common';
import type {
  AssistantToolExecutionContext,
  AssistantToolExecutionResult,
  AssistantUpdateUserSettingsProposalPayload,
} from '../../types/assistant.types.js';
import type { AssistantToolName } from '../shared/tool-types.js';
import { PROPOSAL_TTL_MINUTES } from '../shared/tool-constants.js';
import {
  buildProposalExpiryIso,
  buildSettingsPreviewFields,
  collectSettingsDraftKeys,
  localeText,
} from '../presenters.js';
import { extractSettingsDraft } from './proposal-draft-extractor.js';

@Injectable()
export class AssistantSettingsProposalService {
  buildUpdateUserSettingsProposal(
    context: AssistantToolExecutionContext,
    toolName: AssistantToolName,
  ): AssistantToolExecutionResult {
    const draft = extractSettingsDraft(context.userMessage);
    if (
      draft.assistantEnabled == null &&
      draft.assistantMemoryEnabled == null &&
      draft.assistantContext == null
    ) {
      return {
        name: toolName,
        data: {
          draft,
          matchedSettingKeys: [],
        },
      };
    }
    const payload: AssistantUpdateUserSettingsProposalPayload = {
      type: 'update_user_settings',
      draft,
    };
    const settingKeys = collectSettingsDraftKeys(draft);
    return {
      name: toolName,
      data: {
        draft,
        matchedSettingKeys: settingKeys,
      },
      proposedActions: [
        {
          id: generatePrefixedId('proposal-settings'),
          type: 'update_user_settings',
          status: 'proposed',
          confirmationRequired: true,
          title: localeText(
            context.locale,
            '更新助手相关设置',
            'Update assistant settings',
          ),
          summary: localeText(
            context.locale,
            '我整理出了一组设置变更，确认后才会真正写入。',
            'I prepared a settings change set. Nothing will be written until you confirm.',
          ),
          reason: null,
          previewFields: buildSettingsPreviewFields(draft, context.locale),
          target: {
            kind: 'user_settings',
            label: localeText(context.locale, '助手设置', 'Assistant settings'),
            settingKeys,
            snapshot: draft,
          },
          constraints: [
            localeText(
              context.locale,
              '必须先经过你确认，后端不会直接写入。',
              'Must be confirmed by you before any write happens.',
            ),
            localeText(
              context.locale,
              '这里只允许修改助手相关设置，不会触碰其他用户设置。',
              'Only assistant-related settings are allowed here. Nothing outside that scope can change.',
            ),
            localeText(
              context.locale,
              '如果你想调整更多设置，应重新生成新的提案。',
              'Generate a new proposal if you want a broader settings change.',
            ),
          ],
          expiresAt: buildProposalExpiryIso(PROPOSAL_TTL_MINUTES),
          payloadVersion: 1,
          payload,
        },
      ],
    };
  }
}
