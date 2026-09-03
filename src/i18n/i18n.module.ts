import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Global, Module } from '@nestjs/common';
import {
  I18nOptions,
  I18nModule as NestI18nModule,
  AcceptLanguageResolver,
} from 'nestjs-i18n';

// ESM equivalent of `__dirname` (translation JSON lives next to this module).
const thisDir = path.dirname(fileURLToPath(import.meta.url));

const i18nOptions: I18nOptions = {
  fallbackLanguage: 'en',
  loaderOptions: {
    path: path.join(thisDir),
    watch: process.env['NODE_ENV'] !== 'production',
  },
  resolvers: [AcceptLanguageResolver],
};

const runtimeRoot = path.basename(path.dirname(thisDir));

if (process.env['NODE_ENV'] === 'development' && runtimeRoot !== 'dist') {
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
