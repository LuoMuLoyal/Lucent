import type { I18nService } from 'nestjs-i18n';

export interface PromptCopy {
  userIntro: string;
  tone: string;
  actionLabelHint: string;
  factsLabel: string;
}

type ScopedCopyArgs = Record<string, string | number>;

export function resolveLocale(language: string | undefined): string {
  const normalized = language?.trim().toLowerCase() ?? '';
  if (normalized.startsWith('zh')) {
    return 'zh-CN';
  }

  return 'en';
}

export function buildLocalizedPromptCopy(
  i18n: I18nService,
  scope: string,
  locale: string,
): PromptCopy {
  const actionLabel = translateScopedCopy(
    i18n,
    scope,
    locale,
    'fallback.action_label',
  );

  return {
    userIntro: translateScopedCopy(i18n, scope, locale, 'prompt.user_intro', {
      languageLabel: locale === 'zh-CN' ? '中文' : 'English',
    }),
    tone: translateScopedCopy(i18n, scope, locale, 'prompt.tone'),
    actionLabelHint: translateScopedCopy(
      i18n,
      scope,
      locale,
      'prompt.action_label_hint',
      {
        actionLabel,
      },
    ),
    factsLabel: translateScopedCopy(i18n, scope, locale, 'prompt.facts_label'),
  };
}

export function buildUserPrompt(context: unknown, copy: PromptCopy): string {
  return [
    copy.userIntro,
    copy.tone,
    copy.actionLabelHint,
    copy.factsLabel,
    JSON.stringify(context),
  ].join('\n');
}

export function translateScopedCopy(
  i18n: I18nService,
  scope: string,
  locale: string,
  key: string,
  args?: ScopedCopyArgs,
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
