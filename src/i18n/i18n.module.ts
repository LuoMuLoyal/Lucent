import * as path from 'node:path';
import { Global, Module } from '@nestjs/common';
import {
  I18nModule as NestI18nModule,
  AcceptLanguageResolver,
  I18nService,
} from 'nestjs-i18n';

@Global()
@Module({
  imports: [
    NestI18nModule.forRoot({
      fallbackLanguage: 'zh-CN',
      loaderOptions: {
        path: path.join(__dirname),
        watch: process.env['NODE_ENV'] !== 'production',
      },
      resolvers: [AcceptLanguageResolver],
      typesOutputPath: path.join(
        __dirname,
        '..',
        'generated',
        'i18n.generated.ts',
      ),
    }),
  ],
  exports: [NestI18nModule],
})
export class I18nModule {
  constructor(private readonly _i18n: I18nService) {}
}
