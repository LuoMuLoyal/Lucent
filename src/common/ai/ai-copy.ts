import type { I18nService } from 'nestjs-i18n';

export interface AiPromptCopy {
  userIntro: string;
  tone: string;
  actionLabelHint: string;
  factsLabel: string;
}

type AiCopyArgs = Record<string, string | number>;

export function resolveAiLocale(language: string | undefined): string {
  const normalized = language?.trim().toLowerCase() ?? '';
  if (normalized.startsWith('zh')) {
    return 'zh-CN';
  }

  return 'en';
}

export function buildLocalizedAiPromptCopy(
  i18n: I18nService,
  scope: string,
  locale: string,
): AiPromptCopy {
  const actionLabel = translateAiScopedCopy(
    i18n,
    scope,
    locale,
    'fallback.action_label',
  );

  return {
    userIntro: translateAiScopedCopy(i18n, scope, locale, 'prompt.user_intro', {
      languageLabel: locale === 'zh-CN' ? '中文' : 'English',
    }),
    tone: translateAiScopedCopy(i18n, scope, locale, 'prompt.tone'),
    actionLabelHint: translateAiScopedCopy(
      i18n,
      scope,
      locale,
      'prompt.action_label_hint',
      {
        actionLabel,
      },
    ),
    factsLabel: translateAiScopedCopy(
      i18n,
      scope,
      locale,
      'prompt.facts_label',
    ),
  };
}

export function buildAiUserPrompt(
  context: unknown,
  copy: AiPromptCopy,
): string {
  return [
    copy.userIntro,
    copy.tone,
    copy.actionLabelHint,
    copy.factsLabel,
    JSON.stringify(context),
  ].join('\n');
}

export function translateAiScopedCopy(
  i18n: I18nService,
  scope: string,
  locale: string,
  key: string,
  args?: AiCopyArgs,
): string {
  if (args === undefined) {
    return i18n.t(`${scope}.${key}`, {
      lang: locale,
    });
  }

  return i18n.t(`${scope}.${key}`, {
    lang: locale,
    args,
  });
}
