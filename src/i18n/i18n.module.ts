import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Global, Module } from '@nestjs/common';
import {
  I18nOptions,
  I18nModule as NestI18nModule,
  AcceptLanguageResolver,
} from 'nestjs-i18n';
import { isRunningFromSource } from '../config/env/runtime-signal.js';
import { EnvKey } from '../config/env/env-keys.enum.js';

// ESM equivalent of `__dirname` (translation JSON lives next to this module).
const thisDir = path.dirname(fileURLToPath(import.meta.url));

// Bootstrap-stage env read: `forRoot()` options are built before DI, so
// ConfigService is unavailable here. `EnvKey.NODE_ENV` keeps the read on the
// same typed key as `app.config.ts` instead of a raw string literal.
const i18nOptions: I18nOptions = {
  fallbackLanguage: 'en',
  loaderOptions: {
    path: path.join(thisDir),
    watch: process.env[EnvKey.NODE_ENV] !== 'production',
  },
  resolvers: [AcceptLanguageResolver],
};

if (
  process.env[EnvKey.NODE_ENV] === 'development' &&
  isRunningFromSource()
) {
  i18nOptions.typesOutputPath = path.join(
    thisDir,
    '..',
    'generated',
    'i18n.generated.ts',
  );
}

@Global()
@Module({
  imports: [NestI18nModule.forRoot(i18nOptions)],
  exports: [NestI18nModule],
})
export class I18nModule {}
