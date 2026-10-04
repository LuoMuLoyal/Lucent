import { generatePrefixedId } from '../../../../common/index.js';
import { Injectable } from '@nestjs/common';
import { I18nService } from 'nestjs-i18n';
import type {
  AssistantToolExecutionContext,
  AssistantToolExecutionResult,
  AssistantUpdateUserSettingsProposalPayload,
} from '../../types/assistant.types.js';
import type { AssistantToolName } from '../shared/tool-types.js';
import { PROPOSAL_TTL_MINUTES } from '../shared/tool-constants.js';
import { createAssistantTranslator } from '../shared/copy.js';
import {
  buildProposalExpiryIso,
  buildSettingsPreviewFields,
  collectSettingsDraftKeys,
} from '../presenters.js';
import { extractSettingsDraft } from './proposal-draft-extractor.js';

@Injectable()
export class AssistantSettingsProposalService {
  constructor(private readonly i18n: I18nService) {}

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
    const t = createAssistantTranslator(this.i18n, context.locale);
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
          title: t('proposal.settings.title'),
          summary: t('proposal.settings.summary'),
          reason: null,
          previewFields: buildSettingsPreviewFields(draft, t),
          target: {
            kind: 'user_settings',
            label: t('proposal.settings.target_label'),
            settingKeys,
            snapshot: draft,
          },
          constraints: [
            t('proposal.constraint.confirm_first'),
            t('proposal.constraint.settings_only'),
            t('proposal.constraint.settings_regenerate'),
          ],
          expiresAt: buildProposalExpiryIso(PROPOSAL_TTL_MINUTES),
          payloadVersion: 1,
          payload,
        },
      ],
    };
  }
}
