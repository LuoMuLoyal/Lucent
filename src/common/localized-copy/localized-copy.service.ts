import { Injectable } from '@nestjs/common';
import { I18nService } from 'nestjs-i18n';
import {
  buildLocalizedPromptCopy,
  resolveLocale,
  translateScopedCopy,
  type PromptCopy,
} from './localized-copy';

@Injectable()
export abstract class LocalizedCopyService<TPromptCopy extends PromptCopy> {
  protected abstract readonly scope: string;

  constructor(protected readonly i18n: I18nService) {}

  resolveLocale(language: string | undefined): string {
    return resolveLocale(language);
  }

  serviceUnavailable(locale: string): string {
    return this.t(locale, 'service_unavailable');
  }

  buildPromptCopy(locale: string): TPromptCopy {
    return buildLocalizedPromptCopy(
      this.i18n,
      this.scope,
      locale,
    ) as TPromptCopy;
  }

  protected t(
    locale: string,
    key: string,
    args?: Record<string, string | number>,
  ): string {
    return translateScopedCopy(this.i18n, this.scope, locale, key, args);
  }
}
