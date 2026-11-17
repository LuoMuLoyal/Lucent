/**
 * i18n namespace for the assistant module's own user-facing copy.
 *
 * Files live in `src/i18n/{zh-CN,en}/assistant.json`; the sibling
 * `conversation.service.ts` already used this namespace, so the proposal and
 * preview copy moves here rather than inventing a parallel dictionary.
 */
export const ASSISTANT_COPY_SCOPE = 'assistant';

/**
 * The slice of `I18nService` this module needs.
 *
 * Structural rather than `Pick<I18nService, 't'>`: the generic overloads on the
 * real service make a plain test double unassignable, and the specs here use a
 * JSON-backed one so a missing key fails the suite.
 */
export interface AssistantI18nPort {
  t(
    key: string,
    options?: { lang?: string; args?: Record<string, string | number> },
  ): string;
}

/**
 * Builds a translator bound to one locale.
 *
 * The presenter helpers are plain functions rather than DI providers, so they
 * cannot receive `I18nService` by constructor injection. The owning service
 * builds this bound translator once and passes it down, which keeps the
 * presenters pure and unit-testable without a Nest container.
 *
 * A missing translation is surfaced as `[[assistant.<key>]]` rather than the
 * bare key: `nestjs-i18n` returns the key itself when a lookup fails, and
 * printing `assistant.preview.kind` to a user would be worse than the
 * hardcoded text this migration removes. The bracket form is unmistakably a
 * defect in QA. `copy.spec.ts` asserts every key used by the presenters
 * resolves, which is what actually prevents it from shipping.
 */
export function createAssistantTranslator(
  i18n: AssistantI18nPort,
  locale: string,
): (key: string, args?: Record<string, string | number>) => string {
  return (key, args) => {
    const fullKey = `${ASSISTANT_COPY_SCOPE}.${key}`;
    const translated = i18n.t(fullKey, {
      lang: locale,
      ...(args == null ? {} : { args }),
    });
    return typeof translated === 'string' && translated !== fullKey
      ? translated
      : `[[${fullKey}]]`;
  };
}

/** Every key the assistant presenters resolve, for the resolution spec. */
export const ASSISTANT_PRESENTER_COPY_KEYS = [
  'preview.kind',
  'preview.date',
  'preview.value',
  'preview.title',
  'preview.note',
  'preview.matched_by',
  'preview.assistant',
  'preview.persistent_memory',
  'preview.health_profile',
  'preview.daily_records',
  'preview.sleep_records',
  'preview.current_medicines',
  'preview.on',
  'preview.off',
  'proposal.create_record.title',
  'proposal.update_record.title',
  'proposal.delete_record.title',
  'proposal.settings.title',
  'proposal.settings.summary',
  'proposal.settings.target_label',
  'proposal.summary.create_record',
  'proposal.summary.create_record_no_kind',
  'proposal.summary.update_record',
  'proposal.summary.delete_record',
  'proposal.reason.unsupported_kind',
  'proposal.constraint.confirm_first',
  'proposal.constraint.confirm_first_delete',
  'proposal.constraint.create_scope',
  'proposal.constraint.create_regenerate',
  'proposal.constraint.update_allowlist',
  'proposal.constraint.update_single',
  'proposal.constraint.delete_single',
  'proposal.constraint.delete_refuse_guess',
  'proposal.constraint.settings_only',
  'proposal.constraint.settings_regenerate',
] as const;
