import * as path from 'node:path';
import { Global, Module } from '@nestjs/common';
import {
  I18nModule as NestI18nModule,
  AcceptLanguageResolver,
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
// eslint-disable-next-line @typescript-eslint/no-extraneous-class -- NestJS @Global() module requires class declaration
export class I18nModule {}
