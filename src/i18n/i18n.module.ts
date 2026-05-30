import * as path from 'node:path';
import { Global, Module } from '@nestjs/common';
import {
  I18nOptions,
  I18nModule as NestI18nModule,
  AcceptLanguageResolver,
} from 'nestjs-i18n';

const i18nOptions: I18nOptions = {
  fallbackLanguage: 'en',
  loaderOptions: {
    path: path.join(__dirname),
    watch: process.env['NODE_ENV'] !== 'production',
  },
  resolvers: [AcceptLanguageResolver],
};

if (process.env['NODE_ENV'] === 'development') {
  i18nOptions.typesOutputPath = path.join(
    __dirname,
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
// eslint-disable-next-line @typescript-eslint/no-extraneous-class -- NestJS @Global() module requires class declaration
export class I18nModule {}
